import type { Sql } from "postgres";
import type { Db } from "../lib/db/types";
import { auditCurriculum, CurriculumAuditError, type AuditFinding } from "./audit";
import { buildChunks, type ChunkRecord } from "./chunks";
import { snapshotSchema, type CurriculumSnapshot, type Source } from "./snapshot";
import { formatIssues, validateSnapshot } from "./validate";

/**
 * Load a validated curriculum snapshot into PostgreSQL.
 *
 * Guarantees
 *  - ATOMIC: one transaction. Either the whole curriculum (structure, provenance, assessment tables,
 *    retrieval chunks) is written or nothing is, so the database never holds a half-loaded syllabus.
 *  - REPEATABLE: records are upserted by their stable ids; loading the same snapshot twice is a no-op.
 *  - NEVER SILENTLY CHANGES OFFICIAL TEXT: if an objective that already exists would be reworded,
 *    moved or removed — or the source PDF differs from the one previously loaded — the load is
 *    REFUSED with a report, unless the operator passes `acceptChanges`. Learner progress is keyed by
 *    objective id, so a reworded objective could otherwise inherit mastery earned on different text.
 *  - NEVER DELETES LEARNER HISTORY: objectives (and sub-topics) that vanish from a re-extraction are
 *    RETIRED (retired_at), not deleted.
 *  - FAILS LOUDLY: an invalid snapshot is rejected before any SQL runs.
 */

export interface LoadOptions {
  /** Permit changes to records that already exist (reworded/moved/removed objectives, a different PDF). */
  acceptChanges?: boolean;
  /** Compute and return the plan without writing anything. */
  dryRun?: boolean;
  /** Location of the stored source PDF (storage bucket path). `undefined` leaves any stored path untouched. */
  storagePath?: string | null;
  log?: (message: string) => void;
}

export interface ExistingObjective {
  id: string;
  text: string;
  text_hash: string;
  subtopic_id: string;
  competency_row_id: string;
  ordinal_in_subtopic: number;
  ordinal_in_row: number;
  retired_at: Date | string | null;
}

export interface ChangePlan {
  documentExists: boolean;
  /** The same document id was previously loaded from a PDF with a different checksum. */
  sourceChanged: boolean;
  /** Objectives new to the database. Purely additive: allowed without acceptance. */
  added: string[];
  /** Objectives that were retired and are present again. */
  revived: string[];
  /** Same id, different official wording. */
  reworded: Array<{ id: string; before: string; after: string }>;
  /** Same id, different sub-topic, row or position. */
  moved: Array<{ id: string; detail: string }>;
  /** Active objectives that the snapshot no longer contains. They are retired, never deleted. */
  retired: string[];
  unchanged: number;
}

export function requiresAcceptance(plan: ChangePlan): boolean {
  return (
    plan.sourceChanged ||
    plan.reworded.length > 0 ||
    plan.moved.length > 0 ||
    plan.retired.length > 0 ||
    plan.revived.length > 0
  );
}

/** Pure: what would loading `snapshot` over the existing database content change? */
export function planChanges(
  snapshot: CurriculumSnapshot,
  existingSha256: string | null,
  existing: ExistingObjective[],
): ChangePlan {
  const byId = new Map(existing.map((o) => [o.id, o]));
  const inSnapshot = new Set(snapshot.objectives.map((o) => o.id));
  const plan: ChangePlan = {
    documentExists: existingSha256 !== null,
    sourceChanged: existingSha256 !== null && existingSha256 !== snapshot.document.sha256,
    added: [],
    revived: [],
    reworded: [],
    moved: [],
    retired: existing
      .filter((o) => o.retired_at === null && !inSnapshot.has(o.id))
      .map((o) => o.id),
    unchanged: 0,
  };
  for (const o of snapshot.objectives) {
    const before = byId.get(o.id);
    if (!before) {
      plan.added.push(o.id);
      continue;
    }
    let changed = false;
    if (before.text_hash !== o.text_hash) {
      plan.reworded.push({ id: o.id, before: before.text, after: o.text });
      changed = true;
    }
    if (before.retired_at !== null) {
      plan.revived.push(o.id);
      changed = true;
    } else if (
      before.subtopic_id !== o.subtopic_id ||
      before.competency_row_id !== o.competency_row_id ||
      before.ordinal_in_subtopic !== o.ordinal_in_subtopic ||
      before.ordinal_in_row !== o.ordinal_in_row
    ) {
      plan.moved.push({
        id: o.id,
        detail:
          `${before.competency_row_id} #${before.ordinal_in_row} (position ${before.ordinal_in_subtopic}) → ` +
          `${o.competency_row_id} #${o.ordinal_in_row} (position ${o.ordinal_in_subtopic})`,
      });
      changed = true;
    }
    if (!changed) plan.unchanged += 1;
  }
  return plan;
}

