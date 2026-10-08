import {
  deriveState,
  reviewDueAt,
  type Difficulty,
  type MasteryRecord,
  type MasteryState,
} from "../mastery/engine";
import type { Path, PathObjective } from "./path";

/**
 * WHAT SHOULD THIS LEARNER DO NEXT? — deterministic, explainable, and independent of any language
 * model. The rules, in order of urgency:
 *
 *   REVIEW_DUE        an objective the learner mastered whose spaced-review interval has passed.
 *   FOUNDATION_CHECK  the learner keeps getting an objective wrong: first check an earlier objective
 *                     it builds on (earlier in the same sub-topic, or the same strand a grade earlier).
 *   CONTINUE          an objective already started (explained, or practised but not yet developed).
 *   START_NEW         the next objective in the syllabus, once the one before it in the same sub-topic
 *                     is developing, and only while few objectives are half-finished.
 *
 * Every recommendation carries a reason in plain words and the numbers behind it, so a teacher or a
 * parent can see why. Objectives with no machine-marked practice (drawing, building, collecting data)
 * are never recommended here: they are done with real materials and cannot move mastery.
 */

// ── the rules, named ────────────────────────────────────────────────────────────────────────────
export const RULES = {
  /** Objectives started but not yet developing, at most, before no new objective is suggested. */
  workInProgressLimit: 3,
  /** "Struggling": at least this many questions answered … */
  struggleMinAttempts: 4,
  /** … with recent accuracy below this … */
  struggleAccuracy: 0.4,
  /** … or this many wrong answers in a row. */
  struggleWrongInARow: 3,
  /** Penalty (priority points) for suggesting the same kind of activity twice in a row in the queue. */
  repeatPenalty: 15,
} as const;

const DAY_MS = 86_400_000;
const IN_PROGRESS: ReadonlySet<MasteryState> = new Set([
  "INTRODUCED",
  "LEARNING",
  "PRACTICING",
  "DEVELOPING",
]);
/** The previous objective counts as "got it for now" from here on. */
const READY_FOR_MORE: ReadonlySet<MasteryState> = new Set(["DEVELOPING", "MASTERED", "REVIEW"]);

export type RecommendationKind = "REVIEW_DUE" | "FOUNDATION_CHECK" | "CONTINUE" | "START_NEW";

export interface Recommendation {
  kind: RecommendationKind;
  objectiveId: string;
  /** In plain words, for the learner. */
  reason: string;
  /** The facts the decision rests on, for teachers, parents and analytics. */
  because: Record<string, string | number | boolean | null>;
  /** Where to aim the first question (1 easiest … 5 hardest). */
  suggestedDifficulty: Difficulty;
  /** Higher = more urgent. */
  priority: number;
  /** FOUNDATION_CHECK only: the objective the learner is finding hard. */
  forObjectiveId?: string;
}

export interface PlanCounts {
  /** Objectives of the learner's grade that can be practised. */
  total: number;
  notStarted: number;
  inProgress: number;
  mastered: number;
  reviewDue: number;
  struggling: number;
}

export interface Plan {
  /** The one thing to do now (null when everything is mastered and nothing is due). */
  next: Recommendation | null;
  /** Up to `limit` things, mixing kinds so that practice stays varied. */
  queue: Recommendation[];
  /** The topic to point the learner at on the dashboard. */
  recommendedTopic: {
    topicId: string;
    topicCode: string;
    topicName: string;
    reason: string;
  } | null;
  allMastered: boolean;
  counts: PlanCounts;
}

export interface PlanInput {
  path: Path;
  grade: number;
  /** Mastery records by objective id; an objective with no record has not been started. */
  mastery: ReadonlyMap<string, MasteryRecord>;
  now: Date;
  /** Which objectives have machine-marked practice (default: all). */
  practicable?: (objectiveId: string) => boolean;
  /** Length of the queue (default 6). */
  limit?: number;
}

const stateOf = (
  mastery: ReadonlyMap<string, MasteryRecord>,
  id: string,
  now: Date,
): MasteryState => {
  const record = mastery.get(id);
  return record ? deriveState(record, now) : "NOT_STARTED";
};

/** Wrong answers in a row at the end of the recent outcomes. */
function wrongInARow(record: MasteryRecord): number {
  let n = 0;
  for (let i = record.recentOutcomes.length - 1; i >= 0 && !record.recentOutcomes[i]; i--) n++;
  return n;
}

export function isStruggling(record: MasteryRecord): boolean {
  if (record.attempts < 2) return false;
  if (wrongInARow(record) >= RULES.struggleWrongInARow) return true;
  return (
    record.attempts >= RULES.struggleMinAttempts &&
    record.recentAccuracy !== null &&
    record.recentAccuracy < RULES.struggleAccuracy
  );
}

