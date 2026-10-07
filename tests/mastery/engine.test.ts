import { describe, expect, it } from "vitest";
import {
  applyObservation,
  bktPosterior,
  deriveState,
  evidenceFor,
  GUESS,
  markIntroduced,
  masteryGatesMet,
  newMasteryRecord,
  PRIOR,
  reviewDueAt,
  slipFor,
  type Difficulty,
  type MasteryRecord,
  type Observation,
} from "../../src/lib/mastery/engine";

const T0 = new Date("2026-03-01T09:00:00Z");
const day = (n: number) => new Date(T0.getTime() + n * 86_400_000);

const obs = (outcome: "CORRECT" | "INCORRECT", extra: Partial<Observation> = {}): Observation => ({
  outcome,
  difficulty: 1,
  hintsUsed: 0,
  attemptNumber: 1,
  questionType: "NUMERIC",
  at: T0,
  ...extra,
});

/** Feed outcomes the way the app does: each question is asked at the record's current target difficulty. */
function run(
  outcomes: Array<"CORRECT" | "INCORRECT">,
  start = newMasteryRecord(T0),
  step = 0,
): MasteryRecord {
  let record = start;
  outcomes.forEach((outcome, i) => {
    record = applyObservation(
      record,
      obs(outcome, { difficulty: record.difficulty, at: day(step + i) }),
    ).record;
  });
  return record;
}

describe("evidence", () => {
  it("is full for an independent answer, less with help, and zero for a wrong one", () => {
    expect(evidenceFor(obs("CORRECT"))).toBe(1);
    expect(evidenceFor(obs("CORRECT", { hintsUsed: 1 }))).toBe(0.75);
    expect(evidenceFor(obs("CORRECT", { hintsUsed: 2 }))).toBe(0.5);
    expect(evidenceFor(obs("CORRECT", { attemptNumber: 2 }))).toBe(0.8);
    expect(evidenceFor(obs("CORRECT", { hintsUsed: 2, attemptNumber: 3 }))).toBe(0.2);
    expect(evidenceFor(obs("CORRECT", { hintsUsed: 9, attemptNumber: 9 }))).toBe(0.2);
    expect(evidenceFor(obs("INCORRECT"))).toBe(0);
  });
});

describe("the knowledge-tracing update", () => {
  it("raises belief after a correct answer and lowers it after a wrong one", () => {
    const up = bktPosterior(0.4, 1, GUESS.NUMERIC, slipFor(1));
    const down = bktPosterior(0.4, 0, GUESS.NUMERIC, slipFor(1));
    expect(up).toBeGreaterThan(0.4);
    expect(down).toBeLessThan(0.4);
  });

  it("trusts a guessable multiple-choice answer less than a typed number", () => {
    expect(bktPosterior(0.3, 1, GUESS.MULTIPLE_CHOICE, slipFor(2))).toBeLessThan(
      bktPosterior(0.3, 1, GUESS.NUMERIC, slipFor(2)),
    );
    expect(bktPosterior(0.3, 1, GUESS.TRUE_FALSE, slipFor(2))).toBeLessThan(
      bktPosterior(0.3, 1, GUESS.MULTIPLE_CHOICE, slipFor(2)),
    );
  });

  it("counts a hinted answer for less than an independent one", () => {
    const independent = applyObservation(newMasteryRecord(T0), obs("CORRECT")).record.masteryScore;
    const hinted = applyObservation(newMasteryRecord(T0), obs("CORRECT", { hintsUsed: 2 })).record
      .masteryScore;
    expect(hinted).toBeLessThanOrEqual(independent);
  });

  it("expects harder questions to be slipped on more", () => {
    expect(slipFor(5)).toBeGreaterThan(slipFor(1));
  });
});

