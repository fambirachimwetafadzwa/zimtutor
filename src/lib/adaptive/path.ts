import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { CurriculumSnapshot } from "../../ingestion/snapshot";

/**
 * The syllabus as a learner walks through it: every objective in its printed order, with the topic,
 * sub-topic and strand it belongs to. The planner (`recommend.ts`) and the progress summaries work on
 * this plain data, so they need no database and are fully testable.
 */

export interface PathObjective {
  id: string;
  text: string;
  grade: number;
  topicId: string;
  topicCode: "NUM" | "OPS" | "MEA" | "REL";
  topicName: string;
  topicOrdinal: number;
  subtopicId: string;
  subtopicName: string;
  subtopicShortName: string;
  subtopicOrdinal: number;
  /** Links the same strand across grades (e.g. "proper-fractions"). */
  strandKey: string;
  ordinalInSubtopic: number;
}

export interface Path {
  /** Every objective, in syllabus order: grade, topic, sub-topic, objective. */
  all: readonly PathObjective[];
  byId: ReadonlyMap<string, PathObjective>;
  forGrade(grade: number): PathObjective[];
  /** The objectives of one sub-topic, in order. */
  inSubtopic(subtopicId: string): PathObjective[];
  /** The objectives of a strand in a grade, in order. */
  inStrand(grade: number, strandKey: string): PathObjective[];
}

export function buildPath(objectives: readonly PathObjective[]): Path {
  const all = [...objectives].sort(
    (a, b) =>
      a.grade - b.grade ||
      a.topicOrdinal - b.topicOrdinal ||
      a.subtopicOrdinal - b.subtopicOrdinal ||
      a.ordinalInSubtopic - b.ordinalInSubtopic,
  );
  const byId = new Map(all.map((o) => [o.id, o]));
  if (byId.size !== all.length) throw new Error("The syllabus path has a duplicate objective id");
  return {
    all,
    byId,
    forGrade: (grade) => all.filter((o) => o.grade === grade),
    inSubtopic: (subtopicId) => all.filter((o) => o.subtopicId === subtopicId),
    inStrand: (grade, strandKey) =>
      all.filter((o) => o.grade === grade && o.strandKey === strandKey),
  };
}

const rowSchema = z.object({
  objective_id: z.string(),
  objective_text: z.string(),
  grade: z.number().int(),
  topic_id: z.string(),
  topic_code: z.enum(["NUM", "OPS", "MEA", "REL"]),
  topic_name: z.string(),
  topic_ordinal: z.number().int(),
  subtopic_id: z.string(),
  subtopic_name: z.string(),
  subtopic_short_name: z.string(),
  subtopic_ordinal: z.number().int(),
  strand_key: z.string(),
  ordinal_in_subtopic: z.number().int(),
});

const COLUMNS =
  "objective_id, objective_text, grade, topic_id, topic_code, topic_name, topic_ordinal, subtopic_id, subtopic_name, subtopic_short_name, subtopic_ordinal, strand_key, ordinal_in_subtopic";

export const PATH_COLUMNS = COLUMNS;

/** The syllabus path from rows of `v_objective_context`. */
export function pathFromContextRows(rows: readonly unknown[]): Path {
  return buildPath(
    rows.map((raw) => {
      const row = rowSchema.parse(raw);
      return {
        id: row.objective_id,
        text: row.objective_text,
        grade: row.grade,
        topicId: row.topic_id,
        topicCode: row.topic_code,
        topicName: row.topic_name,
        topicOrdinal: row.topic_ordinal,
        subtopicId: row.subtopic_id,
        subtopicName: row.subtopic_name,
        subtopicShortName: row.subtopic_short_name,
        subtopicOrdinal: row.subtopic_ordinal,
        strandKey: row.strand_key,
        ordinalInSubtopic: row.ordinal_in_subtopic,
      };
    }),
  );
}

/** Read the syllabus path (objectives that have left the syllabus are not part of it). */
export async function loadPath(db: SupabaseClient): Promise<Path> {
  const { data, error } = await db
    .from("v_objective_context")
    .select(COLUMNS)
    .is("retired_at", null);
  if (error) throw new Error(`Could not read the syllabus: ${error.message}`);
  return pathFromContextRows(data ?? []);
}

/** The syllabus path from a curriculum snapshot (tests and offline tools; the app reads the database). */
export function pathFromSnapshot(snapshot: CurriculumSnapshot): Path {
  const topics = new Map(snapshot.topics.map((t) => [t.id, t]));
  const subtopics = new Map(snapshot.subtopics.map((s) => [s.id, s]));
  return buildPath(
    snapshot.objectives.map((objective) => {
      const subtopic = subtopics.get(objective.subtopic_id);
      const topic = subtopic ? topics.get(subtopic.topic_id) : undefined;
      if (!subtopic || !topic)
        throw new Error(`Objective ${objective.id} points at a sub-topic or topic that is missing`);
      return {
        id: objective.id,
        text: objective.text,
        grade: Number(/^G(\d+)-/.exec(topic.id)?.[1]),
        topicId: topic.id,
        topicCode: topic.code,
        topicName: topic.name,
        topicOrdinal: topic.ordinal,
        subtopicId: subtopic.id,
        subtopicName: subtopic.name,
        subtopicShortName: subtopic.short_name,
        subtopicOrdinal: subtopic.ordinal,
        strandKey: subtopic.strand_key,
        ordinalInSubtopic: objective.ordinal_in_subtopic,
      };
    }),
  );
}
