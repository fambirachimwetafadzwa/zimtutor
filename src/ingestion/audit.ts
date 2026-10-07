import type { Db } from "../lib/db/types";
import { textHash } from "./ids";
import type { CurriculumSnapshot } from "./snapshot";

/**
 * Audit of the curriculum AS LOADED IN THE DATABASE (spec §21).
 *
 * validate.ts checks a snapshot file before loading; this module checks the live tables afterwards,
 * so a hand-edited row, a partial restore or a buggy later migration is caught too. The loader runs
 * it inside its own transaction and rolls back on any error, so an unsound curriculum can never be
 * committed; `npm run curriculum:audit` runs it on demand.
 *
 * Most relationships are also guaranteed by foreign keys and CHECK constraints — they are verified
 * again here on purpose: the audit is the independent witness that the guarantees hold.
 */

export interface AuditFinding {
  severity: "error" | "warning";
  code: string;
  message: string;
  count: number;
  examples: string[];
}

export interface AuditOptions {
  /** Grades that must exist. Defaults to Grade 3–7. */
  expectedGrades?: number[];
  /** When given, the database content must equal this snapshot (objectives, text hashes, structure ids). */
  snapshot?: CurriculumSnapshot;
  /** Treat chunks without an embedding as an error (default: a warning). */
  requireEmbeddings?: boolean;
  /** Warn when stored vectors were produced by a different embedding model than this. */
  expectedEmbeddingModel?: string;
}

const MAX_EXAMPLES = 8;

/** Every table that carries official provenance (assessment tables have no end page). */
const SOURCED_TABLES = [
  "topics",
  "subtopics",
  "competency_rows",
  "learning_objectives",
  "curriculum_content",
  "curriculum_activities",
  "curriculum_resources",
  "assessment_components",
  "assessment_papers",
  "assessment_skill_bands",
  "assessment_objectives",
  "assessment_project_stages",
] as const;

interface QueryCheck {
  severity: "error" | "warning";
  code: string;
  message: string;
  /** Returns one row per offender, with a text column `ref`. */
  query: string;
}

function sourcedUnion(where: (table: string, endPage: string) => string): string {
  return SOURCED_TABLES.map((table) => {
    const endPage = table.startsWith("assessment_")
      ? "t.source_page"
      : "coalesce(t.source_page_end, t.source_page)";
    return `select '${table}:' || t.id as ref
            from public.${table} t join public.curriculum_documents d on d.id = t.source_document_id
            where ${where(table, endPage)}`;
  }).join("\nunion all\n");
}

function ordinalGap(table: string, group: string, ordinal: string, active = "") {
  return `select t.${group} as ref from public.${table} t ${active ? `where ${active}` : ""}
          group by t.${group} having min(t.${ordinal}) <> 1 or max(t.${ordinal}) <> count(*)`;
}