describe("applyObservation", () => {
  it("starts NOT_STARTED, becomes INTRODUCED when explained, and counts nothing until answered", () => {
    const fresh = newMasteryRecord(T0);
    expect(fresh).toMatchObject({
      currentState: "NOT_STARTED",
      attempts: 0,
      masteryScore: 0,
      recentAccuracy: null,
      difficulty: 1,
    });
    const introduced = markIntroduced(fresh, T0);
    expect(introduced.currentState).toBe("INTRODUCED");
    expect(introduced.attempts).toBe(0);
    expect(markIntroduced(introduced, T0)).toBe(introduced); // idempotent
  });

  it("records the counts, accuracy, confidence and last attempt the spec lists", () => {
    const { record, event } = applyObservation(
      newMasteryRecord(T0),
      obs("CORRECT", { at: day(1) }),
    );
    expect(record).toMatchObject({
      attempts: 1,
      correctAttempts: 1,
      incorrectAttempts: 0,
      recentOutcomes: [true],
      recentAccuracy: 1,
      lastAttemptAt: day(1),
    });
    expect(record.confidence).toBeGreaterThan(0);
    expect(record.masteryScore).toBeGreaterThan(PRIOR);
    expect(event).toMatchObject({ evidence: 1, scoreBefore: 0, stateBefore: "NOT_STARTED" });
    expect(event.scoreAfter).toBe(record.masteryScore);
    expect(event.reason).toContain("correct without help");
  });

  it("a first wrong answer does not look like progress", () => {
    const { record } = applyObservation(newMasteryRecord(T0), obs("INCORRECT"));
    expect(record.masteryScore).toBeLessThanOrEqual(PRIOR);
    expect(record.currentState).toBe("LEARNING");
    expect(record).toMatchObject({
      attempts: 1,
      correctAttempts: 0,
      incorrectAttempts: 1,
      recentOutcomes: [false],
    });
  });

  it("keeps the score in [0, 1] and moves it the right way, over thousands of random sequences", () => {
    let seed = 7;
    const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    const types = Object.keys(GUESS) as Array<keyof typeof GUESS>;
    for (let run = 0; run < 400; run++) {
      let record = newMasteryRecord(T0);
      for (let i = 0; i < 25; i++) {
        const o = obs(next() < 0.6 ? "CORRECT" : "INCORRECT", {
          difficulty: (1 + Math.floor(next() * 5)) as Difficulty,
          hintsUsed: Math.floor(next() * 3),
          attemptNumber: 1 + Math.floor(next() * 3),
          questionType: types[Math.floor(next() * types.length)]!,
          at: day(i),
        });
        const before = record.masteryScore;
        const step = applyObservation(record, o);
        record = step.record;
        expect(record.masteryScore).toBeGreaterThanOrEqual(0);
        expect(record.masteryScore).toBeLessThanOrEqual(1);
        if (o.outcome === "CORRECT") expect(record.masteryScore).toBeGreaterThanOrEqual(before);
        else expect(record.masteryScore).toBeLessThanOrEqual(Math.max(before, PRIOR));
        expect(record.recentOutcomes.length).toBeLessThanOrEqual(10);
        expect(record.difficulty).toBeGreaterThanOrEqual(1);
        expect(record.difficulty).toBeLessThanOrEqual(5);
        expect(record.correctAttempts + record.incorrectAttempts).toBe(record.attempts);
        expect(record.confidence).toBeGreaterThanOrEqual(0);
        expect(record.confidence).toBeLessThanOrEqual(1);
      }
    }
  });

  it("is deterministic: the same history always gives the same record", () => {
    const history: Array<"CORRECT" | "INCORRECT"> = [
      "CORRECT",
      "INCORRECT",
      "CORRECT",
      "CORRECT",
      "INCORRECT",
      "CORRECT",
    ];
    expect(run(history)).toEqual(run(history));
  });

  it("only remembers the last ten independent outcomes", () => {
    const record = run(Array.from({ length: 14 }, (_, i) => (i < 4 ? "INCORRECT" : "CORRECT")));
    expect(record.recentOutcomes).toHaveLength(10);
    expect(record.recentAccuracy).toBeCloseTo(record.recentOutcomes.filter(Boolean).length / 10);
  });
});

