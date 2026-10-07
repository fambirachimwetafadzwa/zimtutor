import { toBullets } from "./bullets";
import { COLUMN_TOLERANCE } from "./matrix";
import type { SnapshotScopeSequence, SnapshotSection, Source, TopicCode } from "./snapshot";
import type { Block, HeadingBlock, Item, Ledger, TableBlock, TextBlock } from "./tables";

/**
 * Secondary curriculum material that is kept for retrieval and progression, not for mastery:
 *  - SCOPE AND SEQUENCE (section 7): per topic and grade, what the syllabus covers;
 *  - prose sections (preamble, aims, methodology; assessment) as retrievable text.
 */

interface Context {
  pageLabels: Map<number, string | null>;
}

const SS_HEADING = /^(7\.\d+)\s+TOPIC\s*\d*\s*:?\s*([A-Za-z]+)/i;
const TOPIC_BY_WORD: Record<string, TopicCode> = {
  NUMBER: "NUM",
  OPERATIONS: "OPS",
  MEASURES: "MEA",
  RELATIONSHIPS: "REL",
};

function source(ctx: Context, pages: number[], text: string): Source {
  const first = Math.min(...pages);
  const last = Math.max(...pages);
  return {
    page: first,
    page_end: last > first ? last : null,
    page_label: ctx.pageLabels.get(first) ?? null,
    source_text: text,
  };
}

function sortItems(items: Item[]): Item[] {
  return items
    .map((item, order) => ({ item, order }))
    .sort((a, b) => a.item.page - b.item.page || a.item.top - b.item.top || a.order - b.order)
    .map((e) => e.item);
}

export function readScopeSequence(
  blocks: Block[],
  ledger: Ledger,
  ctx: Context,
): SnapshotScopeSequence[] {
  interface Group {
    section: string;
    topic: TopicCode;
    tables: TableBlock[];
  }
  const groups = new Map<HeadingBlock, Group>();
  for (const block of blocks) {
    if (block.kind !== "table" || !block.heading) continue;
    const m = SS_HEADING.exec(block.heading.text.replace(/\s+/g, " ").trim());
    if (!m) continue;
    const topic = TOPIC_BY_WORD[m[2]!.toUpperCase()];
    if (!topic)
      throw new Error(`Scope and sequence heading "${block.heading.text}" names an unknown topic`);
    const group = groups.get(block.heading) ?? { section: m[1]!, topic, tables: [] };
    group.tables.push(block);
    groups.set(block.heading, group);
  }

  const out: SnapshotScopeSequence[] = [];
  for (const group of groups.values()) {
    const byGrade = new Map<number, Item[]>();
    let edges: number[] | null = null;
    for (const table of group.tables) {
      // The producer split some scope tables into several physical tables; only the first has a real
      // GRADE header, and in the others the first CONTENT row is tagged as a header row.
      const header = table.rows.find((r) => r.section === "THead");
      const realHeader =
        header !== undefined &&
        header.cells.length === 5 &&
        header.cells.every((cell, k) => {
          const m = /^GRADE\s*(\d)$/i.exec(
            cell.items
              .map((i) => i.text)
              .join(" ")
              .trim(),
          );
          return m !== null && Number(m[1]) === 3 + k;
        });
      if (realHeader && header) {
        edges = header.cells.map((cell) =>
          Math.min(...cell.items.filter((i) => i.text !== "").map((i) => i.x0)),
        );
        for (const cell of header.cells) {
          for (const item of cell.items)
            for (const mcid of item.mcids)
              ledger.claim(item.page, mcid, `scope-sequence:${group.topic}`);
        }
      }
      if (!edges)
        throw new Error(
          `Scope and sequence ${group.section}: the first table has no "GRADE 3 … GRADE 7" header row`,
        );
      const columnEdges = edges;
      const contentRows = table.rows.filter(
        (r) => r.section === "TBody" || (r.section === "THead" && !realHeader),
      );
      for (const row of contentRows) {
        for (const item of row.cells.flatMap((c) => c.items)) {
          for (const mcid of item.mcids)
            ledger.claim(item.page, mcid, `scope-sequence:${group.topic}`);
          if (item.x0 < 0) continue;
          let col = 0;
          columnEdges.forEach((edge, k) => {
            if (edge - COLUMN_TOLERANCE <= item.x0) col = k;
          });
          const grade = 3 + col;
          const list = byGrade.get(grade) ?? [];
          list.push(item);
          byGrade.set(grade, list);
        }
      }
    }
    for (const grade of [...byGrade.keys()].sort((a, b) => a - b)) {
      const items = sortItems(byGrade.get(grade)!);
      const bullets = toBullets(items);
      if (bullets.length === 0) continue;
      out.push({
        id: `SS-G${grade}-${group.topic}`,
        topic_code: group.topic,
        grade,
        section_number: group.section,
        items: bullets.map((b) => b.text),
        source: source(
          ctx,
          bullets.flatMap((b) => [b.page, b.pageEnd]),
          bullets.map((b) => b.sourceText).join("\n"),
        ),
      });
    }
  }
  const order: TopicCode[] = ["NUM", "OPS", "MEA", "REL"];
  return out.sort(
    (a, b) => order.indexOf(a.topic_code) - order.indexOf(b.topic_code) || a.grade - b.grade,
  );
}

