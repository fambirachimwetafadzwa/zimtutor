import type { Path, PathObjective } from "../adaptive/path";
import type { Recommendation, RecommendationKind } from "../adaptive/recommend";
import type { LearnerPlan } from "../adaptive/service";
import { STATE_LABELS, type MasteryState } from "../mastery/engine";
import { POLICY } from "../tutor/policy";
import type { SessionSummary } from "../tutor/state";

/**
 * What the student's home screen and progress screen show, decided in one place. Pure: it takes the
 * learner's plan, the syllabus path and a few session rows, and returns plain data with the words
 * already chosen, so the pages only lay it out and the rules can be tested without a browser.
 *
 * Everything here is the learner's OWN data. Nothing in it is a conversation: sessions contribute
 * only the counts and outcomes written when they ended.
 */

export interface Goal {
  id: string;
  text: string;
  grade: number;
  topicName: string;
  subtopicName: string;
}

export const goalOf = (o: PathObjective): Goal => ({
  id: o.id,
  text: o.text,
  grade: o.grade,
  topicName: o.topicName,
  subtopicName: o.subtopicName,
});

// ── links and words ─────────────────────────────────────────────────────────────────────────────

export const KIND_LABEL: Record<RecommendationKind, string> = {
  REVIEW_DUE: "Review",
  FOUNDATION_CHECK: "Check the basics",
  CONTINUE: "Keep going",
  START_NEW: "Something new",
};

/** The headline of the main card for each kind of recommendation. */
export const KIND_HEADLINE: Record<RecommendationKind, string> = {
  REVIEW_DUE: "Time for a quick review",
  FOUNDATION_CHECK: "Let's check the basics first",
  CONTINUE: "Keep going with this goal",
  START_NEW: "Start something new",
};

export const KIND_ACTION: Record<RecommendationKind, string> = {
  REVIEW_DUE: "Start the review",
  FOUNDATION_CHECK: "Check the basics",
  CONTINUE: "Keep going",
  START_NEW: "Start",
};

/** Where a recommendation leads: the lesson page, with the way the lesson should run. */
export function lessonHref(
  rec: Pick<Recommendation, "kind" | "objectiveId" | "forObjectiveId">,
): string {
  const base = `/student/learn/${encodeURIComponent(rec.objectiveId)}`;
  if (rec.kind === "REVIEW_DUE") return `${base}?mode=REVIEW`;
  if (rec.kind === "FOUNDATION_CHECK")
    return rec.forObjectiveId
      ? `${base}?mode=FOUNDATION&for=${encodeURIComponent(rec.forObjectiveId)}`
      : `${base}?mode=FOUNDATION`;
  return base;
}

export const goalHref = (objectiveId: string): string =>
  `/student/learn/${encodeURIComponent(objectiveId)}`;

const percent = (mastery: number): number => Math.round(mastery * 100);

/**
 * Why a goal is suggested, in words that do not repeat the goal (the card already shows it). The
 * planner's own sentence names the goal so it can stand alone in a log or a report; on this screen
 * it would only say the same thing twice.
 */
export function reasonFor(rec: Recommendation, path: Path): string {
  switch (rec.kind) {
    case "REVIEW_DUE":
      return "You mastered this before. A quick review helps you remember it for a long time.";
    case "FOUNDATION_CHECK": {
      const tricky = rec.forObjectiveId ? path.byId.get(rec.forObjectiveId) : undefined;
      return tricky
        ? `This comes before “${tricky.text}”, which has been tricky. A few questions on it will help.`
        : "This comes before a goal that has been tricky. A few questions on it will help.";
    }
    case "CONTINUE":
      if (rec.because.struggling === true)
        return "This one is tricky, so the questions will be a little easier.";
      return rec.because.state === "INTRODUCED"
        ? "You have started this one. Let's try some questions."
        : "You are learning this one. Let's keep going.";
    case "START_NEW":
      return "This is the next goal in your syllabus.";
  }
}

// ── the model ───────────────────────────────────────────────────────────────────────────────────

export interface MainCard {
  kind: "RESUME" | "RECOMMENDED" | "ALL_DONE" | "NOTHING";
  headline: string;
  /** In plain words, why this is suggested. */
  reason: string | null;
  goal: Goal | null;
  action: string | null;
  href: string | null;
}

export interface PracticeItem {
  kind: RecommendationKind;
  label: string;
  goal: Goal;
  reason: string;
  href: string;
}

