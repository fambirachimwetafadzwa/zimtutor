import { describe, expect, it } from "vitest";
import { practicableObjectiveIds } from "../../src/lib/adaptive/practice";
import { recommend } from "../../src/lib/adaptive/recommend";
import type { LearnerPlan } from "../../src/lib/adaptive/service";
import { summariseProgress } from "../../src/lib/adaptive/progress";
import { markIntroduced, newMasteryRecord, type MasteryRecord } from "../../src/lib/mastery/engine";
import {
  buildDashboard,
  buildProgressScreen,
  lessonHref,
  reasonFor,
  type SessionRow,
} from "../../src/lib/student/dashboard";
import type { SessionSummary } from "../../src/lib/tutor/state";
import { NOW, PATH, answered, daysAgo, gradeObjectives, mastered } from "../adaptive/support";

const GRADE = 5;
const practicable = practicableObjectiveIds(PATH);
const isPracticable = (id: string) => practicable.has(id);

function learnerWith(mastery: ReadonlyMap<string, MasteryRecord>): LearnerPlan {
  return {
    grade: GRADE,
    plan: recommend({
      path: PATH,
      grade: GRADE,
      mastery,
      now: NOW,
      practicable: isPracticable,
      limit: 8,
    }),
    progress: summariseProgress({
      path: PATH,
      grade: GRADE,
      mastery,
      now: NOW,
      include: isPracticable,
    }),
  };
}

const summary = (over: Partial<SessionSummary> = {}): SessionSummary => ({
  objectiveId: gradeObjectives(GRADE)[0]!.id,
  mode: "LEARN",
  questions: 6,
  firstTry: 5,
  hintsUsed: 1,
  minutes: 9.5,
  masteryStart: null,
  masteryEnd: { score: 0.88, state: "MASTERED" },
  endedBy: "MASTERED",
  ...over,
});

const session = (over: Partial<SessionRow> & { id: string }): SessionRow => ({
  objectiveId: gradeObjectives(GRADE)[0]!.id,
  status: "COMPLETED",
  lastActivityAt: NOW.toISOString(),
  endedAt: NOW.toISOString(),
  summary: summary(),
  ...over,
});

const dashboard = (mastery = new Map<string, MasteryRecord>(), sessions: SessionRow[] = []) =>
  buildDashboard({ learner: learnerWith(mastery), path: PATH, sessions, now: NOW });

describe("lesson links", () => {
  it("opens a review as a review and a foundation check for the goal that needs it", () => {
    expect(lessonHref({ kind: "START_NEW", objectiveId: "G5-A-1" })).toBe("/student/learn/G5-A-1");
    expect(lessonHref({ kind: "CONTINUE", objectiveId: "G5-A-1" })).toBe("/student/learn/G5-A-1");
    expect(lessonHref({ kind: "REVIEW_DUE", objectiveId: "G5-A-1" })).toBe(
      "/student/learn/G5-A-1?mode=REVIEW",
    );
    expect(
      lessonHref({ kind: "FOUNDATION_CHECK", objectiveId: "G5-A-1", forObjectiveId: "G5-B-2" }),
    ).toBe("/student/learn/G5-A-1?mode=FOUNDATION&for=G5-B-2");
  });
});

describe("the reason for a suggestion", () => {
  const goals = gradeObjectives(GRADE).filter((o) => isPracticable(o.id));
  const rec = (
    over: Partial<Parameters<typeof reasonFor>[0]>,
  ): Parameters<typeof reasonFor>[0] => ({
    kind: "START_NEW",
    objectiveId: goals[0]!.id,
    reason: "planner text",
    because: {},
    suggestedDifficulty: 1,
    priority: 1,
    ...over,
  });

  it("does not repeat the goal, which the card already shows", () => {
    for (const kind of ["START_NEW", "CONTINUE", "REVIEW_DUE"] as const) {
      const text = reasonFor(rec({ kind }), PATH);
      expect(text).not.toContain(goals[0]!.text);
      expect(text).toMatch(/^[A-Z].*[.]$/);
    }
  });

  it("is gentle with a goal that is tricky, and names the tricky goal for a foundation check", () => {
    expect(reasonFor(rec({ kind: "CONTINUE", because: { struggling: true } }), PATH)).toMatch(
      /tricky/,
    );
    expect(reasonFor(rec({ kind: "CONTINUE", because: { state: "INTRODUCED" } }), PATH)).toMatch(
      /started/,
    );
    const text = reasonFor(rec({ kind: "FOUNDATION_CHECK", forObjectiveId: goals[5]!.id }), PATH);
    expect(text).toContain(goals[5]!.text);
  });
});

