import { toBullets, countEmptyBullets, mergeBullets, type Bullet } from "./bullets";
import { objectiveId, rowId, rowItemId, textHash } from "./ids";
import { composeSubtopicName } from "./naming";
import { assembleRows, COL, COLUMN_NAMES, type AssembledRow, type MatrixTable } from "./matrix";
import type { OverrideIndex } from "./overrides";
import type {
  CurriculumSnapshot,
  Source,
  SnapshotObjective,
  SnapshotRow,
  SnapshotRowItem,
  SnapshotSubtopic,
  SnapshotWarning,
} from "./snapshot";
import { TOPIC_NAMES } from "./snapshot";
import type { Item } from "./tables";

export interface RecordContext {
  pageLabels: Map<number, string | null>;
  overrides: OverrideIndex;
}

export interface UnreviewedNotation {
  page: number;
  column: string;
  source: string;
  reason: "FORMULA" | "SUBSCRIPT";
}

export interface TableRecords {
  topic: CurriculumSnapshot["topics"][number];
  subtopics: SnapshotSubtopic[];
  rows: SnapshotRow[];
  objectives: SnapshotObjective[];
  content: SnapshotRowItem[];
  activities: SnapshotRowItem[];
  resources: SnapshotRowItem[];
  warnings: SnapshotWarning[];
  unreviewed: UnreviewedNotation[];
}

function sourceOf(ctx: RecordContext, pages: number[], sourceText: string): Source {
  const first = Math.min(...pages);
  const last = Math.max(...pages);
  return {
    page: first,
    page_end: last > first ? last : null,
    page_label: ctx.pageLabels.get(first) ?? null,
    source_text: sourceText,
  };
}

function pagesOf(items: Item[]): number[] {
  return items.length > 0 ? [...new Set(items.map((i) => i.page))] : [1];
}

function verbatim(items: Item[]): string {
  return items
    .filter((i) => i.sourceText !== "" || i.label !== "")
    .map((i) => (i.sourceText === "" ? i.label : i.sourceText))
    .join("\n");
}

/** Resolve a bullet to its final text, applying (and recording) any reviewed override. */
function resolveText(
  bullet: Bullet,
  column: string,
  ctx: RecordContext,
  unreviewed: UnreviewedNotation[],
  warnings: SnapshotWarning[],
): { text: string; normalizations: string[] } {
  const normalizations = [...bullet.normalizations];
  const verbatimOneLine = bullet.sourceText.replace(/\s+/g, " ").trim();
  const erratum = ctx.overrides.findErratum(bullet.page, verbatimOneLine);
  if (erratum) {
    warnings.push({
      code: "SOURCE_TYPO_SUSPECTED",
      message: `Page ${bullet.page}: ${erratum.issue} Probable intent: ${erratum.probable_intent}`,
      page: bullet.page,
      ref: verbatimOneLine.slice(0, 80),
    });
  }
  const fix = ctx.overrides.find(bullet.page, verbatimOneLine);
  if (fix) {
    return {
      text: fix.text.replace(/\s+/g, " ").trim(),
      normalizations: [...normalizations, "REVIEWED_OVERRIDE"].sort(),
    };
  }
  if (bullet.hasFormula)
    unreviewed.push({ page: bullet.page, column, source: verbatimOneLine, reason: "FORMULA" });
  if (bullet.hasSubscript)
    unreviewed.push({ page: bullet.page, column, source: verbatimOneLine, reason: "SUBSCRIPT" });
  return { text: bullet.text, normalizations };
}

/** Apply reviewed joins (accidental mid-sentence bullet splits in the source). */
function applyJoins(bullets: Bullet[], ctx: RecordContext): Bullet[] {
  const out: Bullet[] = [];
  for (let i = 0; i < bullets.length; i++) {
    const current = bullets[i]!;
    const next = bullets[i + 1];
    const join = ctx.overrides.findJoin(current.page, current.sourceText, next?.sourceText);
    if (join && next) {
      out.push(mergeBullets(current, next));
      i += 1;
    } else {
      out.push(current);
    }
  }
  return out;
}