export interface TopicCard {
  topicId: string;
  topicCode: string;
  name: string;
  /** Displayed mastery across the topic's goals, 0–100. */
  percent: number;
  mastered: number;
  inProgress: number;
  review: number;
  total: number;
  /** The planner suggests this topic. */
  recommended: boolean;
}

export interface MasteryTiles {
  mastered: number;
  inProgress: number;
  review: number;
  notStarted: number;
  total: number;
}

export interface RecentItem {
  sessionId: string;
  goal: Goal | null;
  endedAt: string | null;
  questions: number;
  firstTry: number;
  hintsUsed: number;
  minutes: number;
  /** "Getting there", "Mastered" ... as of the end of the lesson. */
  outcome: string | null;
  mode: SessionSummary["mode"];
}

export interface Dashboard {
  grade: number;
  main: MainCard;
  practice: PracticeItem[];
  topics: TopicCard[];
  tiles: MasteryTiles;
  recent: RecentItem[];
}

export interface SessionRow {
  id: string;
  objectiveId: string;
  status: "ACTIVE" | "COMPLETED" | "ABANDONED";
  lastActivityAt: string;
  endedAt: string | null;
  summary: SessionSummary | null;
}

const PRACTICE_SHOWN = 4;
const RECENT_SHOWN = 5;

function mainCard(
  plan: LearnerPlan["plan"],
  path: Path,
  sessions: readonly SessionRow[],
  now: Date,
): MainCard {
  // a lesson left open (and not so long ago that it would be closed) comes first
  const open = sessions
    .filter(
      (s) =>
        s.status === "ACTIVE" &&
        now.getTime() - Date.parse(s.lastActivityAt) <= POLICY.idleMinutes * 60_000,
    )
    .sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt))[0];
  const openGoal = open ? path.byId.get(open.objectiveId) : undefined;
  if (open && openGoal)
    return {
      kind: "RESUME",
      headline: "Carry on where you stopped",
      reason: null,
      goal: goalOf(openGoal),
      action: "Continue",
      href: goalHref(open.objectiveId),
    };

  const next = plan.next;
  const nextGoal = next ? path.byId.get(next.objectiveId) : undefined;
  if (next && nextGoal)
    return {
      kind: "RECOMMENDED",
      headline: KIND_HEADLINE[next.kind],
      reason: reasonFor(next, path),
      goal: goalOf(nextGoal),
      action: KIND_ACTION[next.kind],
      href: lessonHref(next),
    };

  if (plan.allMastered)
    return {
      kind: "ALL_DONE",
      headline: "You have mastered every goal ZimTutor can practise for your grade",
      reason:
        "Well done! Goals come back for a quick review when it is time, to help you remember.",
      goal: null,
      action: null,
      href: null,
    };
  return {
    kind: "NOTHING",
    headline: "Nothing to practise right now",
    reason: "Come back soon.",
    goal: null,
    action: null,
    href: null,
  };
}

/** Finished lessons, newest first, as counts and outcomes (never words). */
export function recentWork(sessions: readonly SessionRow[], path: Path): RecentItem[] {
  return sessions
    .filter((s) => s.status !== "ACTIVE" && s.summary && s.summary.questions > 0)
    .sort((a, b) => Date.parse(b.endedAt ?? "") - Date.parse(a.endedAt ?? ""))
    .slice(0, RECENT_SHOWN)
    .map((s) => {
      const summary = s.summary!;
      const goal = path.byId.get(s.objectiveId);
      return {
        sessionId: s.id,
        goal: goal ? goalOf(goal) : null,
        endedAt: s.endedAt,
        questions: summary.questions,
        firstTry: summary.firstTry,
        hintsUsed: summary.hintsUsed,
        minutes: summary.minutes,
        outcome: summary.masteryEnd ? STATE_LABELS[summary.masteryEnd.state] : null,
        mode: summary.mode,
      };
    });
}

/** The four counts, from a progress summary. */
export function masteryTiles(
  progress: Pick<
    LearnerPlan["progress"],
    "mastered" | "inProgress" | "review" | "notStarted" | "total"
  >,
): MasteryTiles {
  return {
    mastered: progress.mastered,
    inProgress: progress.inProgress,
    review: progress.review,
    notStarted: progress.notStarted,
    total: progress.total,
  };
}

