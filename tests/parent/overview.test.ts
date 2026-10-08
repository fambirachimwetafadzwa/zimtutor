import { describe, expect, it } from "vitest";
import { practicableObjectiveIds } from "../../src/lib/adaptive/practice";
import type { MasteryRecord } from "../../src/lib/mastery/engine";
import { buildParentOverview, summariseWeek } from "../../src/lib/parent/overview";
import type { SessionRow } from "../../src/lib/student/dashboard";
import type { SessionSummary } from "../../src/lib/tutor/state";
import { NOW, PATH, answered, daysAgo, gradeObjectives, mastered } from "../adaptive/support";

const GRADE = 5;
const practicable = practicableObjectiveIds(PATH);
const goals = gradeObjectives(GRADE).filter((o) => practicable.has(o.id));
const learner = { name: "Chipo", grade: GRADE, username: "chipo1" };

const summary = (over: Partial<SessionSummary> = {}): SessionSummary => ({
  objectiveId: goals[0]!.id,
  mode: "LEARN",
  questions: 6,
  firstTry: 4,
  hintsUsed: 2,
  minutes: 10.4,
  masteryStart: null,
  masteryEnd: { score: 0.6, state: "DEVELOPING" },
  endedBy: "SESSION_DONE",
  ...over,
});

const finished = (id: string, daysBack: number, over: Partial<SessionRow> = {}): SessionRow => ({
  id,
  objectiveId: goals[0]!.id,
  status: "COMPLETED",
  lastActivityAt: daysAgo(daysBack).toISOString(),
  endedAt: daysAgo(daysBack).toISOString(),
  summary: summary(),
  ...over,
});

const overview = (mastery = new Map<string, MasteryRecord>(), sessions: SessionRow[] = []) =>
  buildParentOverview({ learner, path: PATH, mastery, sessions, now: NOW });

describe("the last seven days", () => {
  it("adds up the lessons finished in the week", () => {
    const week = summariseWeek(
      [
        finished("a", 1),
        finished("b", 3, { summary: summary({ questions: 4, firstTry: 4, minutes: 5.2 }) }),
      ],
      NOW,
    );
    expect(week).toMatchObject({ lessons: 2, days: 2, minutes: 16, questions: 10, firstTry: 8 });
    expect(week.firstTryPercent).toBe(80);
  });

  it("never shows a lesson that took seconds as zero minutes", () => {
    const quick = finished("q", 1, { summary: summary({ minutes: 0.1 }) });
    expect(summariseWeek([quick], NOW).minutes).toBe(1);
    expect(summariseWeek([], NOW).minutes).toBe(0);
  });

  it("counts a day once however many lessons were finished in it", () => {
    const sameDay = [
      finished("a", 1),
      { ...finished("b", 1), endedAt: daysAgo(1.01).toISOString() },
    ];
    expect(summariseWeek(sameDay, NOW).days).toBe(1);
  });

  it("leaves out older lessons, lessons still open, lessons with no questions and unreadable ones", () => {
    const week = summariseWeek(
      [
        finished("old", 8),
        finished("open", 1, { status: "ACTIVE", endedAt: null, summary: null }),
        finished("empty", 1, { status: "ABANDONED", summary: summary({ questions: 0 }) }),
        finished("unreadable", 1, { summary: null }),
        finished("future", -1),
      ],
      NOW,
    );
    expect(week).toEqual({
      lessons: 0,
      days: 0,
      minutes: 0,
      questions: 0,
      firstTry: 0,
      firstTryPercent: null,
    });
  });
});

describe("where a child could use a hand", () => {
  const tricky = answered([false, false, false, false]);
  const fine = answered([true, true, true]);

  it("lists goals that have been tricky, with the numbers, and never a goal that is mastered", () => {
    const mastery = new Map<string, MasteryRecord>([
      [goals[0]!.id, tricky],
      [goals[1]!.id, fine],
      [goals[2]!.id, mastered(1)],
    ]);
    const { needsHand } = overview(mastery);
    expect(needsHand.map((n) => n.goal.id)).toEqual([goals[0]!.id]);
    expect(needsHand[0]).toMatchObject({ recentRight: 0, recentCount: 4, attempts: 4 });
  });

  it("shows the most recently tried first, and at most five", () => {
    const mastery = new Map<string, MasteryRecord>();
    goals
      .slice(0, 8)
      .forEach((g, i) =>
        mastery.set(g.id, answered([false, false, false, false], daysAgo(20 - i))),
      );
    const { needsHand } = overview(mastery);
    expect(needsHand).toHaveLength(5);
    const ids = needsHand.map((n) => n.goal.id);
    expect(ids[0]).toBe(goals[7]!.id); // started last, so tried most recently
  });

  it("says nothing is wrong when nothing is", () => {
    expect(overview().needsHand).toEqual([]);
  });
});