function queryChecks(expectedGrades: number[]): QueryCheck[] {
  const grades = expectedGrades.map((n) => Math.trunc(n)).join(",");
  const err = "error" as const;
  const warn = "warning" as const;
  return [
    // ── hierarchy ─────────────────────────────────────────────────────────────────────────
    {
      severity: err,
      code: "MISSING_GRADE",
      message: "Expected grades are missing",
      query: `select 'G' || n as ref from unnest(array[${grades}]::int[]) as n
              where not exists (select 1 from public.grades g where g.number = n)`,
    },
    {
      severity: err,
      code: "MISSING_TOPIC",
      message:
        "A grade lacks one of the four official topics (Number, Operations, Measures, Relationships)",
      query: `select g.id || '-' || c.code as ref
              from public.grades g cross join (values ('NUM'), ('OPS'), ('MEA'), ('REL')) as c(code)
              where not exists (select 1 from public.topics t where t.grade_id = g.id and t.code = c.code)`,
    },
    {
      severity: err,
      code: "INVALID_TOPIC",
      message: "A topic's name or id disagrees with its grade and code",
      query: `select t.id as ref from public.topics t join public.grades g on g.id = t.grade_id
              where t.id <> g.id || '-' || t.code
                 or (t.code, t.name) not in (('NUM', 'Number'), ('OPS', 'Operations'), ('MEA', 'Measures'), ('REL', 'Relationships'))`,
    },
    {
      severity: err,
      code: "TOPIC_WITHOUT_SUBTOPICS",
      message: "A topic has no active sub-topics",
      query: `select t.id as ref from public.topics t
              where not exists (select 1 from public.subtopics s where s.topic_id = t.id and s.retired_at is null)`,
    },
    {
      severity: err,
      code: "ORPHAN_SUBTOPIC",
      message: "A sub-topic has no parent topic, or its id does not belong to its topic",
      query: `select s.id as ref from public.subtopics s left join public.topics t on t.id = s.topic_id
              where t.id is null or left(s.id, length(t.id) + 1) <> t.id || '-'`,
    },
    {
      severity: err,
      code: "SUBTOPIC_WITHOUT_ROWS",
      message: "An active sub-topic has no competency rows",
      query: `select s.id as ref from public.subtopics s
              where s.retired_at is null and not exists (select 1 from public.competency_rows r where r.subtopic_id = s.id)`,
    },
    {
      severity: err,
      code: "SUBTOPIC_WITHOUT_OBJECTIVES",
      message: "An active sub-topic has no active learning objectives",
      query: `select s.id as ref from public.subtopics s
              where s.retired_at is null
                and not exists (select 1 from public.learning_objectives o where o.subtopic_id = s.id and o.retired_at is null)`,
    },
    {
      severity: err,
      code: "ROW_WITHOUT_OBJECTIVES",
      message: "A competency row has no learning objectives at all",
      query: `select r.id as ref from public.competency_rows r
              where not exists (select 1 from public.learning_objectives o where o.competency_row_id = r.id)`,
    },
    {
      severity: err,
      code: "ORPHAN_OBJECTIVE",
      message:
        "A learning objective has no sub-topic, or its competency row belongs to a different sub-topic",
      query: `select o.id as ref from public.learning_objectives o
              left join public.subtopics s on s.id = o.subtopic_id
              left join public.competency_rows r on r.id = o.competency_row_id and r.subtopic_id = o.subtopic_id
              where s.id is null or r.id is null`,
    },
    {
      severity: err,
      code: "ORPHAN_ITEM",
      message: "Content, activities or resources point at a competency row that does not exist",
      query: ["curriculum_content", "curriculum_activities", "curriculum_resources"]
        .map(
          (table) => `select '${table}:' || t.id as ref from public.${table} t
                      left join public.competency_rows r on r.id = t.competency_row_id where r.id is null`,
        )
        .join("\nunion all\n"),
    },
    {
      severity: err,
      code: "INVALID_OBJECTIVE_ID",
      message: "An objective id does not match its sub-topic and position",
      query: `select o.id as ref from public.learning_objectives o
              where o.retired_at is null
                and o.id <> o.subtopic_id || '-' || lpad(o.ordinal_in_subtopic::text, 3, '0')`,
    },
    // ── ordering ──────────────────────────────────────────────────────────────────────────
    {
      severity: err,
      code: "ORDINAL_GAP",
      message: "Positions are not 1..n without gaps",
      query: [
        ordinalGap(
          "learning_objectives",
          "subtopic_id",
          "ordinal_in_subtopic",
          "t.retired_at is null",
        ),
        ordinalGap(
          "learning_objectives",
          "competency_row_id",
          "ordinal_in_row",
          "t.retired_at is null",
        ),
        ordinalGap("subtopics", "topic_id", "ordinal", "t.retired_at is null"),
        ordinalGap("competency_rows", "subtopic_id", "ordinal"),
        ordinalGap("curriculum_content", "competency_row_id", "ordinal"),
        ordinalGap("curriculum_activities", "competency_row_id", "ordinal"),
        ordinalGap("curriculum_resources", "competency_row_id", "ordinal"),
      ].join("\nunion all\n"),
    },
    {
      severity: warn,
      code: "DUPLICATE_OBJECTIVE_TEXT",
      message:
        "Two active objectives of one sub-topic have identical wording (the syllabus itself sometimes repeats an objective)",
      query: `select min(o.id) || ' = ' || max(o.id) as ref from public.learning_objectives o
              where o.retired_at is null
              group by o.subtopic_id, lower(regexp_replace(btrim(o.text), '\\s+', ' ', 'g'))
              having count(*) > 1`,
    },
    // ── provenance ────────────────────────────────────────────────────────────────────────
    {
      severity: err,
      code: "MISSING_SOURCE_PAGE",
      message: "A record cites a page outside the source document",
      query: sourcedUnion(
        (_, end) =>
          `t.source_page < 1 or t.source_page > d.page_count or ${end} < t.source_page or ${end} > d.page_count`,
      ),
    },
    {
      severity: warn,
      code: "MISSING_PAGE_LABEL",
      message: "A record has no printed page label",
      query: sourcedUnion(() => "t.source_page_label is null"),
    },
    {
      severity: err,
      code: "PROVENANCE_VIOLATION",
      message:
        "Official content is not marked OFFICIAL_CURRICULUM / VERIFIED_FROM_SOURCE, or has no verbatim source text",
      query: sourcedUnion(
        () =>
          "t.source_type <> 'OFFICIAL_CURRICULUM' or t.verification_status <> 'VERIFIED_FROM_SOURCE' or btrim(t.source_text) = ''",
      ),
    },
    {
      severity: err,
      code: "PAGE_OUTSIDE_TOPIC",
      message: "An objective cites a page that belongs to a different topic's matrix",
      query: `with spans as (
                select t.id, t.source_page as first_page,
                       coalesce(lead(t.source_page) over (order by t.source_page, t.id), d.page_count) as last_page
                from public.topics t join public.curriculum_documents d on d.id = t.source_document_id
              )
              select o.id as ref
              from public.learning_objectives o
              join public.subtopics s on s.id = o.subtopic_id
              join spans on spans.id = s.topic_id
              where o.retired_at is null
                and (o.source_page < spans.first_page or coalesce(o.source_page_end, o.source_page) > spans.last_page)`,
    },
    // ── questions that depend on the curriculum ───────────────────────────────────────────
    {
      severity: err,
      code: "QUESTION_TAG_MISMATCH",
      message:
        "A question's grade/topic/sub-topic tags disagree with the learning objective it assesses",
      query: `select q.id::text as ref
              from public.questions q
              join public.learning_objectives o on o.id = q.learning_objective_id
              join public.subtopics s on s.id = o.subtopic_id
              join public.topics t on t.id = s.topic_id
              join public.grades g on g.id = t.grade_id
              where q.grade <> g.number or q.topic_code <> t.code or q.subtopic_id <> s.id`,
    },
    {
      severity: err,
      code: "ACTIVE_QUESTION_ON_RETIRED_OBJECTIVE",
      message:
        "A question that can be served assesses an objective that is no longer in the curriculum",
      query: `select q.id::text as ref from public.questions q
              join public.learning_objectives o on o.id = q.learning_objective_id
              where q.status = 'ACTIVE' and o.retired_at is not null`,
    },
    // ── retrieval chunks ──────────────────────────────────────────────────────────────────
    {
      severity: err,
      code: "OBJECTIVE_WITHOUT_CHUNK",
      message: "An active objective has no retrieval chunk",
      query: `select o.id as ref from public.learning_objectives o
              where o.retired_at is null
                and not exists (select 1 from public.curriculum_chunks c
                                where c.learning_objective_id = o.id and c.section_type = 'COMPETENCY_OBJECTIVE')`,
    },
    {
      severity: err,
      code: "ORPHAN_CHUNK",
      message: "A competency chunk refers to an objective that is missing or retired",
      query: `select c.chunk_key as ref from public.curriculum_chunks c
              where c.section_type = 'COMPETENCY_OBJECTIVE'
                and not exists (select 1 from public.learning_objectives o where o.id = c.learning_objective_id and o.retired_at is null)`,
    },
    {
      severity: err,
      code: "CHUNK_METADATA_MISMATCH",
      message:
        "A chunk's grade/topic/sub-topic metadata disagrees with the objective it belongs to",
      query: `select c.chunk_key as ref
              from public.curriculum_chunks c
              join public.learning_objectives o on o.id = c.learning_objective_id
              join public.subtopics s on s.id = o.subtopic_id
              join public.topics t on t.id = s.topic_id
              join public.grades g on g.id = t.grade_id
              where c.grade is distinct from g.number
                 or c.topic_code is distinct from t.code
                 or c.topic is distinct from t.name
                 or c.subtopic_id is distinct from s.id
                 or c.competency_row_id is distinct from o.competency_row_id`,
    },
    {
      severity: err,
      code: "CHUNK_TEXT_STALE",
      message: "A chunk does not contain the official wording of its objective",
      query: `select c.chunk_key as ref from public.curriculum_chunks c
              join public.learning_objectives o on o.id = c.learning_objective_id
              where position(o.text in c.content) = 0`,
    },
    {
      severity: err,
      code: "CHUNK_HASH_MISMATCH",
      message: "A chunk's content hash does not match its content",
      query: `select c.chunk_key as ref from public.curriculum_chunks c
              where c.content_hash <> encode(sha256(convert_to(c.content, 'UTF8')), 'hex')`,
    },
  ];
}

