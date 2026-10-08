import { describe, expect, it } from "vitest";
import {
  POLICY,
  applySubmission,
  chooseTransition,
  classifyIntent,
  endsSession,
  mayRevealAnswer,
} from "../../src/lib/tutor/policy";
import { newSessionState, sessionStateSchema, type OpenQuestion } from "../../src/lib/tutor/state";

const open = (overrides: Partial<OpenQuestion> = {}): OpenQuestion => ({
  id: "q1",
  shownAt: "2026-10-08T08:00:00.000Z",
  difficulty: 2,
  hintCount: 3,
  submissions: 0,
  wrongAttempts: 0,
  almost: 0,
  hintsUsed: 0,
  tags: [],
  ...overrides,
});

describe("when the answer may be shown", () => {
  it("never to a child who has not tried", () => {
    expect(mayRevealAnswer(open())).toBe(false);
    expect(mayRevealAnswer(open({ hintsUsed: 3 }))).toBe(false);
  });

  it("not after one wrong try alone: a hint comes first", () => {
    expect(mayRevealAnswer(open({ wrongAttempts: 1 }))).toBe(false);
  });

  it("after a wrong try and a hint, after two wrong tries, or when there are no hints", () => {
    expect(mayRevealAnswer(open({ wrongAttempts: 1, hintsUsed: 1 }))).toBe(true);
    expect(mayRevealAnswer(open({ wrongAttempts: 2 }))).toBe(true);
    expect(mayRevealAnswer(open({ wrongAttempts: 1, hintCount: 0 }))).toBe(true);
    expect(mayRevealAnswer(open({ hintCount: 0 }))).toBe(false);
  });
});

describe("applying a marked answer", () => {
  it("a right answer is counted as a try", () => {
    const { question, outcome } = applySubmission(
      open({ submissions: 1, wrongAttempts: 1 }),
      "CORRECT",
      [],
    );
    expect(outcome).toBe("CORRECT");
    expect(question).toMatchObject({ submissions: 2, wrongAttempts: 1 });
  });

  it("wrong answers use up tries; the last one is exhausted", () => {
    let q = open();
    const outcomes: string[] = [];
    for (let i = 0; i < POLICY.maxWrongAttempts; i++) {
      const r = applySubmission(q, "INCORRECT", ["CARRYING_ERROR"]);
      q = r.question;
      outcomes.push(r.outcome);
    }
    expect(outcomes).toEqual(["WRONG", "WRONG", "EXHAUSTED"]);
    expect(q.submissions).toBe(3);
    // the same slip is remembered once
    expect(q.tags).toEqual(["CARRYING_ERROR"]);
  });

  it("collects different misconceptions in the order they appeared", () => {
    let q = open();
    q = applySubmission(q, "INCORRECT", ["PLACE_VALUE_CONFUSION"]).question;
    q = applySubmission(q, "INCORRECT", ["CARRYING_ERROR", "PLACE_VALUE_CONFUSION"]).question;
    expect(q.tags).toEqual(["PLACE_VALUE_CONFUSION", "CARRYING_ERROR"]);
  });

  it("a nearly-right answer costs nothing, until there are too many of them", () => {
    let q = open();
    for (let i = 0; i < POLICY.maxAlmost; i++) {
      const r = applySubmission(q, "ALMOST", []);
      expect(r.outcome).toBe("ALMOST");
      q = r.question;
    }
    expect(q).toMatchObject({
      wrongAttempts: 0,
      submissions: POLICY.maxAlmost,
      almost: POLICY.maxAlmost,
    });
    const tooMany = applySubmission(q, "ALMOST", []);
    expect(tooMany.outcome).toBe("WRONG");
    expect(tooMany.question.wrongAttempts).toBe(1);
  });

  it("unreadable input is free, and an unmarkable question is set aside", () => {
    const q = open({ submissions: 1 });
    expect(applySubmission(q, "INVALID_INPUT", [])).toEqual({ question: q, outcome: "UNREADABLE" });
    expect(applySubmission(q, "NEEDS_REVIEW", [])).toEqual({ question: q, outcome: "UNMARKABLE" });
  });
});

