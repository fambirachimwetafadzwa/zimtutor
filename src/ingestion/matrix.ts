import { nameContinues } from "./naming";
import type { Block, HeadingBlock, Item, Ledger } from "./tables";
import { TOPIC_NAMES, type TopicCode } from "./snapshot";

/**
 * Competency-matrix assembly: tables → row fragments → logical rows.
 *
 * The matrix is a five-column Word table (SUB TOPIC | OBJECTIVES | CONTENT | SUGGESTED NOTES AND
 * ACTIVITIES | SUGGESTED RESOURCES) that breaks across pages, and Word splits a row that straddles a
 * page break into SEPARATE table rows. Two things therefore need care, and both are decided from
 * evidence the PDF provides rather than from guesses:
 *
 *  1. COLUMNS come from geometry. The tagged cell ORDER is unreliable (merged/split cells shift
 *     cells one position), so every item is assigned to the column whose header it sits under.
 *  2. ROWS come from classifying each fragment (see `assembleRows`).
 */

export const COLUMN_NAMES = [
  "SUB TOPIC",
  "OBJECTIVES",
  "CONTENT",
  "SUGGESTED NOTES AND ACTIVITIES",
  "SUGGESTED RESOURCES",
] as const;
export const COL = { SUBTOPIC: 0, OBJECTIVES: 1, CONTENT: 2, ACTIVITIES: 3, RESOURCES: 4 } as const;

/**
 * Items may sit slightly left of their header's left edge (a hanging bullet). Measured over the whole
 * syllabus, items sit at most 4.2pt left of their edge and NOTHING lies between 5pt and 20pt, so any
 * value in that gap is safe; 8 leaves margin on both sides.
 */
export const COLUMN_TOLERANCE = 8;

const HEADING_PATTERN = /^(\d+\.\d+)\s+\(GRADE\s*(\d+)\)\s+TOPIC\s*\d*\s*:?\s*([A-Za-z]+)\s*(.*)$/i;

const TOPIC_BY_WORD: Record<string, TopicCode> = {
  NUMBER: "NUM",
  OPERATIONS: "OPS",
  MEASURES: "MEA",
  RELATIONSHIPS: "REL",
};

export interface MatrixHeading {
  sectionNumber: string;
  grade: number;
  topic: TopicCode;
  headingText: string;
  scopeText: string | null;
  scopeMax: number | null;
}

export function parseMatrixHeading(text: string): MatrixHeading | null {
  const clean = text.replace(/\s+/g, " ").trim();
  const m = HEADING_PATTERN.exec(clean);
  if (!m) return null;
  const topic = TOPIC_BY_WORD[m[3]!.toUpperCase()];
  if (!topic) {
    throw new Error(
      `Matrix heading "${clean}" names an unknown topic "${m[3]}" (expected ${Object.values(TOPIC_NAMES).join(", ")})`,
    );
  }
  const rest = (m[4] ?? "").trim();
  const scope = /^\(([^)]*)\)$/.exec(rest);
  const scopeText = scope ? scope[1]!.trim() : rest === "" ? null : rest;
  return {
    sectionNumber: m[1]!,
    grade: Number(m[2]),
    topic,
    headingText: clean,
    scopeText,
    scopeMax: scopeText ? maxNumber(scopeText) : null,
  };
}

