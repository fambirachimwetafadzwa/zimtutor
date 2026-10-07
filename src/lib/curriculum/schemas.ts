import { z } from "zod";

/**
 * Shapes of curriculum data as the application reads it (through the user's own Supabase client, so
 * row-level security applies). Every query result is parsed against these schemas: a row that does
 * not look the way the database promises is a bug or corruption, and fails loudly instead of being
 * rendered.
 */

export const TOPIC_CODES = ["NUM", "OPS", "MEA", "REL"] as const;
export type TopicCode = (typeof TOPIC_CODES)[number];

export const TOPIC_NAMES: Record<TopicCode, string> = {
  NUM: "Number",
  OPS: "Operations",
  MEA: "Measures",
  REL: "Relationships",
};

/** URL segment for a topic: "num", "ops", "mea", "rel". */
export const topicSlug = (code: TopicCode) => code.toLowerCase();
export function topicCodeFromSlug(slug: string): TopicCode | null {
  const code = slug.toUpperCase();
  return (TOPIC_CODES as readonly string[]).includes(code) ? (code as TopicCode) : null;
}

export const GRADES = [3, 4, 5, 6, 7] as const;

const topicCode = z.enum(TOPIC_CODES);

/** Page citation columns carried by every official record. */
const citation = {
  source_page: z.number().int().positive(),
  source_page_end: z.number().int().positive().nullable().optional(),
  source_page_label: z.string().nullable(),
};

export const topicSummarySchema = z.object({
  topic_id: z.string(),
  grade_id: z.string(),
  grade: z.number().int(),
  topic_code: topicCode,
  topic_name: z.string(),
  topic_ordinal: z.number().int(),
  section_number: z.string(),
  heading_text: z.string(),
  scope_text: z.string().nullable(),
  source_page: z.number().int().positive(),
  source_page_label: z.string().nullable(),
  subtopic_count: z.number().int().nonnegative(),
  objective_count: z.number().int().nonnegative(),
});
export type TopicSummary = z.infer<typeof topicSummarySchema>;

const rowItem = z.object({ id: z.string(), ordinal: z.number().int(), text: z.string() });

export const matrixObjectiveSchema = z.object({
  id: z.string(),
  ordinal_in_row: z.number().int(),
  ordinal_in_subtopic: z.number().int(),
  text: z.string(),
  retired_at: z.string().nullable(),
  ...citation,
});

export const matrixRowSchema = z.object({
  id: z.string(),
  ordinal: z.number().int(),
  ...citation,
  learning_objectives: z.array(matrixObjectiveSchema),
  curriculum_content: z.array(rowItem),
  curriculum_activities: z.array(rowItem),
  curriculum_resources: z.array(rowItem),
});

export const matrixSubtopicSchema = z.object({
  id: z.string(),
  ordinal: z.number().int(),
  name: z.string(),
  short_name: z.string(),
  group_name: z.string().nullable(),
  ...citation,
  competency_rows: z.array(matrixRowSchema),
});
export type MatrixSubtopic = z.infer<typeof matrixSubtopicSchema>;
export type MatrixRow = z.infer<typeof matrixRowSchema>;
export type MatrixObjective = z.infer<typeof matrixObjectiveSchema>;

export interface TopicMatrix {
  topic: TopicSummary;
  subtopics: MatrixSubtopic[];
}

export const objectiveContextSchema = z.object({
  objective_id: z.string(),
  objective_text: z.string(),
  ordinal_in_subtopic: z.number().int(),
  ordinal_in_row: z.number().int(),
  retired_at: z.string().nullable(),
  competency_row_id: z.string(),
  subtopic_id: z.string(),
  subtopic_name: z.string(),
  subtopic_short_name: z.string(),
  subtopic_group_name: z.string().nullable(),
  strand_key: z.string(),
  topic_id: z.string(),
  topic_code: topicCode,
  topic_name: z.string(),
  topic_scope_text: z.string().nullable(),
  grade_id: z.string(),
  grade: z.number().int(),
  subject_id: z.string(),
  subject_name: z.string(),
  source_document_id: z.string(),
  source_title: z.string(),
  organisation: z.string(),
  curriculum_year: z.string(),
  source_page: z.number().int().positive(),
  source_page_end: z.number().int().positive().nullable(),
  source_page_label: z.string().nullable(),
  source_text: z.string(),
  source_type: z.string(),
  verification_status: z.string(),
});
export type ObjectiveContext = z.infer<typeof objectiveContextSchema>;

export const documentSchema = z.object({
  id: z.string(),
  title: z.string(),
  organisation: z.string(),
  curriculum_year: z.string(),
  source_type: z.string(),
  verification_status: z.string(),
  sha256: z.string(),
  page_count: z.number().int(),
  extractor_version: z.string(),
  ingested_at: z.string(),
  storage_path: z.string().nullable(),
});
export type CurriculumDocument = z.infer<typeof documentSchema>;

export const siblingObjectiveSchema = z.object({
  id: z.string(),
  ordinal_in_subtopic: z.number().int(),
  ordinal_in_row: z.number().int(),
  competency_row_id: z.string(),
  text: z.string(),
});
export type SiblingObjective = z.infer<typeof siblingObjectiveSchema>;

export const rowDetailSchema = z.object({
  id: z.string(),
  ordinal: z.number().int(),
  objectives_source_text: z.string(),
  content_source_text: z.string(),
  activities_source_text: z.string(),
  resources_source_text: z.string(),
  source_text: z.string(),
  ...citation,
  curriculum_content: z.array(rowItem),
  curriculum_activities: z.array(rowItem),
  curriculum_resources: z.array(rowItem),
});
export type RowDetail = z.infer<typeof rowDetailSchema>;

export interface ObjectiveDetail {
  context: ObjectiveContext;
  document: CurriculumDocument;
  row: RowDetail;
  /** Objectives of the sub-topic in printed order, for previous/next navigation and "same row" lists. */
  siblings: SiblingObjective[];
  /** The exact text the tutor retrieves for this objective (RAG chunk), if one has been built. */
  chunk: { content: string; embeddingModel: string | null } | null;
}