const PREVIEW = 12;

export function describePlan(plan: ChangePlan): string {
  const lines: string[] = [];
  if (plan.sourceChanged) {
    lines.push(
      "The source PDF differs from the one previously loaded under this document id (checksum changed).",
    );
  }
  if (plan.reworded.length > 0) {
    lines.push(`${plan.reworded.length} objective(s) would be REWORDED under the same id:`);
    for (const r of plan.reworded.slice(0, PREVIEW))
      lines.push(`    ${r.id}\n      was: ${r.before}\n      now: ${r.after}`);
  }
  if (plan.moved.length > 0) {
    lines.push(
      `${plan.moved.length} objective(s) would MOVE (different sub-topic, row or position):`,
    );
    for (const m of plan.moved.slice(0, PREVIEW)) lines.push(`    ${m.id}: ${m.detail}`);
  }
  if (plan.retired.length > 0) {
    lines.push(
      `${plan.retired.length} active objective(s) are no longer in the curriculum and would be RETIRED:`,
    );
    for (const id of plan.retired.slice(0, PREVIEW)) lines.push(`    ${id}`);
  }
  if (plan.revived.length > 0) {
    lines.push(`${plan.revived.length} retired objective(s) would be REVIVED:`);
    for (const id of plan.revived.slice(0, PREVIEW)) lines.push(`    ${id}`);
  }
  if (plan.added.length > 0) lines.push(`${plan.added.length} new objective(s) would be added.`);
  lines.push(`${plan.unchanged} objective(s) unchanged.`);
  return lines.join("\n");
}

/** Thrown when a load would change existing curriculum records and the operator has not accepted that. */
export class CurriculumChangeError extends Error {
  constructor(readonly plan: ChangePlan) {
    super(
      "Refusing to load: the snapshot would change curriculum records that already exist.\n" +
        `${describePlan(plan)}\n\n` +
        "Learner progress is attached to objective ids, so changes to existing objectives must be a deliberate decision.\n" +
        "Review the list above; if the new extraction is correct, re-run with --accept-changes.",
    );
    this.name = "CurriculumChangeError";
  }
}

/** Thrown when the snapshot itself is structurally unsound. Nothing has been written. */
export class InvalidSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSnapshotError";
  }
}

export interface LoadReport {
  documentId: string;
  dryRun: boolean;
  plan: ChangePlan;
  /** Rows written (inserted or refreshed) per table. Empty for a dry run. */
  written: Record<string, number>;
  chunks: { total: number; new: number; changed: number; removed: number };
  /** Warnings from the post-load integrity audit (errors abort the load before it commits). */
  audit: AuditFinding[];
}

// ── SQL helpers ─────────────────────────────────────────────────────────────────────────────
// Statements are assembled from fixed identifiers (checked below) and bound parameters only.

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
/** Stay well under PostgreSQL's 65 535 bind-parameter limit per statement. */
const PARAMETERS_PER_STATEMENT = 20_000;

function assertIdentifier(name: string): void {
  if (!IDENTIFIER.test(name)) throw new Error(`Unsafe SQL identifier: ${name}`);
}

interface UpsertSpec {
  table: string;
  /** column name → optional SQL cast applied to the bound parameter (e.g. "text::jsonb"). */
  columns: Record<string, string>;
  conflict: string[];
  /** Replace the default `column = excluded.column` assignment, or add one for a column not inserted. */
  assign?: Record<string, string>;
}