function renderTable(table: TableBlock): string {
  return table.rows
    .map((r) => r.cells.flatMap((c) => c.items.map((i) => i.text).filter(Boolean)).join(" | "))
    .filter(Boolean)
    .join("\n");
}

function renderTextBlock(block: TextBlock): string {
  return block.items
    .filter((i) => i.text !== "")
    .map((i) => (i.kind === "li" ? `• ${i.text}` : i.text))
    .join("\n");
}

/**
 * Prose sections: the preamble (section 1 up to "7 SCOPE AND SEQUENCE") and the assessment section
 * (from "9 ASSESSMENT" to the end). Each heading starts a section holding the text that follows it.
 */
export function readSections(blocks: Block[], ledger: Ledger, ctx: Context): SnapshotSection[] {
  const isHeading = (b: Block, pattern: RegExp): b is HeadingBlock =>
    b.kind === "heading" && pattern.test(b.text.trim());
  const preambleStart = blocks.findIndex((b) => isHeading(b, /^1\s+PREAMBLE/i));
  const scopeStart = blocks.findIndex((b) => isHeading(b, /^7\s+SCOPE AND SEQUENCE/i));
  const assessmentStart = blocks.findIndex((b) => isHeading(b, /^9\s+ASSESSMENT/i));
  if (
    preambleStart < 0 ||
    scopeStart < 0 ||
    assessmentStart < 0 ||
    !(preambleStart < scopeStart && scopeStart < assessmentStart)
  ) {
    throw new Error(
      'Could not locate the "1 PREAMBLE", "7 SCOPE AND SEQUENCE" and "9 ASSESSMENT" headings',
    );
  }

  const sections: SnapshotSection[] = [];
  const collect = (from: number, to: number, kind: "PREAMBLE" | "ASSESSMENT") => {
    let current: { heading: HeadingBlock; parts: string[]; pages: Set<number> } | null = null;
    const flush = () => {
      if (!current) return;
      const text = [current.heading.text, ...current.parts].join("\n").trim();
      sections.push({
        id: `SEC-${kind}-${sections.length + 1}`,
        kind,
        level: current.heading.level,
        heading: current.heading.text,
        text,
        source: source(ctx, [...current.pages], text),
      });
      current = null;
    };
    for (let i = from; i < to; i++) {
      const block = blocks[i]!;
      if (block.kind === "heading") {
        flush();
        current = { heading: block, parts: [], pages: new Set([block.page]) };
      } else if (current && block.kind === "text") {
        const text = renderTextBlock(block);
        if (text) {
          current.parts.push(text);
          current.pages.add(block.page);
        }
      } else if (current && block.kind === "table" && kind === "ASSESSMENT") {
        // Only genuine tables with a header row; skip the producer's mis-tagged ghost skeleton.
        const hasHeader = block.rows.some(
          (r) => r.section === "THead" && r.cells.some((c) => c.items.some((it) => it.text !== "")),
        );
        if (hasHeader) {
          current.parts.push(renderTable(block));
          for (const p of block.pages) current.pages.add(p);
        }
      }
    }
    flush();
  };
  collect(preambleStart, scopeStart, "PREAMBLE");
  collect(assessmentStart, blocks.length, "ASSESSMENT");

  // Ownership: prose blocks in these ranges are accounted for by the sections built above.
  for (const [from, to] of [
    [preambleStart, scopeStart],
    [assessmentStart, blocks.length],
  ] as const) {
    for (let i = from; i < to; i++) {
      const block = blocks[i]!;
      if (block.kind === "text")
        for (const mcid of block.mcids) ledger.claim(block.page, mcid, "prose");
    }
  }
  return sections;
}
