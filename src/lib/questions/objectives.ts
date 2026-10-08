import type { CurriculumSnapshot } from "../../ingestion/snapshot";
import type { ObjectiveInfo } from "./types";

/**
 * Objectives in the shape the question templates need. Built from a curriculum snapshot (tests,
 * the coverage report, the offline CLIs) or from database rows (the running application): both go
 * through the same fields, so a template behaves identically everywhere.
 */

export function objectivesFromSnapshot(snapshot: CurriculumSnapshot): ObjectiveInfo[] {
  const topics = new Map(snapshot.topics.map((t) => [t.id, t]));
  const subtopics = new Map(snapshot.subtopics.map((s) => [s.id, s]));
  return snapshot.objectives.map((objective) => {
    const subtopic = subtopics.get(objective.subtopic_id);
    const topic = subtopic ? topics.get(subtopic.topic_id) : undefined;
    if (!subtopic || !topic)
      throw new Error(`Objective ${objective.id} points at a sub-topic or topic that is missing`);
    const grade = Number(/^G(\d+)-/.exec(topic.id)?.[1]);
    if (!Number.isInteger(grade)) throw new Error(`Cannot read the grade from topic ${topic.id}`);
    return {
      id: objective.id,
      text: objective.text,
      grade,
      topicCode: topic.code,
      subtopicId: subtopic.id,
      strandKey: subtopic.strand_key,
      subtopicShortName: subtopic.short_name,
      ordinalInSubtopic: objective.ordinal_in_subtopic,
    };
  });
}

/** Columns of `v_objective_context` that describe an objective to the question templates. */
export const OBJECTIVE_CONTEXT_COLUMNS =
  "objective_id, objective_text, grade, topic_code, subtopic_id, strand_key, subtopic_short_name, ordinal_in_subtopic";

export interface ObjectiveContextRow {
  objective_id: string;
  objective_text: string;
  grade: number;
  topic_code: string;
  subtopic_id: string;
  strand_key: string;
  subtopic_short_name: string;
  ordinal_in_subtopic: number;
}

const TOPIC_CODES = ["NUM", "OPS", "MEA", "REL"] as const;

/** An objective as the running application reads it: from a row of `v_objective_context`. */
export function objectiveFromContextRow(row: ObjectiveContextRow): ObjectiveInfo {
  const topicCode = TOPIC_CODES.find((code) => code === row.topic_code);
  if (!topicCode)
    throw new Error(`Objective ${row.objective_id} has an unknown topic ${row.topic_code}`);
  return {
    id: row.objective_id,
    text: row.objective_text,
    grade: Number(row.grade),
    topicCode,
    subtopicId: row.subtopic_id,
    strandKey: row.strand_key,
    subtopicShortName: row.subtopic_short_name,
    ordinalInSubtopic: Number(row.ordinal_in_subtopic),
  };
}