describe("recently mastered", () => {
  it("lists goals mastered, newest first, including those now due for review", () => {
    const mastery = new Map<string, MasteryRecord>([
      [goals[0]!.id, mastered(20)],
      [goals[1]!.id, mastered(2)],
      [goals[2]!.id, mastered(60)], // long ago: due for review, but it was mastered
    ]);
    const { recentlyMastered } = overview(mastery);
    expect(recentlyMastered.map((r) => r.goal.id)).toEqual([
      goals[1]!.id,
      goals[0]!.id,
      goals[2]!.id,
    ]);
  });
});

describe("the rest of the screen", () => {
  it("has the same counts and topics the child sees, and no 'practise next' suggestion", () => {
    const mastery = new Map<string, MasteryRecord>([[goals[0]!.id, mastered(1)]]);
    const o = overview(mastery);
    expect(o.tiles.total).toBe(goals.length);
    expect(o.tiles.mastered).toBe(1);
    expect(o.topics.every((t) => !t.recommended)).toBe(true);
    expect(o.topics.reduce((n, t) => n + t.total, 0)).toBe(goals.length);
  });

  it("remembers the last time the child did anything", () => {
    expect(overview().lastActive).toBeNull();
    const o = overview(new Map(), [
      finished("a", 4),
      finished("b", 2),
      finished("open", 1, {
        status: "ACTIVE",
        endedAt: null,
        summary: null,
        lastActivityAt: daysAgo(0.5).toISOString(),
      }),
    ]);
    expect(o.lastActive).toBe(daysAgo(0.5).toISOString());
  });

  it("lists finished lessons as counts and outcomes", () => {
    const o = overview(new Map(), [finished("a", 1), finished("b", 2)]);
    expect(o.recent.map((r) => r.sessionId)).toEqual(["a", "b"]);
    expect(o.recent[0]).toMatchObject({ questions: 6, firstTry: 4, outcome: "Getting there" });
  });
});

describe("practice papers", () => {
  const paper = (
    id: string,
    status: "IN_PROGRESS" | "COMPLETED",
    over: Record<string, unknown> = {},
  ) => ({
    id,
    kind: "EXAM_STYLE_PAPER_1" as const,
    paperNumber: 1 as const,
    length: "SHORT" as const,
    status,
    startedAt: "2026-10-07T08:00:00Z",
    completedAt: status === "COMPLETED" ? "2026-10-07T09:00:00Z" : null,
    marksAwarded: status === "COMPLETED" ? 14 : null,
    marksAvailable: 20,
    percent: status === "COMPLETED" ? 70 : null,
    bands: [{ band: "KNOWLEDGE_COMPREHENSION" as const, percent: 80 }],
    ...over,
  });

  it("shows only the papers that are finished, at most five", () => {
    const shown = buildParentOverview({
      learner,
      path: PATH,
      mastery: new Map(),
      sessions: [],
      papers: [
        paper("open", "IN_PROGRESS"),
        ...Array.from({ length: 7 }, (_, i) => paper(`done${i}`, "COMPLETED")),
      ],
      now: NOW,
    }).papers;
    expect(shown).toHaveLength(5);
    expect(shown.every((p) => p.status === "COMPLETED")).toBe(true);
  });

  it("has none when there are none", () => {
    expect(overview().papers).toEqual([]);
  });
});

describe("privacy", () => {
  it("contains no word of any conversation and no individual answer: only goals, counts and times", () => {
    const mastery = new Map<string, MasteryRecord>([
      [goals[0]!.id, answered([false, false, false, false])],
      [goals[1]!.id, mastered(3)],
    ]);
    const o = overview(mastery, [finished("a", 1)]);
    // every string in the overview is a name, a goal from the syllabus, a topic name, an id, a label or a time
    const strings: string[] = [];
    const walk = (value: unknown) => {
      if (typeof value === "string") strings.push(value);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") Object.values(value).forEach(walk);
    };
    walk(o);
    const syllabus = new Set<string>();
    for (const g of PATH.all) {
      syllabus.add(g.text);
      syllabus.add(g.topicName);
      syllabus.add(g.subtopicName);
      syllabus.add(g.id);
      syllabus.add(g.topicId);
      syllabus.add(g.topicCode);
    }
    const allowed = new Set(["Chipo", "chipo1", "Getting there", "LEARN", "a"]);
    for (const text of strings) {
      const isTime = !Number.isNaN(Date.parse(text)) && /^\d{4}-\d\d-\d\dT/.test(text);
      expect(syllabus.has(text) || allowed.has(text) || isTime, `unexpected text: ${text}`).toBe(
        true,
      );
    }
  });
});