describe("the main card", () => {
  it("starts a new learner at the beginning, with a reason", () => {
    const { main, grade } = dashboard();
    expect(grade).toBe(GRADE);
    expect(main.kind).toBe("RECOMMENDED");
    expect(main.headline).toBe("Start something new");
    expect(main.goal?.grade).toBe(GRADE);
    expect(main.reason).toMatch(/\w/);
    expect(main.href).toBe(`/student/learn/${main.goal!.id}`);
  });

  it("carries on with a lesson left open, ahead of anything the planner would choose", () => {
    const goal = gradeObjectives(GRADE)[3]!;
    const { main } = dashboard(new Map(), [
      session({
        id: "open",
        objectiveId: goal.id,
        status: "ACTIVE",
        endedAt: null,
        summary: null,
        lastActivityAt: new Date(NOW.getTime() - 20 * 60_000).toISOString(),
      }),
    ]);
    expect(main).toMatchObject({ kind: "RESUME", action: "Continue" });
    expect(main.goal?.id).toBe(goal.id);
    expect(main.href).toBe(`/student/learn/${goal.id}`);
  });

  it("does not offer a lesson that has been left so long it would be closed", () => {
    const goal = gradeObjectives(GRADE)[3]!;
    const { main } = dashboard(new Map(), [
      session({
        id: "stale",
        objectiveId: goal.id,
        status: "ACTIVE",
        endedAt: null,
        summary: null,
        lastActivityAt: new Date(NOW.getTime() - 3 * 3_600_000).toISOString(),
      }),
    ]);
    expect(main.kind).toBe("RECOMMENDED");
  });

  it("offers a review when something mastered earlier is due", () => {
    const goals = gradeObjectives(GRADE).filter((o) => isPracticable(o.id));
    const due = goals[0]!;
    const { main } = dashboard(new Map([[due.id, mastered(60)]]));
    expect(main.kind).toBe("RECOMMENDED");
    expect(main.headline).toBe("Time for a quick review");
    expect(main.href).toBe(`/student/learn/${due.id}?mode=REVIEW`);
  });

  it("congratulates a learner who has mastered everything and offers nothing to start", () => {
    const all = new Map(
      gradeObjectives(GRADE)
        .filter((o) => isPracticable(o.id))
        .map((o) => [o.id, mastered(1)] as const),
    );
    const { main, practice } = dashboard(all);
    expect(main).toMatchObject({ kind: "ALL_DONE", href: null, goal: null });
    expect(main.headline).toMatch(/mastered every goal/);
    expect(practice).toEqual([]);
  });
});

describe("the practice list", () => {
  it("shows a few other things to do, never the goal on the main card", () => {
    const { main, practice } = dashboard();
    expect(practice.length).toBeGreaterThan(0);
    expect(practice.length).toBeLessThanOrEqual(4);
    for (const item of practice) {
      expect(item.goal.id).not.toBe(main.goal?.id);
      expect(item.href).toContain(`/student/learn/${encodeURIComponent(item.goal.id)}`);
      expect(item.label).toMatch(/\w/);
    }
    expect(new Set(practice.map((p) => p.goal.id)).size).toBe(practice.length);
  });

  it("includes the planner's own first choice when an open lesson is on the main card", () => {
    const goal = gradeObjectives(GRADE)[0]!;
    const { practice } = dashboard(new Map(), [
      session({
        id: "open",
        objectiveId: goal.id,
        status: "ACTIVE",
        endedAt: null,
        summary: null,
        lastActivityAt: NOW.toISOString(),
      }),
    ]);
    // the planner's own first choice is not on the main card now, so it is in the list
    expect(practice.length).toBeGreaterThan(0);
  });
});

describe("progress by topic and the mastery counts", () => {
  const goals = gradeObjectives(GRADE).filter((o) => isPracticable(o.id));
  const mastery = new Map<string, MasteryRecord>([
    [goals[0]!.id, mastered(1)],
    [goals[1]!.id, answered([true, true, false])],
    [goals[2]!.id, markIntroduced(newMasteryRecord(daysAgo(2)), daysAgo(2))],
    [goals[3]!.id, mastered(60)],
  ]);
  const { topics, tiles } = dashboard(mastery);

  it("counts every goal once", () => {
    expect(tiles.total).toBe(goals.length);
    expect(tiles.mastered + tiles.inProgress + tiles.review + tiles.notStarted).toBe(tiles.total);
    expect(tiles.mastered).toBe(1);
    expect(tiles.review).toBe(1);
    expect(tiles.inProgress).toBe(2);
  });

  it("gives each topic a percentage, its counts, and marks the suggested one", () => {
    expect(topics.length).toBe(4);
    for (const t of topics) {
      expect(t.percent).toBeGreaterThanOrEqual(0);
      expect(t.percent).toBeLessThanOrEqual(100);
      expect(t.mastered + t.inProgress + t.review).toBeLessThanOrEqual(t.total);
    }
    expect(topics.filter((t) => t.recommended).length).toBeLessThanOrEqual(1);
    expect(topics.reduce((n, t) => n + t.total, 0)).toBe(tiles.total);
  });
});