async function upsert(
  tx: Db,
  spec: UpsertSpec,
  rows: Array<Record<string, unknown>>,
): Promise<number> {
  if (rows.length === 0) return 0;
  const names = Object.keys(spec.columns);
  for (const name of [spec.table, ...names, ...spec.conflict, ...Object.keys(spec.assign ?? {})])
    assertIdentifier(name);

  const assignments = new Map<string, string>();
  for (const name of names)
    if (!spec.conflict.includes(name)) assignments.set(name, `excluded.${name}`);
  for (const [name, expression] of Object.entries(spec.assign ?? {}))
    assignments.set(name, expression);
  const conflictClause =
    assignments.size === 0
      ? `on conflict (${spec.conflict.join(", ")}) do nothing`
      : `on conflict (${spec.conflict.join(", ")}) do update set ${[...assignments].map(([n, e]) => `${n} = ${e}`).join(", ")}`;

  const perStatement = Math.max(1, Math.floor(PARAMETERS_PER_STATEMENT / names.length));
  for (let start = 0; start < rows.length; start += perStatement) {
    const params: unknown[] = [];
    const tuples = rows.slice(start, start + perStatement).map((row) => {
      const slots = names.map((name) => {
        const value = row[name];
        params.push(value === undefined ? null : value);
        const cast = spec.columns[name];
        return `$${params.length}${cast ? `::${cast}` : ""}`;
      });
      return `(${slots.join(", ")})`;
    });
    await tx.unsafe(
      `insert into public.${spec.table} (${names.join(", ")}) values ${tuples.join(", ")} ${conflictClause}`,
      params as never[],
    );
  }
  return rows.length;
}

const NO_CAST = "";
const cols = (...names: string[]): Record<string, string> =>
  Object.fromEntries(names.map((n) => [n, NO_CAST]));

/** The provenance columns every official record carries. */
function provenance(documentId: string, source: Source, withPageEnd = true) {
  return {
    source_document_id: documentId,
    source_page: source.page,
    ...(withPageEnd ? { source_page_end: source.page_end } : {}),
    source_page_label: source.page_label,
    source_text: source.source_text,
  };
}

const PROVENANCE_COLUMNS = [
  "source_document_id",
  "source_page",
  "source_page_end",
  "source_page_label",
  "source_text",
];
const ASSESSMENT_PROVENANCE_COLUMNS = [
  "source_document_id",
  "source_page",
  "source_page_label",
  "source_text",
];

export async function readExistingState(
  db: Db,
  documentId: string,
): Promise<{ sha256: string | null; objectives: ExistingObjective[] }> {
  const [doc] = await db<
    { sha256: string }[]
  >`select sha256 from public.curriculum_documents where id = ${documentId}`;
  const objectives = await db<ExistingObjective[]>`
    select id, text, text_hash, subtopic_id, competency_row_id, ordinal_in_subtopic, ordinal_in_row, retired_at
    from public.learning_objectives
    where source_document_id = ${documentId}`;
  return { sha256: doc?.sha256 ?? null, objectives: [...objectives] };
}

/** Parse + validate. Throws InvalidSnapshotError listing every problem; never returns an unsound snapshot. */
export function assertLoadable(input: unknown): CurriculumSnapshot {
  const parsed = snapshotSchema.safeParse(input);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 10)
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new InvalidSnapshotError(`The snapshot does not match the snapshot schema:\n${detail}`);
  }
  const issues = validateSnapshot(parsed.data);
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length > 0) {
    throw new InvalidSnapshotError(
      `The snapshot is structurally invalid (${errors.length} error(s)):\n${formatIssues(errors)}`,
    );
  }
  return parsed.data;
}