const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);
/** "name polygons with sides up to four." → "name polygons with sides up to four" */
const clean = (text: string): string => lowerFirst(text.trim().replace(/[.\s]+$/, ""));

const daysBetween = (from: Date, to: Date) => Math.max(0, (to.getTime() - from.getTime()) / DAY_MS);
const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Earlier objectives the learner can check first: earlier in the same sub-topic (nearest first), then
 * the same strand in earlier grades. Only objectives that can be practised and are not yet mastered.
 */
export function foundationCandidates(
  path: Path,
  objective: PathObjective,
  mastery: ReadonlyMap<string, MasteryRecord>,
  now: Date,
  practicable: (id: string) => boolean,
): PathObjective[] {
  const notMastered = (o: PathObjective) => {
    const state = stateOf(mastery, o.id, now);
    return state !== "MASTERED" && state !== "REVIEW";
  };
  const earlierHere = path
    .inSubtopic(objective.subtopicId)
    .filter((o) => o.ordinalInSubtopic < objective.ordinalInSubtopic)
    .reverse();
  const earlierGrades: PathObjective[] = [];
  for (let grade = objective.grade - 1; grade >= 3 && earlierGrades.length < 4; grade--) {
    const strand = path.inStrand(grade, objective.strandKey);
    // the objective at the same relative place first, then the first one of the strand
    const same = strand[Math.min(strand.length - 1, objective.ordinalInSubtopic - 1)];
    for (const candidate of [same, strand[0]]) {
      if (candidate && !earlierGrades.includes(candidate)) earlierGrades.push(candidate);
    }
  }
  return [...earlierHere, ...earlierGrades].filter((o) => practicable(o.id) && notMastered(o));
}