/** Largest number in text, treating spaces as thousands separators: "0 to 10 000 000" → 10000000. */
export function maxNumber(text: string): number | null {
  const joined = text.replace(/(?<=\d)[\s ](?=\d{3}(?:\D|$))/g, "");
  const numbers = [...joined.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  return numbers.length > 0 ? Math.max(...numbers) : null;
}

export interface Fragment {
  /** Position among the table's body rows (document order). */
  index: number;
  cols: Item[][];
  startPage: number;
  endPage: number;
}

export interface MatrixTable {
  heading: MatrixHeading;
  headingBlock: HeadingBlock;
  /** Left edge of each of the five columns. */
  columnEdges: number[];
  objectiveStem: string;
  fragments: Fragment[];
  pages: number[];
  /** Items positioned after the next heading (mis-tagged into this table by the PDF producer). */
  outOfWindow: Item[];
}

export type FragmentKind = "HEAD" | "NEW_SUBTOPIC" | "NEW_ROW" | "TAIL";

export interface AssembledRow {
  fragments: Fragment[];
  /** Merged items per column, in document order. */
  cols: Item[][];
  /** Whether this row starts a new sub-topic (otherwise it continues the previous sub-topic). */
  startsSubtopic: boolean;
  /** How the row was put together, for the audit trail. */
  assembly: string[];
}

function itemKey(item: Item): [number, number] {
  return [item.page, item.top];
}

function before(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
}

function columnOf(x: number, edges: number[]): number {
  let col = 0;
  for (let k = 0; k < edges.length; k++) if (edges[k]! - COLUMN_TOLERANCE <= x) col = k;
  return col;
}

function sortItems(items: Item[]): Item[] {
  return items
    .map((item, order) => ({ item, order }))
    .sort((a, b) => a.item.page - b.item.page || a.item.top - b.item.top || a.order - b.order)
    .map((entry) => entry.item);
}

/** Select the matrix tables and turn each into positioned fragments. */
export function readMatrixTables(blocks: Block[], ledger: Ledger): MatrixTable[] {
  const tables: MatrixTable[] = [];
  const seenHeadings = new Set<HeadingBlock>();

  blocks.forEach((block, blockIndex) => {
    if (block.kind !== "table" || !block.heading) return;
    const parsed = parseMatrixHeading(block.heading.text);
    if (!parsed) return;

    // The boundary of this table: the next heading in document order.
    const nextHeading = blocks
      .slice(blockIndex + 1)
      .find((b): b is HeadingBlock => b.kind === "heading");
    const boundary: [number, number] | null = nextHeading
      ? [nextHeading.page, nextHeading.top]
      : null;
    const inWindow = (item: Item) => boundary === null || before(itemKey(item), boundary);

    const owner = `matrix:G${parsed.grade}-${parsed.topic}`;

    if (seenHeadings.has(block.heading)) {
      // A second table under the same matrix heading is only acceptable if it is a "ghost": a copy of
      // the skeleton carrying nothing but text that lies beyond the next heading (a producer mis-tag).
      const ghostItems = block.rows.flatMap((r) => r.cells.flatMap((c) => c.items));
      const stray = ghostItems.filter((i) => i.x0 >= 0 && inWindow(i)); // items with no visible text are irrelevant
      if (stray.length > 0) {
        throw new Error(
          `A second table follows heading "${block.heading.text}" and holds in-window text: ${stray
            .slice(0, 3)
            .map((i) => JSON.stringify(i.text))
            .join(", ")}`,
        );
      }
      const previous = tables.find((t) => t.headingBlock === block.heading)!;
      previous.outOfWindow.push(...ghostItems);
      return;
    }
    seenHeadings.add(block.heading);

    const header = block.rows.find((r) => r.section === "THead");
    if (!header || header.cells.length !== COLUMN_NAMES.length) {
      throw new Error(
        `Matrix "${parsed.headingText}": expected a header row with ${COLUMN_NAMES.length} cells`,
      );
    }
    const edges: number[] = [];
    let stem = "";
    header.cells.forEach((cell, k) => {
      const visible = cell.items.filter((i) => i.text !== "");
      const text = visible
        .map((i) => i.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase();
      const expected = COLUMN_NAMES[k]!;
      if (!text.startsWith(expected.split(" ")[0]!)) {
        throw new Error(
          `Matrix "${parsed.headingText}": header column ${k + 1} is "${text}", expected "${expected}"`,
        );
      }
      if (k === COL.OBJECTIVES) {
        stem = visible.find((i) => /pupils should be able to/i.test(i.text))?.text ?? "";
      }
      edges.push(Math.min(...visible.map((i) => i.x0)));
      for (const item of cell.items)
        for (const mcid of item.mcids) ledger.claim(item.page, mcid, `matrix-header:${owner}`);
    });
    if (stem === "")
      throw new Error(
        `Matrix "${parsed.headingText}": objectives header lacks "Pupils should be able to:"`,
      );

    const outOfWindow: Item[] = [];
    const fragments: Fragment[] = [];
    block.rows
      .filter((r) => r.section === "TBody")
      .forEach((row, index) => {
        const cols: Item[][] = COLUMN_NAMES.map(() => []);
        for (const item of row.cells.flatMap((c) => c.items)) {
          if (item.x0 < 0) {
            // No visible text at all (an empty tagged element): nothing to place, nothing to lose.
            for (const mcid of item.mcids) ledger.claim(item.page, mcid, owner);
            continue;
          }
          if (!inWindow(item)) {
            outOfWindow.push(item);
            continue;
          }
          for (const mcid of item.mcids) ledger.claim(item.page, mcid, owner);
          cols[columnOf(item.x0, edges)]!.push(item);
        }
        const sorted = cols.map(sortItems);
        const all = sorted.flat();
        if (all.length === 0) return; // an entirely empty (or entirely out-of-window) row
        fragments.push({
          index,
          cols: sorted,
          startPage: Math.min(...all.map((i) => i.page)),
          endPage: Math.max(...all.map((i) => i.page)),
        });
      });

    tables.push({
      heading: parsed,
      headingBlock: block.heading,
      columnEdges: edges,
      objectiveStem: stem,
      fragments,
      pages: block.pages,
      outOfWindow,
    });
  });
  return tables;
}

function nonEmpty(items: Item[]): Item[] {
  return items.filter((i) => i.text !== "");
}

function nameText(cols: Item[][]): string {
  return nonEmpty(cols[COL.SUBTOPIC]!)
    .map((i) => i.text)
    .join(" ");
}

/**
 * Turn fragments into logical rows.
 *
 * Classification of a fragment F (P = the fragment before it):
 *  - the first fragment of a table starts the first sub-topic;
 *  - TAIL: F begins on a NEW PAGE and is the spill-over of P's row. Word only ever splits a row at a
 *    page boundary, so a tail can only be the first fragment on a page. F is a tail when it has no
 *    objectives of its own (nothing new starts there), or when its first-column text is the wrapped
 *    remainder of P's sub-topic name (open bracket, trailing colon, lower-case/continuing start);
 *  - NEW_SUBTOPIC: F has first-column text and is not a tail;
 *  - NEW_ROW: F has no first-column text (the sub-topic cell is merged over several rows) but has
 *    objectives of its own: another objective group under the same sub-topic.
 */
export function assembleRows(fragments: Fragment[], context: string): AssembledRow[] {
  const rows: AssembledRow[] = [];
  let previous: Fragment | undefined;

  for (const fragment of fragments) {
    const hasName = nonEmpty(fragment.cols[COL.SUBTOPIC]!).length > 0;
    const hasObjectives = nonEmpty(fragment.cols[COL.OBJECTIVES]!).length > 0;
    const last = rows[rows.length - 1];
    const newPage = previous !== undefined && fragment.startPage > previous.endPage;

    let kind: FragmentKind;
    if (!last) {
      if (!hasName) throw new Error(`${context}: the first row has no sub-topic text`);
      kind = "HEAD";
    } else if (
      newPage &&
      (!hasObjectives ||
        (hasName &&
          nameContinues(nameText(last.cols), nonEmpty(fragment.cols[COL.SUBTOPIC]!)[0]!.text)))
    ) {
      kind = "TAIL";
    } else {
      kind = hasName ? "NEW_SUBTOPIC" : "NEW_ROW";
    }

    if (kind === "TAIL" && last) {
      // The first item of each column in a tail starts mid-way through whatever the previous page ended with.
      for (const items of fragment.cols) if (items[0]) items[0].afterPageBreak = true;
      fragment.cols.forEach((items, k) => last.cols[k]!.push(...items));
      last.fragments.push(fragment);
      last.assembly.push(
        `tail:p${fragment.startPage}${hasName ? "+name" : ""}${hasObjectives ? "+objectives" : ""}`,
      );
    } else {
      const startsSubtopic = kind === "HEAD" || kind === "NEW_SUBTOPIC";
      rows.push({
        fragments: [fragment],
        cols: fragment.cols.map((items) => [...items]),
        startsSubtopic,
        assembly: [
          kind === "NEW_ROW" ? `sub-row:p${fragment.startPage}` : `head:p${fragment.startPage}`,
        ],
      });
    }
    previous = fragment;
  }
  return rows;
}