export async function loadSnapshot(
  sql: Sql,
  input: unknown,
  options: LoadOptions = {},
): Promise<LoadReport> {
  const snapshot = assertLoadable(input);
  const log = options.log ?? (() => {});
  const document = snapshot.document;
  const chunks = buildChunks(snapshot);

  if (options.dryRun) {
    const existing = await readExistingState(sql, document.id);
    const plan = planChanges(snapshot, existing.sha256, existing.objectives);
    return {
      documentId: document.id,
      dryRun: true,
      plan,
      written: {},
      chunks: { total: chunks.length, new: 0, changed: 0, removed: 0 },
      audit: [],
    };
  }

  return sql.begin(async (tx): Promise<LoadReport> => {
    // One load at a time: two concurrent loads would interleave the retire/revive steps below.
    await tx`select pg_advisory_xact_lock(hashtext('zimtutor:curriculum-load'))`;

    const existing = await readExistingState(tx, document.id);
    const plan = planChanges(snapshot, existing.sha256, existing.objectives);
    if (requiresAcceptance(plan) && !options.acceptChanges) throw new CurriculumChangeError(plan);
    if (requiresAcceptance(plan)) log(`Accepting changes:\n${describePlan(plan)}`);

    const written: Record<string, number> = {};
    const record = (table: string, count: number) => {
      written[table] = (written[table] ?? 0) + count;
      log(`  ${table}: ${count}`);
    };

    // Everything this document previously contributed is retired first and revived only if the
    // snapshot still contains it. Ordinals need only be unique among ACTIVE records, so records
    // that swap positions never collide mid-load, and whatever is left over stays retired.
    await tx`update public.subtopics set retired_at = coalesce(retired_at, now()) where source_document_id = ${document.id}`;
    await tx`update public.learning_objectives set retired_at = coalesce(retired_at, now()) where source_document_id = ${document.id}`;

    // ── document, pages ─────────────────────────────────────────────────────────────────────
    record(
      "curriculum_documents",
      await upsert(
        tx,
        {
          table: "curriculum_documents",
          columns: cols(
            "id",
            "title",
            "organisation",
            "curriculum_year",
            "source_type",
            "verification_status",
            "sha256",
            "page_count",
            "extractor_version",
            ...(options.storagePath !== undefined ? ["storage_path"] : []),
          ),
          conflict: ["id"],
          assign: { ingested_at: "now()" },
        },
        [
          {
            id: document.id,
            title: document.title,
            organisation: document.organisation,
            curriculum_year: document.curriculum_year,
            source_type: document.source_type,
            verification_status: document.verification_status,
            sha256: document.sha256,
            page_count: document.page_count,
            extractor_version: document.extractor_version,
            storage_path: options.storagePath,
          },
        ],
      ),
    );
    record(
      "curriculum_document_pages",
      await upsert(
        tx,
        {
          table: "curriculum_document_pages",
          columns: cols("document_id", "page", "page_label", "text"),
          conflict: ["document_id", "page"],
        },
        snapshot.pages.map((p) => ({
          document_id: document.id,
          page: p.page,
          page_label: p.page_label,
          text: p.text,
        })),
      ),
    );
    await tx`delete from public.curriculum_document_pages where document_id = ${document.id} and page > ${document.page_count}`;

    // ── curriculum, grades, subjects, topics ─────────────────────────────────────────────
    const curriculum = snapshot.curriculum;
    record(
      "curricula",
      await upsert(
        tx,
        {
          table: "curricula",
          columns: cols("id", "name", "organisation", "curriculum_year", "document_id"),
          conflict: ["id"],
        },
        [{ ...curriculum }],
      ),
    );
    record(
      "grades",
      await upsert(
        tx,
        {
          table: "grades",
          columns: cols("id", "curriculum_id", "number", "label"),
          conflict: ["id"],
        },
        snapshot.grades.map((g) => ({ ...g, curriculum_id: curriculum.id })),
      ),
    );
    record(
      "subjects",
      await upsert(
        tx,
        { table: "subjects", columns: cols("id", "curriculum_id", "name"), conflict: ["id"] },
        snapshot.subjects.map((s) => ({ ...s, curriculum_id: curriculum.id })),
      ),
    );
    record(
      "topics",
      await upsert(
        tx,
        {
          table: "topics",
          columns: cols(
            "id",
            "grade_id",
            "subject_id",
            "code",
            "name",
            "ordinal",
            "section_number",
            "heading_text",
            "scope_text",
            "scope_max",
            ...PROVENANCE_COLUMNS,
          ),
          conflict: ["id"],
        },
        snapshot.topics.map((t) => ({
          id: t.id,
          grade_id: t.grade_id,
          subject_id: t.subject_id,
          code: t.code,
          name: t.name,
          ordinal: t.ordinal,
          section_number: t.section_number,
          heading_text: t.heading_text,
          scope_text: t.scope_text,
          scope_max: t.scope_max,
          ...provenance(document.id, t.source),
        })),
      ),
    );

    // ── sub-topics, competency rows, objectives ──────────────────────────────────────────
    record(
      "subtopics",
      await upsert(
        tx,
        {
          table: "subtopics",
          columns: cols(
            "id",
            "topic_id",
            "ordinal",
            "name",
            "short_name",
            "slug",
            "group_name",
            "strand_key",
            "retired_at",
            ...PROVENANCE_COLUMNS,
          ),
          conflict: ["id"],
        },
        snapshot.subtopics.map((s) => ({
          id: s.id,
          topic_id: s.topic_id,
          ordinal: s.ordinal,
          name: s.name,
          short_name: s.short_name,
          slug: s.slug,
          group_name: s.group_name,
          strand_key: s.strand_key,
          retired_at: null,
          ...provenance(document.id, s.source),
        })),
      ),
    );
    record(
      "competency_rows",
      await upsert(
        tx,
        {
          table: "competency_rows",
          columns: cols(
            "id",
            "subtopic_id",
            "ordinal",
            "objectives_source_text",
            "content_source_text",
            "activities_source_text",
            "resources_source_text",
            ...PROVENANCE_COLUMNS,
          ),
          conflict: ["id"],
        },
        snapshot.competency_rows.map((r) => ({
          id: r.id,
          subtopic_id: r.subtopic_id,
          ordinal: r.ordinal,
          objectives_source_text: r.objectives_source_text,
          content_source_text: r.content_source_text,
          activities_source_text: r.activities_source_text,
          resources_source_text: r.resources_source_text,
          ...provenance(document.id, r.source),
        })),
      ),
    );
    record(
      "learning_objectives",
      await upsert(
        tx,
        {
          table: "learning_objectives",
          columns: cols(
            "id",
            "subtopic_id",
            "competency_row_id",
            "ordinal_in_subtopic",
            "ordinal_in_row",
            "text",
            "text_hash",
            "retired_at",
            ...PROVENANCE_COLUMNS,
          ),
          conflict: ["id"],
        },
        snapshot.objectives.map((o) => ({
          id: o.id,
          subtopic_id: o.subtopic_id,
          competency_row_id: o.competency_row_id,
          ordinal_in_subtopic: o.ordinal_in_subtopic,
          ordinal_in_row: o.ordinal_in_row,
          text: o.text,
          text_hash: o.text_hash,
          retired_at: null,
          ...provenance(document.id, o.source),
        })),
      ),
    );

    // Questions for an objective that left the curriculum must stop being served. (They are retired,
    // not deleted: attempts reference them. Reviving the objective does not revive them silently.)
    await tx`
      update public.questions q set status = 'RETIRED'
      from public.learning_objectives o
      where q.learning_objective_id = o.id and o.source_document_id = ${document.id}
        and o.retired_at is not null and q.status = 'ACTIVE'`;

    // Rows that left the syllabus and hold no objectives (not even retired ones) are removed;
    // a row that still carries retired objectives stays, as the history they point at.
    const rowIds = snapshot.competency_rows.map((r) => r.id);
    await tx`
      delete from public.competency_rows r
      where r.source_document_id = ${document.id}
        and r.id <> all(${rowIds}::text[])
        and not exists (select 1 from public.learning_objectives o where o.competency_row_id = r.id)`;

    // ── row-level content, activities and resources ─────────────────────────────────────
    for (const [table, items] of [
      ["curriculum_content", snapshot.content],
      ["curriculum_activities", snapshot.activities],
      ["curriculum_resources", snapshot.resources],
    ] as const) {
      record(
        table,
        await upsert(
          tx,
          {
            table,
            columns: cols("id", "competency_row_id", "ordinal", "text", ...PROVENANCE_COLUMNS),
            conflict: ["id"],
          },
          items.map((i) => ({
            id: i.id,
            competency_row_id: i.competency_row_id,
            ordinal: i.ordinal,
            text: i.text,
            ...provenance(document.id, i.source),
          })),
        ),
      );
      // Bullets of rows that are still in the syllabus but are no longer printed there.
      await tx.unsafe(
        `delete from public.${table}
         where source_document_id = $1 and competency_row_id = any($2::text[]) and id <> all($3::text[])`,
        [document.id, rowIds, items.map((i) => i.id)] as never[],
      );
    }

    // ── assessment (syllabus section 9) ─────────────────────────────────────────────────
    const assessment = snapshot.assessment;
    const assessmentTables: Array<{
      table: string;
      columns: string[];
      assign?: Record<string, string>;
      rows: Array<Record<string, unknown>>;
      sources: Source[];
      casts?: Record<string, string>;
    }> = [
      {
        table: "assessment_components",
        columns: ["id", "curriculum_id", "name", "weighting_percent", "details"],
        casts: { details: "text::jsonb" },
        rows: assessment.components.map((c) => ({ ...c, details: JSON.stringify(c.details) })),
        sources: assessment.components.map((c) => c.source),
      },
      {
        table: "assessment_papers",
        columns: [
          "id",
          "curriculum_id",
          "grade",
          "paper_number",
          "description",
          "duration_minutes",
          "marks",
          "paper_weighting_percent",
          "summative_weighting_percent",
          "structure",
        ],
        casts: { structure: "text::jsonb" },
        rows: assessment.papers.map((p) => ({ ...p, structure: JSON.stringify(p.structure) })),
        sources: assessment.papers.map((p) => p.source),
      },
      {
        table: "assessment_skill_bands",
        columns: [
          "id",
          "curriculum_id",
          "paper_number",
          "skill_band",
          "skill_band_code",
          "percent",
        ],
        rows: assessment.skill_bands.map((b) => ({ ...b })),
        sources: assessment.skill_bands.map((b) => b.source),
      },
      {
        table: "assessment_objectives",
        columns: ["id", "curriculum_id", "code", "ordinal", "text"],
        rows: assessment.objectives.map((o) => ({ ...o })),
        sources: assessment.objectives.map((o) => o.source),
      },
      {
        table: "assessment_project_stages",
        columns: ["id", "curriculum_id", "stage", "description", "timeline", "marks"],
        rows: assessment.project_stages.map((p) => ({ ...p })),
        sources: assessment.project_stages.map((p) => p.source),
      },
    ];
    for (const spec of assessmentTables) {
      const rows: Array<Record<string, unknown>> = spec.rows.map((row, index) => ({
        ...row,
        curriculum_id: curriculum.id,
        ...provenance(document.id, spec.sources[index]!, false),
      }));
      record(
        spec.table,
        await upsert(
          tx,
          {
            table: spec.table,
            columns: {
              ...cols(...spec.columns, ...ASSESSMENT_PROVENANCE_COLUMNS),
              ...(spec.casts ?? {}),
            },
            conflict: ["id"],
          },
          rows,
        ),
      );
      await tx.unsafe(
        `delete from public.${spec.table} where curriculum_id = $1 and id <> all($2::text[])`,
        [curriculum.id, rows.map((r) => r["id"])] as never[],
      );
    }

    // ── retrieval chunks (text only; embeddings are produced by curriculum:embed) ─────────
    const chunkStats = await writeChunks(tx, snapshot, chunks);
    record("curriculum_chunks", chunks.length);

    // The independent witness: audit what is now in the tables, and roll the whole load back if it
    // is unsound. Missing embeddings are expected at this point and only warn.
    const findings = await auditCurriculum(tx, { snapshot });
    if (findings.some((f) => f.severity === "error")) throw new CurriculumAuditError(findings);

    return {
      documentId: document.id,
      dryRun: false,
      plan,
      written,
      chunks: chunkStats,
      audit: findings,
    };
  });
}

