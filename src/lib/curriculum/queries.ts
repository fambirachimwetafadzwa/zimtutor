import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { assertObjectiveContext, assertTopicMatrix } from "./integrity";
import {
  documentSchema,
  matrixSubtopicSchema,
  objectiveContextSchema,
  rowDetailSchema,
  siblingObjectiveSchema,
  topicSummarySchema,
  TOPIC_CODES,
  type CurriculumDocument,
  type ObjectiveDetail,
  type TopicCode,
  type TopicMatrix,
  type TopicSummary,
} from "./schemas";

/**
 * Curriculum reads for the browser and the learner screens.
 *
 * All functions take the CALLER'S Supabase client: row-level security therefore applies, and no
 * elevated privileges are needed to read the official curriculum. Results are validated (zod and
 * the integrity checks) before being returned.
 */

export class CurriculumQueryError extends Error {
  constructor(what: string, cause: { message: string; code?: string }) {
    super(`Could not load ${what}: ${cause.message}${cause.code ? ` (${cause.code})` : ""}`);
    this.name = "CurriculumQueryError";
  }
}

function unwrap<T>(
  what: string,
  result: { data: T | null; error: { message: string; code?: string } | null },
): T {
  if (result.error) throw new CurriculumQueryError(what, result.error);
  if (result.data === null) throw new CurriculumQueryError(what, { message: "no data returned" });
  return result.data;
}

/** The four topics of every grade, in syllabus order, with counts. */
export async function listTopicSummaries(
  db: SupabaseClient,
  grade?: number,
): Promise<TopicSummary[]> {
  let query = db.from("v_topic_summary").select("*").order("grade").order("topic_ordinal");
  if (grade !== undefined) query = query.eq("grade", grade);
  const rows = unwrap("the topic summaries", await query);
  return z.array(topicSummarySchema).parse(rows);
}

/** One topic of one grade, with every active sub-topic, printed row and objective beneath it. */
export async function getTopicMatrix(
  db: SupabaseClient,
  grade: number,
  code: TopicCode,
): Promise<TopicMatrix | null> {
  const summary = await listTopicSummaries(db, grade);
  const topic = summary.find((t) => t.topic_code === code);
  if (!topic) return null;

  const rows = unwrap(
    `the sub-topics of ${topic.topic_id}`,
    await db
      .from("subtopics")
      .select(
        `id, ordinal, name, short_name, group_name, source_page, source_page_end, source_page_label,
         competency_rows (
           id, ordinal, source_page, source_page_end, source_page_label,
           learning_objectives ( id, ordinal_in_row, ordinal_in_subtopic, text, retired_at, source_page, source_page_end, source_page_label ),
           curriculum_content ( id, ordinal, text ),
           curriculum_activities ( id, ordinal, text ),
           curriculum_resources ( id, ordinal, text )
         )`,
      )
      .eq("topic_id", topic.topic_id)
      .is("retired_at", null)
      .is("competency_rows.learning_objectives.retired_at", null)
      .order("ordinal")
      .order("ordinal", { referencedTable: "competency_rows" })
      .order("ordinal_in_row", { referencedTable: "competency_rows.learning_objectives" })
      .order("ordinal", { referencedTable: "competency_rows.curriculum_content" })
      .order("ordinal", { referencedTable: "competency_rows.curriculum_activities" })
      .order("ordinal", { referencedTable: "competency_rows.curriculum_resources" }),
  );
  const subtopics = z.array(matrixSubtopicSchema).parse(rows);
  // Rows that carry only retired objectives are history, not part of the current curriculum.
  const active = subtopics.map((s) => ({
    ...s,
    competency_rows: s.competency_rows.filter((r) => r.learning_objectives.length > 0),
  }));
  return assertTopicMatrix({ topic, subtopics: active }, { grade, code });
}

export async function getCurriculumDocument(
  db: SupabaseClient,
  id?: string,
): Promise<CurriculumDocument | null> {
  let query = db
    .from("curriculum_documents")
    .select(
      "id, title, organisation, curriculum_year, source_type, verification_status, sha256, page_count, extractor_version, ingested_at, storage_path",
    );
  if (id) query = query.eq("id", id);
  const rows = unwrap(
    "the source document",
    await query.order("ingested_at", { ascending: false }).limit(1),
  );
  const first = rows[0];
  return first ? documentSchema.parse(first) : null;
}

