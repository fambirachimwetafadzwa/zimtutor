import { z } from "zod";

/**
 * The canonical output of curriculum extraction ("snapshot").
 *
 * Properties that matter:
 *  - DETERMINISTIC: no timestamps or machine-specific values, arrays in document order, so running
 *    the extractor twice on the same PDF yields byte-identical JSON (repeatability is testable);
 *  - PROVENANCE-RICH: every record carries the PDF page(s), the printed page label and the verbatim
 *    source text it was parsed from;
 *  - SELF-CHECKING: validate.ts re-derives the relationships and refuses an inconsistent snapshot.
 *
 * IDs here are APPLICATION identifiers. They are never presented as official Ministry identifiers.
 */

export const SNAPSHOT_SCHEMA_VERSION = 1;
export const EXTRACTOR_VERSION = "1.0.0";

export const TOPIC_CODES = ["NUM", "OPS", "MEA", "REL"] as const;
export type TopicCode = (typeof TOPIC_CODES)[number];

export const TOPIC_NAMES: Record<TopicCode, string> = {
  NUM: "Number",
  OPS: "Operations",
  MEA: "Measures",
  REL: "Relationships",
};

/** Where a record came from. `page` is the 1-based PDF page; `page_label` is what is printed on it. */
export const sourceSchema = z
  .object({
    page: z.number().int().positive(),
    page_end: z.number().int().positive().nullable(),
    page_label: z.string().nullable(),
    source_text: z.string().min(1),
  })
  .strict();
export type Source = z.infer<typeof sourceSchema>;

const normalizations = z.array(z.string()).default([]);

const documentSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    title: z.string().min(1),
    organisation: z.string().min(1),
    curriculum_year: z.string().min(1),
    source_type: z.literal("OFFICIAL_CURRICULUM"),
    verification_status: z.literal("VERIFIED_FROM_SOURCE"),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    page_count: z.number().int().positive(),
    extractor_version: z.string(),
    /** The stem printed in the OBJECTIVES column header. */
    objective_stem: z.string(),
  })
  .strict();

const topicSchema = z
  .object({
    id: z.string().regex(/^G\d{1,2}-(NUM|OPS|MEA|REL)$/),
    grade_id: z.string(),
    subject_id: z.string(),
    code: z.enum(TOPIC_CODES),
    name: z.string(),
    ordinal: z.number().int().min(1).max(4),
    section_number: z.string(),
    heading_text: z.string(),
    scope_text: z.string().nullable(),
    scope_max: z.number().nullable(),
    source: sourceSchema,
  })
  .strict();

const subtopicSchema = z
  .object({
    id: z.string(),
    topic_id: z.string(),
    ordinal: z.number().int().positive(),
    name: z.string().min(1),
    short_name: z.string().min(1),
    slug: z.string().min(1),
    group_name: z.string().nullable(),
    strand_key: z.string().min(1),
    source: sourceSchema,
  })
  .strict();

const rowSchema = z
  .object({
    id: z.string(),
    subtopic_id: z.string(),
    ordinal: z.number().int().positive(),
    objectives_source_text: z.string(),
    content_source_text: z.string(),
    activities_source_text: z.string(),
    resources_source_text: z.string(),
    /** How the row's fragments were joined (page-split tails etc.), for audit. */
    assembly: z.array(z.string()),
    source: sourceSchema,
  })
  .strict();

const objectiveSchema = z
  .object({
    id: z.string(),
    subtopic_id: z.string(),
    competency_row_id: z.string(),
    ordinal_in_subtopic: z.number().int().positive(),
    ordinal_in_row: z.number().int().positive(),
    text: z.string().min(1),
    text_hash: z.string().regex(/^[0-9a-f]{64}$/),
    normalizations,
    source: sourceSchema,
  })
  .strict();

const rowItemSchema = z
  .object({
    id: z.string(),
    competency_row_id: z.string(),
    ordinal: z.number().int().positive(),
    text: z.string().min(1),
    normalizations,
    source: sourceSchema,
  })
  .strict();

const componentSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    weighting_percent: z.number(),
    /** Facts stated in the prose next to the table (e.g. projects per grade). */
    details: z.record(z.string(), z.unknown()),
    source: sourceSchema,
  })
  .strict();