describe("what comes after a resolved question", () => {
  const base = {
    mode: "LEARN" as const,
    resolved: 2,
    wrongInARow: 0,
    stateBefore: "PRACTICING" as const,
    stateAfter: "PRACTICING" as const,
    lastWasCorrect: true,
  };

  it("carries on with another question by default", () => {
    expect(chooseTransition(base)).toBe("NEXT_QUESTION");
    expect(chooseTransition({ ...base, lastWasCorrect: false, wrongInARow: 1 })).toBe(
      "KEEP_PRACTISING",
    );
  });

  it("celebrates mastery once, not every time", () => {
    expect(chooseTransition({ ...base, stateBefore: "DEVELOPING", stateAfter: "MASTERED" })).toBe(
      "MASTERED",
    );
    expect(chooseTransition({ ...base, stateBefore: "MASTERED", stateAfter: "MASTERED" })).toBe(
      "NEXT_QUESTION",
    );
  });

  it("offers an easier question or a break after a run of wrong answers", () => {
    expect(chooseTransition({ ...base, wrongInARow: 3, lastWasCorrect: false })).toBe(
      "EASIER_OR_BREAK",
    );
  });

  it("ends a sitting after a fixed number of questions, shorter for a review or a foundation check", () => {
    expect(chooseTransition({ ...base, resolved: POLICY.questionsPerSession })).toBe(
      "SESSION_DONE",
    );
    expect(chooseTransition({ ...base, resolved: POLICY.questionsPerSession - 1 })).not.toBe(
      "SESSION_DONE",
    );
    expect(chooseTransition({ ...base, mode: "REVIEW", resolved: POLICY.reviewQuestions })).toBe(
      "SESSION_DONE",
    );
    expect(
      chooseTransition({ ...base, mode: "FOUNDATION", resolved: POLICY.foundationQuestions }),
    ).toBe("SESSION_DONE");
    expect(
      chooseTransition({ ...base, mode: "REVIEW", resolved: POLICY.reviewQuestions - 1 }),
    ).toBe("NEXT_QUESTION");
  });

  it("offers to move on when the goal is developing well", () => {
    expect(
      chooseTransition({ ...base, stateAfter: "DEVELOPING", resolved: POLICY.advanceAfter }),
    ).toBe("ADVANCE");
    expect(
      chooseTransition({ ...base, stateAfter: "DEVELOPING", resolved: POLICY.advanceAfter - 1 }),
    ).toBe("NEXT_QUESTION");
    // but not straight after a wrong answer
    expect(
      chooseTransition({
        ...base,
        stateAfter: "DEVELOPING",
        resolved: POLICY.advanceAfter,
        lastWasCorrect: false,
        wrongInARow: 1,
      }),
    ).toBe("KEEP_PRACTISING");
  });

  it("knows which decisions end the sitting", () => {
    expect(endsSession("MASTERED")).toBe(true);
    expect(endsSession("SESSION_DONE")).toBe(true);
    for (const d of ["NEXT_QUESTION", "ADVANCE", "KEEP_PRACTISING", "EASIER_OR_BREAK"] as const)
      expect(endsSession(d)).toBe(false);
  });
});

describe("what a typed message means", () => {
  it.each([
    ["can I have a hint please", "HINT"],
    ["i am stuck", "HINT"],
    ["help me", "HINT"],
    ["just tell me the answer", "SHOW_ANSWER"],
    ["show me the answer", "SHOW_ANSWER"],
    ["i give up", "SHOW_ANSWER"],
    ["what is the answer", "SHOW_ANSWER"],
    ["stop", "STOP"],
    ["i am done", "STOP"],
    ["bye", "STOP"],
    ["skip this one", "SKIP"],
    ["another question please", "SKIP"],
    ["this is too hard", "SKIP"],
    ["i don't understand", "EXPLAIN_AGAIN"],
    ["can you explain again", "EXPLAIN_AGAIN"],
    ["show me an example", "EXPLAIN_AGAIN"],
    ["why do we carry the one?", "OTHER"],
    ["what does numerator mean", "OTHER"],
  ])("%s → %s", (text, intent) => {
    expect(classifyIntent(text)).toBe(intent);
  });
});

describe("the session state", () => {
  it("starts empty and round-trips through its schema", () => {
    const state = newSessionState({
      mode: "FOUNDATION",
      forObjectiveId: "G5-NUM-X-001",
      now: new Date("2026-10-08T08:00:00Z"),
      masteryStart: { score: 0.4, state: "PRACTICING" },
    });
    expect(sessionStateSchema.parse(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(state).toMatchObject({ page: 0, resolved: 0, question: null, seen: [] });
  });

  it("rejects a state that is not one of ours", () => {
    expect(() => sessionStateSchema.parse({ v: 2 })).toThrow();
    expect(() =>
      sessionStateSchema.parse({
        ...newSessionState({ mode: "LEARN", now: new Date(), masteryStart: null }),
        resolved: -1,
      }),
    ).toThrow();
  });

  it("holds no words: only ids, counters and timestamps", () => {
    const state = newSessionState({ mode: "LEARN", now: new Date(), masteryStart: null });
    for (const value of Object.values(state)) expect(typeof value).not.toBe("function");
    expect(Object.keys(state).sort()).toEqual(
      [
        "exampleQuestionId",
        "firstTry",
        "hintsUsed",
        "masteryStart",
        "mode",
        "page",
        "question",
        "resolved",
        "seen",
        "skips",
        "startedAt",
        "v",
        "wrongInARow",
      ].sort(),
    );
  });
});