export function recommend(input: PlanInput): Plan {
  const { path, grade, mastery, now } = input;
  const practicable = input.practicable ?? (() => true);
  const limit = input.limit ?? 6;
  const objectives = path.forGrade(grade).filter((o) => practicable(o.id));

  const states = new Map(objectives.map((o) => [o.id, stateOf(mastery, o.id, now)] as const));
  const counts: PlanCounts = {
    total: objectives.length,
    notStarted: 0,
    inProgress: 0,
    mastered: 0,
    reviewDue: 0,
    struggling: 0,
  };
  for (const o of objectives) {
    const state = states.get(o.id)!;
    const record = mastery.get(o.id);
    if (state === "NOT_STARTED") counts.notStarted++;
    else if (state === "MASTERED") counts.mastered++;
    else if (state === "REVIEW") counts.reviewDue++;
    else counts.inProgress++;
    if (record && IN_PROGRESS.has(state) && isStruggling(record)) counts.struggling++;
  }

  const recommendations: Recommendation[] = [];

  // 1. spaced review of what was mastered
  for (const o of objectives) {
    if (states.get(o.id) !== "REVIEW") continue;
    const record = mastery.get(o.id)!;
    const due = reviewDueAt(record)!;
    const overdue = daysBetween(due, now);
    const since = record.lastAttemptAt ? daysBetween(record.lastAttemptAt, now) : null;
    recommendations.push({
      kind: "REVIEW_DUE",
      objectiveId: o.id,
      reason: `You learned to ${clean(o.text)}. A quick review will help you keep remembering it.`,
      because: {
        state: "REVIEW",
        reviewStage: record.reviewStage,
        daysOverdue: round1(overdue),
        daysSincePractice: since === null ? null : round1(since),
      },
      suggestedDifficulty: Math.max(2, record.difficulty - 1) as Difficulty,
      priority: 100 + Math.min(30, overdue),
    });
  }

  // 2. struggling → check the foundations first; 3. started → continue
  const startedByRecency = objectives
    .filter((o) => IN_PROGRESS.has(states.get(o.id)!))
    .sort((a, b) => {
      const at = (o: PathObjective) =>
        (
          mastery.get(o.id)?.lastAttemptAt ??
          mastery.get(o.id)?.stateChangedAt ??
          new Date(0)
        ).getTime();
      return at(b) - at(a);
    });
  for (const o of startedByRecency) {
    const record = mastery.get(o.id)!;
    const state = states.get(o.id)!;
    const last = record.lastAttemptAt ?? record.stateChangedAt;
    const recency = Math.exp(-daysBetween(last, now) / 7); // 1 today … 0 long ago
    if (isStruggling(record)) {
      const foundation = foundationCandidates(path, o, mastery, now, practicable)[0];
      if (foundation) {
        recommendations.push({
          kind: "FOUNDATION_CHECK",
          objectiveId: foundation.id,
          forObjectiveId: o.id,
          reason: `Let's warm up with something that comes before: ${clean(foundation.text)}. It will help you with "${clean(o.text)}".`,
          because: {
            struggling: true,
            attempts: record.attempts,
            recentAccuracy: record.recentAccuracy,
            wrongInARow: wrongInARow(record),
            foundationInSameSubtopic: foundation.subtopicId === o.subtopicId,
            foundationGrade: foundation.grade,
          },
          suggestedDifficulty: Math.min(
            2,
            mastery.get(foundation.id)?.difficulty ?? 1,
          ) as Difficulty,
          priority: 90,
        });
      }
    }
    recommendations.push({
      kind: "CONTINUE",
      objectiveId: o.id,
      reason: isStruggling(record)
        ? `This one is tricky. Let's keep practising "${clean(o.text)}" with questions that are a little easier.`
        : state === "INTRODUCED"
          ? `You have started to ${clean(o.text)}. Let's try some questions.`
          : `Keep going: you are learning to ${clean(o.text)}.`,
      because: {
        state,
        attempts: record.attempts,
        masteryScore: Math.round(record.masteryScore * 100) / 100,
        recentAccuracy: record.recentAccuracy,
        struggling: isStruggling(record),
      },
      suggestedDifficulty: (isStruggling(record)
        ? Math.max(1, record.difficulty - 1)
        : record.difficulty) as Difficulty,
      priority: 70 + 10 * recency - (isStruggling(record) ? 5 : 0),
    });
  }

  // 4. something new, in the order of the syllabus, while few things are half-finished
  const halfFinished = counts.inProgress;
  if (halfFinished < RULES.workInProgressLimit) {
    const inOrder = objectives;
    const ready = (o: PathObjective): boolean => {
      const before = inOrder
        .filter((x) => x.subtopicId === o.subtopicId && x.ordinalInSubtopic < o.ordinalInSubtopic)
        .at(-1);
      return !before || READY_FOR_MORE.has(states.get(before.id)!);
    };
    const candidates = inOrder.filter((o) => states.get(o.id) === "NOT_STARTED");
    // If nothing is half-finished, never leave the learner with nothing to do: take the next in order.
    const picked =
      candidates.filter(ready).slice(0, 2).length > 0
        ? candidates.filter(ready).slice(0, 2)
        : halfFinished === 0
          ? candidates.slice(0, 1)
          : [];
    picked.forEach((o, i) => {
      recommendations.push({
        kind: "START_NEW",
        objectiveId: o.id,
        reason: `Next in your syllabus: ${clean(o.text)}.`,
        because: {
          topic: o.topicName,
          subtopic: o.subtopicName,
          position: inOrder.indexOf(o) + 1,
          objectivesInGrade: inOrder.length,
          halfFinished,
        },
        suggestedDifficulty: 1,
        priority: 50 - i * 5,
      });
    });
  }

  const ranked = recommendations.sort((a, b) => b.priority - a.priority);
  const queue = interleave(ranked, limit);
  const next = ranked[0] ?? null;
  const allMastered = counts.total > 0 && counts.mastered === counts.total;
  const topic = next ? path.byId.get(next.forObjectiveId ?? next.objectiveId) : undefined;
  return {
    next,
    queue,
    recommendedTopic: topic
      ? {
          topicId: topic.topicId,
          topicCode: topic.topicCode,
          topicName: topic.topicName,
          reason:
            next!.kind === "START_NEW"
              ? `It is the next part of the syllabus.`
              : next!.kind === "REVIEW_DUE"
                ? `Something you mastered is ready for a quick review.`
                : `You have started work here.`,
        }
      : null,
    allMastered,
    counts,
  };
}

/** The most urgent first, but avoiding the same kind of activity many times in a row. */
function interleave(ranked: readonly Recommendation[], limit: number): Recommendation[] {
  const remaining = [...ranked];
  const out: Recommendation[] = [];
  const seen = new Set<string>();
  while (out.length < limit && remaining.length > 0) {
    const last = out.at(-1);
    let best = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    remaining.forEach((r, i) => {
      if (seen.has(r.objectiveId)) return;
      const score = r.priority - (last && last.kind === r.kind ? RULES.repeatPenalty : 0);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best === -1) break;
    const [chosen] = remaining.splice(best, 1);
    seen.add(chosen!.objectiveId); // an objective is listed once, by its most urgent reason
    out.push(chosen!);
  }
  return out;
}