describe("states", () => {
  it("moves LEARNING → PRACTICING → DEVELOPING as evidence accumulates", () => {
    const seen: string[] = [];
    let record = newMasteryRecord(T0);
    for (let i = 0; i < 6; i++) {
      record = applyObservation(
        record,
        obs("CORRECT", { difficulty: record.difficulty, at: day(i) }),
      ).record;
      seen.push(record.currentState);
    }
    expect(seen[0]).toBe("PRACTICING");
    expect(new Set(seen).size).toBeGreaterThan(1);
  });

  it("is not MASTERED after one or two successes, however high the score", () => {
    expect(run(["CORRECT"]).currentState).not.toBe("MASTERED");
    expect(run(["CORRECT", "CORRECT"]).currentState).not.toBe("MASTERED");
    expect(run(["CORRECT", "CORRECT", "CORRECT"]).currentState).not.toBe("MASTERED");
  });

  it("cannot be earned on easy questions alone", () => {
    let record = newMasteryRecord(T0);
    for (let i = 0; i < 12; i++)
      record = applyObservation(record, obs("CORRECT", { difficulty: 1, at: day(i) })).record;
    expect(record.masteryScore).toBeGreaterThan(0.85);
    expect(record.hardCorrect).toBe(0);
    expect(masteryGatesMet(record)).toBe(false);
    expect(record.currentState).toBe("DEVELOPING");
  });

  it("is earned by sustained independent success as the questions get harder", () => {
    const record = run(Array.from({ length: 10 }, () => "CORRECT" as const));
    expect(record.currentState).toBe("MASTERED");
    expect(record.masteredAt).not.toBeNull();
    expect(record.hardCorrect).toBeGreaterThanOrEqual(2);
    expect(record.attempts).toBeGreaterThanOrEqual(4);
    expect(masteryGatesMet(record)).toBe(true);
  });

  it("is not earned by answers that needed help", () => {
    let record = newMasteryRecord(T0);
    for (let i = 0; i < 12; i++) {
      record = applyObservation(
        record,
        obs("CORRECT", { difficulty: 3, hintsUsed: 2, attemptNumber: 2, at: day(i) }),
      ).record;
    }
    expect(record.currentState).not.toBe("MASTERED");
    expect(record.hardCorrect).toBe(0);
  });

  it("forgives one slip after mastery but not a real decline", () => {
    const mastered = run(Array.from({ length: 10 }, () => "CORRECT" as const));
    const oneSlip = applyObservation(
      mastered,
      obs("INCORRECT", { difficulty: mastered.difficulty, at: day(30) }),
    ).record;
    expect(oneSlip.currentState).toBe("MASTERED");
    let declined = oneSlip;
    for (let i = 0; i < 4; i++)
      declined = applyObservation(
        declined,
        obs("INCORRECT", { difficulty: declined.difficulty, at: day(31 + i) }),
      ).record;
    expect(declined.currentState).not.toBe("MASTERED");
    expect(declined.masteredAt).toBeNull();
  });
});

describe("difficulty targeting", () => {
  it("rises after two independent successes and falls after two failures, within the learner's zone", () => {
    let record = newMasteryRecord(T0);
    expect(record.difficulty).toBe(1);
    record = applyObservation(record, obs("CORRECT", { at: day(0) })).record;
    record = applyObservation(
      record,
      obs("CORRECT", { difficulty: record.difficulty, at: day(1) }),
    ).record;
    expect(record.difficulty).toBeGreaterThan(1);
    const high = record.difficulty;
    record = applyObservation(
      record,
      obs("INCORRECT", { difficulty: record.difficulty, at: day(2) }),
    ).record;
    record = applyObservation(
      record,
      obs("INCORRECT", { difficulty: record.difficulty, at: day(3) }),
    ).record;
    expect(record.difficulty).toBeLessThan(high);
  });

  it("never races ahead of the estimated skill", () => {
    const record = run(["CORRECT", "CORRECT"]);
    expect(record.difficulty).toBeLessThanOrEqual(3);
    expect(run(Array.from({ length: 3 }, () => "INCORRECT" as const)).difficulty).toBe(1);
  });
});

describe("spaced review", () => {
  const mastered = () => run(Array.from({ length: 10 }, () => "CORRECT" as const));

  it("makes a mastered objective due after the interval, with the interval growing as reviews succeed", () => {
    const record = mastered();
    const lastDay = 9;
    expect(deriveState(record, day(lastDay + 1))).toBe("MASTERED");
    expect(reviewDueAt(record)!.getTime()).toBe(day(lastDay + 3).getTime());
    expect(deriveState(record, day(lastDay + 3))).toBe("REVIEW");

    const reviewed = applyObservation(
      record,
      obs("CORRECT", { difficulty: record.difficulty, at: day(lastDay + 4) }),
    ).record;
    expect(reviewed.reviewStage).toBe(1);
    expect(reviewed.currentState).toBe("MASTERED");
    expect(reviewDueAt(reviewed)!.getTime()).toBe(day(lastDay + 4 + 7).getTime());
    expect(deriveState(reviewed, day(lastDay + 4 + 6))).toBe("MASTERED");
    expect(deriveState(reviewed, day(lastDay + 4 + 7))).toBe("REVIEW");
  });

  it("brings the schedule back in after a failed review", () => {
    const record = { ...mastered(), reviewStage: 2 };
    const failed = applyObservation(
      record,
      obs("INCORRECT", { difficulty: record.difficulty, at: day(60) }),
    ).record;
    expect(failed.reviewStage).toBe(1);
  });

  it("does not apply to objectives that were never mastered", () => {
    const learning = run(["CORRECT", "INCORRECT"]);
    expect(reviewDueAt(learning)).toBeNull();
    expect(deriveState(learning, day(500))).toBe(learning.currentState);
  });
});
