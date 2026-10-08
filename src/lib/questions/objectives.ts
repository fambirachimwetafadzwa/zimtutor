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