/** Everything the objective page shows. Returns null when the objective does not exist (or is not visible). */
export async function getObjectiveDetail(
  db: SupabaseClient,
  objectiveId: string,
): Promise<ObjectiveDetail | null> {
  const contextResult = await db
    .from("v_objective_context")
    .select("*")
    .eq("objective_id", objectiveId)
    .maybeSingle();
  if (contextResult.error)
    throw new CurriculumQueryError(`objective ${objectiveId}`, contextResult.error);
  if (!contextResult.data) return null;
  const context = assertObjectiveContext(objectiveContextSchema.parse(contextResult.data));

  const [document, row, siblings, chunk] = await Promise.all([
    getCurriculumDocument(db, context.source_document_id),
    db
      .from("competency_rows")
      .select(
        `id, ordinal, objectives_source_text, content_source_text, activities_source_text, resources_source_text,
         source_text, source_page, source_page_end, source_page_label,
         curriculum_content ( id, ordinal, text ),
         curriculum_activities ( id, ordinal, text ),
         curriculum_resources ( id, ordinal, text )`,
      )
      .eq("id", context.competency_row_id)
      .order("ordinal", { referencedTable: "curriculum_content" })
      .order("ordinal", { referencedTable: "curriculum_activities" })
      .order("ordinal", { referencedTable: "curriculum_resources" })
      .single(),
    db
      .from("learning_objectives")
      .select("id, ordinal_in_subtopic, ordinal_in_row, competency_row_id, text")
      .eq("subtopic_id", context.subtopic_id)
      .is("retired_at", null)
      .order("ordinal_in_subtopic"),
    db
      .from("curriculum_chunks")
      .select("content, embedding_model")
      .eq("learning_objective_id", objectiveId)
      .eq("section_type", "COMPETENCY_OBJECTIVE")
      .maybeSingle(),
  ]);
  if (!document)
    throw new CurriculumQueryError(`the source document of ${objectiveId}`, {
      message: "not found",
    });
  if (row.error) throw new CurriculumQueryError(`the competency row of ${objectiveId}`, row.error);
  if (siblings.error)
    throw new CurriculumQueryError(`the sub-topic of ${objectiveId}`, siblings.error);
  if (chunk.error)
    throw new CurriculumQueryError(`the retrieval chunk of ${objectiveId}`, chunk.error);

  return {
    context,
    document,
    row: rowDetailSchema.parse(row.data),
    siblings: z.array(siblingObjectiveSchema).parse(siblings.data),
    chunk: chunk.data
      ? {
          content: String(chunk.data.content),
          embeddingModel: (chunk.data.embedding_model as string | null) ?? null,
        }
      : null,
  };
}

export interface ObjectiveHit {
  objective_id: string;
  objective_text: string;
  grade: number;
  topic_code: TopicCode;
  topic_name: string;
  subtopic_short_name: string;
}

const hitSchema = z.object({
  objective_id: z.string(),
  objective_text: z.string(),
  grade: z.number().int(),
  topic_code: z.enum(TOPIC_CODES),
  topic_name: z.string(),
  subtopic_short_name: z.string(),
});

/** Plain-text search over objective wording, newest grades last. */
export async function searchObjectives(
  db: SupabaseClient,
  text: string,
  limit = 50,
): Promise<ObjectiveHit[]> {
  // Strip characters that have meaning in PostgREST filter syntax or LIKE patterns.
  const term = text
    .replace(/[%_*,().\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (term.length < 2) return [];
  const rows = unwrap(
    "the objective search",
    await db
      .from("v_objective_context")
      .select("objective_id, objective_text, grade, topic_code, topic_name, subtopic_short_name")
      .is("retired_at", null)
      .ilike("objective_text", `%${term}%`)
      .order("grade")
      .order("objective_id")
      .limit(limit),
  );
  return z.array(hitSchema).parse(rows);
}

/** The documents ZimTutor has ingested (the only documents that can be cited as official). */
export async function listDocuments(
  db: SupabaseClient,
): Promise<Array<{ id: string; title: string }>> {
  const rows = unwrap(
    "the source documents",
    await db.from("curriculum_documents").select("id, title").order("title"),
  );
  return z.array(z.object({ id: z.string(), title: z.string() })).parse(rows);
}