export async function auditCurriculum(db: Db, options: AuditOptions = {}): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const add = (
    severity: AuditFinding["severity"],
    code: string,
    message: string,
    refs: string[],
  ) => {
    if (refs.length === 0) return;
    findings.push({
      severity,
      code,
      message,
      count: refs.length,
      examples: refs.slice(0, MAX_EXAMPLES),
    });
  };

  for (const check of queryChecks(options.expectedGrades ?? [3, 4, 5, 6, 7])) {
    const rows = await db.unsafe<Array<{ ref: string }>>(check.query);
    add(
      check.severity,
      check.code,
      check.message,
      rows.map((r) => r.ref),
    );
  }

  // Stored hashes must match the stored wording (detects an edit that bypassed the loader).
  const objectives = await db<Array<{ id: string; text: string; text_hash: string }>>`
    select id, text, text_hash from public.learning_objectives`;
  add(
    "error",
    "TEXT_HASH_MISMATCH",
    "An objective's stored text hash does not match its wording",
    objectives.filter((o) => o.text_hash !== textHash(o.text)).map((o) => o.id),
  );

  // ── embeddings ────────────────────────────────────────────────────────────────────────────
  const [unembedded] = await db<Array<{ missing: number }>>`
    select count(*)::int as missing from public.curriculum_chunks where embedding is null`;
  const missing = unembedded?.missing ?? 0;
  if (missing > 0) {
    add(
      options.requireEmbeddings ? "error" : "warning",
      "CHUNK_NOT_EMBEDDED",
      "Chunks have no embedding yet (run `npm run curriculum:embed`); vector retrieval cannot see them",
      [`${missing} chunk(s)`],
    );
  }
  const models = await db<Array<{ model: string }>>`
    select distinct embedding_model as model from public.curriculum_chunks where embedding is not null order by 1`;
  if (models.length > 1) {
    add(
      "error",
      "MIXED_EMBEDDING_MODELS",
      "Chunks are embedded with different models; similarities between them are meaningless (re-run `npm run curriculum:embed`)",
      models.map((m) => m.model),
    );
  } else if (
    models.length === 1 &&
    options.expectedEmbeddingModel &&
    models[0]!.model !== options.expectedEmbeddingModel
  ) {
    add(
      "warning",
      "EMBEDDING_MODEL_CHANGED",
      "Stored vectors come from a different embedding model than the configured one (re-run `npm run curriculum:embed`)",
      [`stored ${models[0]!.model}, configured ${options.expectedEmbeddingModel}`],
    );
  }

  if (options.snapshot) await compareWithSnapshot(db, options.snapshot, add);
  return findings;
}

