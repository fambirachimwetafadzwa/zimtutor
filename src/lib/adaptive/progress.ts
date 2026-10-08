import {
  deriveState,
  displayMastery,
  type MasteryRecord,
  type MasteryState,
} from "../mastery/engine";
import type { Path, PathObjective } from "./path";

/**
 * How far a learner has got, grouped for the progress screens (topic cards with a bar, sub-topic
 * lists). Pure: it takes the syllabus path and the mastery records and returns plain numbers.
 *
 * "Mastery" shown to people is `displayMastery`: the engine's estimate shrunk by how much evidence
 * stands behind it, so three lucky answers do not show as 90 %.
 */

export interface ProgressCounts {
  total: number;
  notStarted: number;
  /** Introduced, learning, practising or developing. */
  inProgress: number;
  mastered: number;
  /** Mastered earlier, now due for review. */
  review: number;
}

export interface ObjectiveProgress {
  objectiveId: string;
  state: MasteryState;
  /** 0–1, as shown to people (0 when not started). */
  mastery: number;
  attempts: number;
  lastAttemptAt: Date | null;
}

export interface GroupProgress extends ProgressCounts {
  /** Average displayed mastery over every objective in the group (not-started ones count as 0). */
  mastery: number;
  objectives: ObjectiveProgress[];
}

export interface TopicProgress extends GroupProgress {
  topicId: string;
  topicCode: string;
  topicName: string;
  ordinal: number;
  subtopics: Array<GroupProgress & { subtopicId: string; subtopicName: string; ordinal: number }>;
}

export interface ProgressSummary extends GroupProgress {
  topics: TopicProgress[];
}

function summarise(
  objectives: readonly PathObjective[],
  mastery: ReadonlyMap<string, MasteryRecord>,
  now: Date,
): GroupProgress {
  const rows: ObjectiveProgress[] = objectives.map((o) => {
    const record = mastery.get(o.id);
    if (!record)
      return {
        objectiveId: o.id,
        state: "NOT_STARTED",
        mastery: 0,
        attempts: 0,
        lastAttemptAt: null,
      };
    return {
      objectiveId: o.id,
      state: deriveState(record, now),
      mastery: displayMastery(record),
      attempts: record.attempts,
      lastAttemptAt: record.lastAttemptAt,
    };
  });
  const count = (...states: MasteryState[]) => rows.filter((r) => states.includes(r.state)).length;
  const total = rows.length;
  return {
    total,
    notStarted: count("NOT_STARTED"),
    inProgress: count("INTRODUCED", "LEARNING", "PRACTICING", "DEVELOPING"),
    mastered: count("MASTERED"),
    review: count("REVIEW"),
    mastery:
      total === 0 ? 0 : Math.round((rows.reduce((a, r) => a + r.mastery, 0) / total) * 1000) / 1000,
    objectives: rows,
  };
}

export function summariseProgress(input: {
  path: Path;
  grade: number;
  mastery: ReadonlyMap<string, MasteryRecord>;
  now: Date;
  /** Which objectives count (default: all). Hands-on objectives with no practice can be left out. */
  include?: (objectiveId: string) => boolean;
}): ProgressSummary {
  const include = input.include ?? (() => true);
  const objectives = input.path.forGrade(input.grade).filter((o) => include(o.id));
  const topics = new Map<string, PathObjective[]>();
  for (const o of objectives) topics.set(o.topicId, [...(topics.get(o.topicId) ?? []), o]);

  return {
    ...summarise(objectives, input.mastery, input.now),
    topics: [...topics.values()].map((inTopic) => {
      const first = inTopic[0]!;
      const subtopics = new Map<string, PathObjective[]>();
      for (const o of inTopic)
        subtopics.set(o.subtopicId, [...(subtopics.get(o.subtopicId) ?? []), o]);
      return {
        ...summarise(inTopic, input.mastery, input.now),
        topicId: first.topicId,
        topicCode: first.topicCode,
        topicName: first.topicName,
        ordinal: first.topicOrdinal,
        subtopics: [...subtopics.values()].map((inSub) => ({
          ...summarise(inSub, input.mastery, input.now),
          subtopicId: inSub[0]!.subtopicId,
          subtopicName: inSub[0]!.subtopicName,
          ordinal: inSub[0]!.subtopicOrdinal,
        })),
      };
    }),
  };
}