/** One topic's progression for one grade, from the syllabus "Scope and Sequence" tables (section 7). */
const scopeSequenceSchema = z
  .object({
    id: z.string(),
    topic_code: z.enum(TOPIC_CODES),
    grade: z.number().int(),
    section_number: z.string(),
    items: z.array(z.string().min(1)).min(1),
    source: sourceSchema,
  })
  .strict();

/** A prose section of the syllabus (preamble, aims, methodology, assessment) for retrieval. */
const sectionSchema = z
  .object({
    id: z.string(),
    kind: z.enum(["PREAMBLE", "ASSESSMENT"]),
    level: z.number().int().min(1).max(6),
    heading: z.string(),
    text: z.string().min(1),
    source: sourceSchema,
  })
  .strict();

const paperSchema = z
  .object({
    id: z.string(),
    grade: z.number().int(),
    paper_number: z.number().int(),
    description: z.string(),
    duration_minutes: z.number().int().nullable(),
    marks: z.number().int(),
    paper_weighting_percent: z.number(),
    summative_weighting_percent: z.number().nullable(),
    structure: z.record(z.string(), z.unknown()),
    source: sourceSchema,
  })
  .strict();

const skillBandSchema = z
  .object({
    id: z.string(),
    paper_number: z.number().int(),
    skill_band: z.string(),
    skill_band_code: z.enum(["KNOWLEDGE_COMPREHENSION", "APPLICATION_ANALYSIS", "PROBLEM_SOLVING"]),
    percent: z.number(),
    source: sourceSchema,
  })
  .strict();

const assessmentObjectiveSchema = z
  .object({
    id: z.string(),
    code: z.string(),
    ordinal: z.number().int().positive(),
    text: z.string().min(1),
    source: sourceSchema,
  })
  .strict();

const projectStageSchema = z
  .object({
    id: z.string(),
    stage: z.number().int().positive(),
    description: z.string(),
    timeline: z.string().nullable(),
    marks: z.number().int(),
    source: sourceSchema,
  })
  .strict();

const pageSchema = z
  .object({
    page: z.number().int().positive(),
    page_label: z.string().nullable(),
    text: z.string(),
  })
  .strict();

const warningSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    page: z.number().int().positive().nullable(),
    ref: z.string().nullable(),
  })
  .strict();

export const snapshotSchema = z
  .object({
    schema_version: z.literal(SNAPSHOT_SCHEMA_VERSION),
    document: documentSchema,
    curriculum: z
      .object({
        id: z.string(),
        name: z.string(),
        organisation: z.string(),
        curriculum_year: z.string(),
        document_id: z.string(),
      })
      .strict(),
    subjects: z.array(z.object({ id: z.string(), name: z.string() }).strict()),
    grades: z.array(
      z.object({ id: z.string(), number: z.number().int(), label: z.string() }).strict(),
    ),
    topics: z.array(topicSchema),
    subtopics: z.array(subtopicSchema),
    competency_rows: z.array(rowSchema),
    objectives: z.array(objectiveSchema),
    content: z.array(rowItemSchema),
    activities: z.array(rowItemSchema),
    resources: z.array(rowItemSchema),
    assessment: z
      .object({
        components: z.array(componentSchema),
        papers: z.array(paperSchema),
        skill_bands: z.array(skillBandSchema),
        objectives: z.array(assessmentObjectiveSchema),
        project_stages: z.array(projectStageSchema),
      })
      .strict(),
    scope_sequence: z.array(scopeSequenceSchema),
    sections: z.array(sectionSchema),
    pages: z.array(pageSchema),
    warnings: z.array(warningSchema),
  })
  .strict();

export type CurriculumSnapshot = z.infer<typeof snapshotSchema>;
export type SnapshotTopic = CurriculumSnapshot["topics"][number];
export type SnapshotSubtopic = CurriculumSnapshot["subtopics"][number];
export type SnapshotRow = CurriculumSnapshot["competency_rows"][number];
export type SnapshotObjective = CurriculumSnapshot["objectives"][number];
export type SnapshotRowItem = CurriculumSnapshot["content"][number];
export type SnapshotWarning = CurriculumSnapshot["warnings"][number];
export type SnapshotScopeSequence = CurriculumSnapshot["scope_sequence"][number];
export type SnapshotSection = CurriculumSnapshot["sections"][number];