type Add = (
  severity: AuditFinding["severity"],
  code: string,
  message: string,
  refs: string[],
) => void;

/** The database must contain exactly what the snapshot describes. */
async function compareWithSnapshot(db: Db, snapshot: CurriculumSnapshot, add: Add) {
  const documentId = snapshot.document.id;
  const sets: Array<{
    what: string;
    db: Promise<Array<{ id: string; h?: string }>>;
    snap: Array<{ id: string; h?: string }>;
  }> = [
    {
      what: "learning objectives",
      db: db`select id, text_hash as h from public.learning_objectives where source_document_id = ${documentId} and retired_at is null`,
      snap: snapshot.objectives.map((o) => ({ id: o.id, h: o.text_hash })),
    },
    {
      what: "sub-topics",
      db: db`select id from public.subtopics where source_document_id = ${documentId} and retired_at is null`,
      snap: snapshot.subtopics.map((s) => ({ id: s.id })),
    },
    {
      what: "competency rows",
      db: db`select r.id from public.competency_rows r
             where r.source_document_id = ${documentId}
               and exists (select 1 from public.learning_objectives o where o.competency_row_id = r.id and o.retired_at is null)`,
      snap: snapshot.competency_rows.map((r) => ({ id: r.id })),
    },
    {
      what: "content items",
      db: db`select c.id from public.curriculum_content c
             where c.source_document_id = ${documentId}
               and exists (select 1 from public.learning_objectives o where o.competency_row_id = c.competency_row_id and o.retired_at is null)`,
      snap: snapshot.content.map((c) => ({ id: c.id })),
    },
    {
      what: "activities",
      db: db`select c.id from public.curriculum_activities c
             where c.source_document_id = ${documentId}
               and exists (select 1 from public.learning_objectives o where o.competency_row_id = c.competency_row_id and o.retired_at is null)`,
      snap: snapshot.activities.map((c) => ({ id: c.id })),
    },
    {
      what: "resources",
      db: db`select c.id from public.curriculum_resources c
             where c.source_document_id = ${documentId}
               and exists (select 1 from public.learning_objectives o where o.competency_row_id = c.competency_row_id and o.retired_at is null)`,
      snap: snapshot.resources.map((c) => ({ id: c.id })),
    },
  ];
  for (const { what, db: loaded, snap } of sets) {
    const inDb = new Map((await loaded).map((r) => [r.id, r.h]));
    const inSnap = new Map(snap.map((r) => [r.id, r.h]));
    add(
      "error",
      "SNAPSHOT_MISMATCH",
      `${what} in the snapshot are missing from the database`,
      [...inSnap.keys()].filter((id) => !inDb.has(id)),
    );
    add(
      "error",
      "SNAPSHOT_MISMATCH",
      `${what} in the database are not in the snapshot`,
      [...inDb.keys()].filter((id) => !inSnap.has(id)),
    );
    add(
      "error",
      "SNAPSHOT_MISMATCH",
      `${what} differ in wording from the snapshot`,
      [...inSnap]
        .filter(([id, h]) => h !== undefined && inDb.has(id) && inDb.get(id) !== h)
        .map(([id]) => id),
    );
  }
}

export function formatFindings(findings: AuditFinding[]): string {
  return findings
    .map((f) => {
      const shown = f.examples.join(", ");
      const more = f.count > f.examples.length ? ` … and ${f.count - f.examples.length} more` : "";
      return `  ${f.severity === "error" ? "ERROR  " : "warning"} [${f.code}] ${f.message}\n           ${f.count} found: ${shown}${more}`;
    })
    .join("\n");
}

export class CurriculumAuditError extends Error {
  constructor(readonly findings: AuditFinding[]) {
    super(
      `The curriculum failed its integrity audit:\n${formatFindings(findings.filter((f) => f.severity === "error"))}`,
    );
    this.name = "CurriculumAuditError";
  }
}