async function writeChunks(tx: Db, snapshot: CurriculumSnapshot, chunks: ChunkRecord[]) {
  const document = snapshot.document;
  const existing = await tx<{ chunk_key: string; content_hash: string }[]>`
    select chunk_key, content_hash from public.curriculum_chunks where document_id = ${document.id}`;
  const before = new Map(existing.map((c) => [c.chunk_key, c.content_hash]));
  const stats = { total: chunks.length, new: 0, changed: 0, removed: 0 };
  for (const c of chunks) {
    const hash = before.get(c.chunk_key);
    if (hash === undefined) stats.new += 1;
    else if (hash !== c.content_hash) stats.changed += 1;
  }

  // An embedding describes one exact text. When a chunk's text changes its vector is discarded, so
  // retrieval can never match a chunk on text it no longer contains.
  const keepIfUnchanged = (column: string) =>
    `case when public.curriculum_chunks.content_hash = excluded.content_hash then public.curriculum_chunks.${column} end`;
  await upsert(
    tx,
    {
      table: "curriculum_chunks",
      columns: cols(
        "document_id",
        "chunk_key",
        "section_type",
        "page",
        "page_end",
        "grade",
        "subject",
        "topic",
        "topic_code",
        "subtopic",
        "subtopic_id",
        "learning_objective_id",
        "competency_row_id",
        "content",
        "content_hash",
        "source_title",
        "curriculum_year",
      ),
      conflict: ["document_id", "chunk_key"],
      assign: {
        embedding: keepIfUnchanged("embedding"),
        embedding_model: keepIfUnchanged("embedding_model"),
        embedded_at: keepIfUnchanged("embedded_at"),
      },
    },
    chunks.map((c) => ({
      ...c,
      document_id: document.id,
      source_title: document.title,
      curriculum_year: document.curriculum_year,
    })),
  );

  const removed = await tx`
    delete from public.curriculum_chunks
    where document_id = ${document.id} and chunk_key <> all(${chunks.map((c) => c.chunk_key)}::text[])`;
  stats.removed = removed.count;
  return stats;
}