describe("recent work", () => {
  const goals = gradeObjectives(GRADE);
  const done = (id: string, daysBack: number, over: Partial<SessionRow> = {}) =>
    session({
      id,
      objectiveId: goals[0]!.id,
      endedAt: new Date(NOW.getTime() - daysBack * 86_400_000).toISOString(),
      ...over,
    });

  it("lists finished lessons, newest first, with counts and the outcome in words", () => {
    const { recent } = dashboard(new Map(), [
      done("older", 3),
      done("newest", 1, { summary: summary({ masteryEnd: { score: 0.5, state: "DEVELOPING" } }) }),
      done("middle", 2),
    ]);
    expect(recent.map((r) => r.sessionId)).toEqual(["newest", "middle", "older"]);
    expect(recent[0]).toMatchObject({ questions: 6, firstTry: 5, outcome: "Getting there" });
    expect(recent[1]!.outcome).toBe("Mastered");
  });

  it("leaves out lessons still open, lessons with no questions and lessons it cannot read", () => {
    const { recent } = dashboard(new Map(), [
      session({ id: "open", status: "ACTIVE", endedAt: null, summary: null }),
      done("none", 1, { status: "ABANDONED", summary: summary({ questions: 0 }) }),
      done("unreadable", 1, { summary: null }),
      done("fine", 2),
    ]);
    expect(recent.map((r) => r.sessionId)).toEqual(["fine"]);
  });

  it("shows at most five", () => {
    const sessions = Array.from({ length: 9 }, (_, i) => done(`s${i}`, i + 1));
    expect(dashboard(new Map(), sessions).recent).toHaveLength(5);
  });

  it("carries counts and outcomes only: nothing a child said or was told", () => {
    const { recent } = dashboard(new Map(), [done("a", 1)]);
    expect(Object.keys(recent[0]!).sort()).toEqual(
      [
        "endedAt",
        "firstTry",
        "goal",
        "hintsUsed",
        "minutes",
        "mode",
        "outcome",
        "questions",
        "sessionId",
      ].sort(),
    );
  });
});

describe("the progress screen", () => {
  const goals = gradeObjectives(GRADE).filter((o) => isPracticable(o.id));
  const mastery = new Map<string, MasteryRecord>([
    [goals[0]!.id, mastered(1)],
    [goals[1]!.id, mastered(60)],
    [goals[2]!.id, answered([true, false, true])],
  ]);
  const screen = buildProgressScreen({ learner: learnerWith(mastery), path: PATH });

  it("lists every practisable goal of the grade once, under its topic and sub-topic", () => {
    const rows = screen.topics.flatMap((t) => t.subtopics.flatMap((s) => s.goals));
    expect(rows.map((r) => r.goal.id).sort()).toEqual(goals.map((o) => o.id).sort());
    for (const topic of screen.topics) {
      for (const sub of topic.subtopics) {
        expect(sub.total).toBe(sub.goals.length);
        for (const row of sub.goals) expect(row.goal.topicName).toBe(topic.name);
      }
    }
  });

  it("says where each goal stands, in words, and flags a review", () => {
    const rows = new Map(
      screen.topics.flatMap((t) => t.subtopics.flatMap((s) => s.goals)).map((r) => [r.goal.id, r]),
    );
    expect(rows.get(goals[0]!.id)).toMatchObject({ stateLabel: "Mastered", review: false });
    expect(rows.get(goals[1]!.id)).toMatchObject({ stateLabel: "Time to review", review: true });
    expect(rows.get(goals[3]!.id)).toMatchObject({ stateLabel: "Not started", percent: 0 });
    expect(rows.get(goals[2]!.id)!.attempts).toBe(3);
    // a review opens as a review; everything else lets the tutor choose how to run the lesson
    for (const row of rows.values())
      expect(row.href).toBe(
        row.review ? `/student/learn/${row.goal.id}?mode=REVIEW` : `/student/learn/${row.goal.id}`,
      );
    expect(rows.get(goals[0]!.id)!.action).toBe("Practise again");
    expect(rows.get(goals[1]!.id)!.action).toBe("Review");
    expect(rows.get(goals[2]!.id)!.action).toBe("Keep going");
    expect(rows.get(goals[3]!.id)!.action).toBe("Start");
  });

  it("counts the goals that are done with real materials, so the screen can say so", () => {
    expect(screen.handsOn).toBe(gradeObjectives(GRADE).length - goals.length);
    expect(screen.handsOn).toBeGreaterThan(0);
  });
});