/** One card per topic. `suggested` is the topic the planner points at (none for a parent's view). */
export function topicCards(
  progress: LearnerPlan["progress"],
  suggested: string | null,
): TopicCard[] {
  return progress.topics.map((t) => ({
    topicId: t.topicId,
    topicCode: t.topicCode,
    name: t.topicName,
    percent: percent(t.mastery),
    mastered: t.mastered,
    inProgress: t.inProgress,
    review: t.review,
    total: t.total,
    recommended: suggested === t.topicId,
  }));
}

export function buildDashboard(input: {
  learner: LearnerPlan;
  path: Path;
  sessions: readonly SessionRow[];
  now: Date;
}): Dashboard {
  const { learner, path, sessions, now } = input;
  const { plan, progress } = learner;
  const main = mainCard(plan, path, sessions, now);

  const shownNext = main.kind === "RECOMMENDED" ? plan.next?.objectiveId : undefined;
  const practice: PracticeItem[] = [];
  for (const rec of plan.queue) {
    if (rec.objectiveId === shownNext || practice.length >= PRACTICE_SHOWN) continue;
    const goal = path.byId.get(rec.objectiveId);
    if (!goal) continue;
    practice.push({
      kind: rec.kind,
      label: KIND_LABEL[rec.kind],
      goal: goalOf(goal),
      reason: reasonFor(rec, path),
      href: lessonHref(rec),
    });
  }

  const recent = recentWork(sessions, path);

  return {
    grade: learner.grade,
    main,
    practice,
    topics: topicCards(progress, plan.recommendedTopic?.topicId ?? null),
    tiles: masteryTiles(progress),
    recent,
  };
}

// ── the progress screen ─────────────────────────────────────────────────────────────────────────

export interface GoalRow {
  goal: Goal;
  state: MasteryState;
  stateLabel: string;
  percent: number;
  attempts: number;
  /** The goal is due for review. */
  review: boolean;
  /** What the button says ("Start", "Keep going", "Review", "Practise again"). */
  action: string;
  href: string;
}

const GOAL_ACTION: Record<MasteryState, string> = {
  NOT_STARTED: "Start",
  INTRODUCED: "Keep going",
  LEARNING: "Keep going",
  PRACTICING: "Keep going",
  DEVELOPING: "Keep going",
  MASTERED: "Practise again",
  REVIEW: "Review",
};

export interface SubtopicProgress {
  subtopicId: string;
  name: string;
  percent: number;
  mastered: number;
  total: number;
  goals: GoalRow[];
}

export interface TopicProgressView extends TopicCard {
  subtopics: SubtopicProgress[];
}

export interface ProgressScreen {
  grade: number;
  tiles: MasteryTiles;
  topics: TopicProgressView[];
  /** Goals of the grade that are done with real materials and so have no practice here. */
  handsOn: number;
}

export function buildProgressScreen(input: { learner: LearnerPlan; path: Path }): ProgressScreen {
  const { learner, path } = input;
  const { plan, progress } = learner;
  const shown = new Set<string>();
  const topics = progress.topics.map((t): TopicProgressView => {
    return {
      topicId: t.topicId,
      topicCode: t.topicCode,
      name: t.topicName,
      percent: percent(t.mastery),
      mastered: t.mastered,
      inProgress: t.inProgress,
      review: t.review,
      total: t.total,
      recommended: plan.recommendedTopic?.topicId === t.topicId,
      subtopics: t.subtopics.map((s) => ({
        subtopicId: s.subtopicId,
        name: s.subtopicName,
        percent: percent(s.mastery),
        mastered: s.mastered,
        total: s.total,
        goals: s.objectives.flatMap((o): GoalRow[] => {
          const goal = path.byId.get(o.objectiveId);
          if (!goal) return [];
          shown.add(o.objectiveId);
          return [
            {
              goal: goalOf(goal),
              state: o.state,
              stateLabel: STATE_LABELS[o.state],
              percent: percent(o.mastery),
              attempts: o.attempts,
              review: o.state === "REVIEW",
              action: GOAL_ACTION[o.state],
              href:
                o.state === "REVIEW"
                  ? lessonHref({ kind: "REVIEW_DUE", objectiveId: o.objectiveId })
                  : goalHref(o.objectiveId),
            },
          ];
        }),
      })),
    };
  });
  return {
    grade: learner.grade,
    tiles: {
      mastered: progress.mastered,
      inProgress: progress.inProgress,
      review: progress.review,
      notStarted: progress.notStarted,
      total: progress.total,
    },
    topics,
    handsOn: path.forGrade(learner.grade).length - shown.size,
  };
}
