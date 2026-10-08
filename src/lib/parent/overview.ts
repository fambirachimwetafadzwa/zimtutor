import type { Path } from "../adaptive/path";
import { practicableObjectiveIds } from "../adaptive/practice";
import { summariseProgress } from "../adaptive/progress";
import { isStruggling } from "../adaptive/recommend";
import { deriveState, type MasteryRecord } from "../mastery/engine";
import {
  type Goal,
  type MasteryTiles,
  type RecentItem,
  type SessionRow,
  type TopicCard,
  recentWork,
  topicCards,
  masteryTiles,
  goalOf,
} from "../student/dashboard";

/**
 * What a parent is shown about a child: how far they have got, what they did this week, what they
 * find hard, and the lessons they finished. Pure, like the student's screens.
 *
 * THIS IS THE PRIVACY BOUNDARY OF THE PARENT VIEW. A parent sees counts, outcomes, times and goals;
 * never a word of what the child typed or what the tutor said, and never the individual answers. The
 * inputs make that structural: sessions arrive as their end-of-lesson summaries and mastery as
 * records of numbers, so there is nothing else to leak.
 */

export interface WeekSummary {
  /** Lessons finished in the last seven days. */
  lessons: number;
  /** Days with at least one lesson finished. */
  days: number;
  minutes: number;
  questions: number;
  /** Questions answered right at the first try. */
  firstTry: number;
  /** firstTry as a percentage of questions; null when there were none. */
  firstTryPercent: number | null;
}

export interface NeedsHand {
  goal: Goal;
  /** Of the last `recentCount` independent answers, how many were right without help. */
  recentRight: number;
  recentCount: number;
  attempts: number;
}

export interface RecentlyMastered {
  goal: Goal;
  masteredAt: string;
}

export interface ParentOverview {
  learner: { name: string; grade: number; username: string };
  week: WeekSummary;
  tiles: MasteryTiles;
  topics: TopicCard[];
  needsHand: NeedsHand[];
  recentlyMastered: RecentlyMastered[];
  recent: RecentItem[];
  /** The last time the child did anything in a lesson, as an ISO time. */
  lastActive: string | null;
}

const DAY_MS = 86_400_000;
const NEEDS_HAND_SHOWN = 5;
const MASTERED_SHOWN = 5;

/** The calendar day in Zimbabwe, so "days this week" does not depend on the server's time zone. */
const dayOf = (iso: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Harare" }).format(new Date(iso));

export function summariseWeek(sessions: readonly SessionRow[], now: Date): WeekSummary {
  const since = now.getTime() - 7 * DAY_MS;
  const finished = sessions.filter(
    (s) =>
      s.status !== "ACTIVE" &&
      s.summary !== null &&
      s.summary.questions > 0 &&
      s.endedAt !== null &&
      Date.parse(s.endedAt) >= since &&
      Date.parse(s.endedAt) <= now.getTime(),
  );
  const questions = finished.reduce((n, s) => n + s.summary!.questions, 0);
  const firstTry = finished.reduce((n, s) => n + s.summary!.firstTry, 0);
  const minutes = finished.reduce((n, s) => n + s.summary!.minutes, 0);
  return {
    lessons: finished.length,
    days: new Set(finished.map((s) => dayOf(s.endedAt!))).size,
    // a lesson that took seconds still shows as a minute, never as "0 minutes"
    minutes: minutes > 0 ? Math.max(1, Math.round(minutes)) : 0,
    questions,
    firstTry,
    firstTryPercent: questions === 0 ? null : Math.round((firstTry / questions) * 100),
  };
}

export function buildParentOverview(input: {
  learner: { name: string; grade: number; username: string };
  path: Path;
  mastery: ReadonlyMap<string, MasteryRecord>;
  sessions: readonly SessionRow[];
  now: Date;
}): ParentOverview {
  const { learner, path, mastery, sessions, now } = input;
  const practicable = practicableObjectiveIds(path);
  const isPracticable = (id: string) => practicable.has(id);
  const progress = summariseProgress({
    path,
    grade: learner.grade,
    mastery,
    now,
    include: isPracticable,
  });

  const needsHand: NeedsHand[] = [];
  const recentlyMastered: RecentlyMastered[] = [];
  for (const o of path.forGrade(learner.grade)) {
    const record = mastery.get(o.id);
    if (!record || !isPracticable(o.id)) continue;
    const state = deriveState(record, now);
    if (state !== "MASTERED" && isStruggling(record))
      needsHand.push({
        goal: goalOf(o),
        recentRight: record.recentOutcomes.filter(Boolean).length,
        recentCount: record.recentOutcomes.length,
        attempts: record.attempts,
      });
    if (record.masteredAt && (state === "MASTERED" || state === "REVIEW"))
      recentlyMastered.push({ goal: goalOf(o), masteredAt: record.masteredAt.toISOString() });
  }
  const lastTried = (id: string) => mastery.get(id)?.lastAttemptAt?.getTime() ?? 0;
  needsHand.sort((a, b) => lastTried(b.goal.id) - lastTried(a.goal.id));
  recentlyMastered.sort((a, b) => Date.parse(b.masteredAt) - Date.parse(a.masteredAt));

  const times = sessions
    .map((s) => Date.parse(s.endedAt ?? s.lastActivityAt))
    .filter(Number.isFinite);
  return {
    learner,
    week: summariseWeek(sessions, now),
    tiles: masteryTiles(progress),
    topics: topicCards(progress, null),
    needsHand: needsHand.slice(0, NEEDS_HAND_SHOWN),
    recentlyMastered: recentlyMastered.slice(0, MASTERED_SHOWN),
    recent: recentWork(sessions, path),
    lastActive: times.length > 0 ? new Date(Math.max(...times)).toISOString() : null,
  };
}