export function buildTableRecords(table: MatrixTable, ctx: RecordContext): TableRecords {
  const { heading } = table;
  const gradeId = `G${heading.grade}`;
  const topicId = `${gradeId}-${heading.topic}`;
  const context = heading.headingText;
  const rows: AssembledRow[] = assembleRows(table.fragments, context);

  const out: TableRecords = {
    topic: {
      id: topicId,
      grade_id: gradeId,
      subject_id: "MATH",
      code: heading.topic,
      name: TOPIC_NAMES[heading.topic],
      ordinal: ["NUM", "OPS", "MEA", "REL"].indexOf(heading.topic) + 1,
      section_number: heading.sectionNumber,
      heading_text: heading.headingText,
      scope_text: heading.scopeText,
      scope_max: heading.scopeMax,
      source: sourceOf(ctx, [table.headingBlock.page], heading.headingText),
    },
    subtopics: [],
    rows: [],
    objectives: [],
    content: [],
    activities: [],
    resources: [],
    warnings: [],
    unreviewed: [],
  };

  const usedSlugs = new Set<string>();
  let subtopic: SnapshotSubtopic | null = null;
  let rowCount = 0;
  let objectiveCount = 0;

  for (const row of rows) {
    if (row.startsSubtopic) {
      const parts = composeSubtopicName(row.cols[COL.SUBTOPIC]!);
      if (parts.name === "") throw new Error(`${context}: a sub-topic has no name`);
      let slug = parts.slug;
      for (let n = 2; usedSlugs.has(slug); n++) slug = `${parts.slug}-${n}`;
      usedSlugs.add(slug);
      const nameItems = row.cols[COL.SUBTOPIC]!.filter((i) => i.text !== "");
      subtopic = {
        id: `${topicId}-${slug}`,
        topic_id: topicId,
        ordinal: out.subtopics.length + 1,
        name: parts.name,
        short_name: parts.shortName,
        slug,
        group_name: parts.group,
        strand_key: parts.strand,
        source: sourceOf(ctx, pagesOf(nameItems), verbatim(nameItems)),
      };
      out.subtopics.push(subtopic);
      rowCount = 0;
      objectiveCount = 0;
    }
    if (!subtopic) throw new Error(`${context}: row before any sub-topic`);

    if (!row.startsSubtopic && row.cols[COL.SUBTOPIC]!.some((i) => i.text !== "")) {
      out.warnings.push({
        code: "UNEXPECTED_NAME_TEXT_IN_SUBROW",
        message: `First-column text appeared in a continuation row of "${subtopic.name}"`,
        page: row.fragments[0]!.startPage,
        ref: subtopic.id,
      });
    }

    rowCount += 1;
    const thisRowId = rowId(subtopic.id, rowCount);
    const allItems = row.cols.flat();
    const rowPages = pagesOf(allItems);
    const cellText = (k: number) => verbatim(row.cols[k]!);
    const rowSourceText = COLUMN_NAMES.map((name, k) => `${name}: ${cellText(k)}`).join("\n");

    out.rows.push({
      id: thisRowId,
      subtopic_id: subtopic.id,
      ordinal: rowCount,
      objectives_source_text: cellText(COL.OBJECTIVES),
      content_source_text: cellText(COL.CONTENT),
      activities_source_text: cellText(COL.ACTIVITIES),
      resources_source_text: cellText(COL.RESOURCES),
      assembly: row.assembly,
      source: sourceOf(ctx, rowPages, rowSourceText),
    });

    for (const [column, name] of [
      [COL.OBJECTIVES, "OBJECTIVES"],
      [COL.CONTENT, "CONTENT"],
      [COL.ACTIVITIES, "ACTIVITIES"],
      [COL.RESOURCES, "RESOURCES"],
    ] as const) {
      const items = row.cols[column]!;
      const empties = countEmptyBullets(items);
      if (empties > 0) {
        out.warnings.push({
          code: "EMPTY_BULLET",
          message: `${empties} empty bullet(s) with no text in ${name} of ${thisRowId}; ignored`,
          page: pagesOf(items)[0] ?? null,
          ref: thisRowId,
        });
      }
      const bullets = applyJoins(toBullets(items), ctx);
      bullets.forEach((bullet, i) => {
        const { text, normalizations } = resolveText(
          bullet,
          name,
          ctx,
          out.unreviewed,
          out.warnings,
        );
        const source = sourceOf(ctx, [bullet.page, bullet.pageEnd], bullet.sourceText);
        if (column === COL.OBJECTIVES) {
          objectiveCount += 1;
          out.objectives.push({
            id: objectiveId(subtopic!.id, objectiveCount),
            subtopic_id: subtopic!.id,
            competency_row_id: thisRowId,
            ordinal_in_subtopic: objectiveCount,
            ordinal_in_row: i + 1,
            text,
            text_hash: textHash(text),
            normalizations,
            source,
          });
        } else {
          const kind = column === COL.CONTENT ? "CON" : column === COL.ACTIVITIES ? "ACT" : "RES";
          const record: SnapshotRowItem = {
            id: rowItemId(thisRowId, kind, i + 1),
            competency_row_id: thisRowId,
            ordinal: i + 1,
            text,
            normalizations,
            source,
          };
          (column === COL.CONTENT
            ? out.content
            : column === COL.ACTIVITIES
              ? out.activities
              : out.resources
          ).push(record);
        }
      });
    }
  }
  return out;
}
