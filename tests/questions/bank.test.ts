import { describe, expect, it } from "vitest";
import { getPublicQuestion, getQuestionKey, pickQuestion } from "../../src/lib/questions/bank";
import { generateQuestion } from "../../src/lib/questions/generate";
import { ALL_TEMPLATES } from "../../src/lib/questions/templates";
import { checkAnswer, nextHint } from "../../src/lib/questions/answer";
import { MemoryBankStore } from "./memory-store";
import { OBJECTIVES } from "./support";

const objective = OBJECTIVES.find((o) => o.id === "G5-OPS-ADDITION-WHOLE-NUMBERS-001")!;
const learner = "learner-1";

describe("choosing the next question", () => {
  it("makes and saves a new question when the bank is small", async () => {
    const store = new MemoryBankStore();
    const picked = await pickQuestion(store, {
      learnerId: learner,
      objective,
      difficulty: 3,
      seed: "a",
    });
    expect(picked.reused).toBe(false);
    expect(store.questions.size).toBe(1);
    expect(picked.question.objectiveId).toBe(objective.id);
    expect(picked.question.difficulty).toBe(3);
    expect(picked.question.label.official).toBe(false);
  });

  it("is repeatable for the same seed", async () => {
    const a = await pickQuestion(new MemoryBankStore(), {
      learnerId: learner,
      objective,
      difficulty: 2,
      seed: "same",
    });
    const b = await pickQuestion(new MemoryBankStore(), {
      learnerId: learner,
      objective,
      difficulty: 2,
      seed: "same",
    });
    expect(b.question.stem).toBe(a.question.stem);
  });

  it("does not repeat the questions a learner has just had", async () => {
    const store = new MemoryBankStore();
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const picked = await pickQuestion(store, {
        learnerId: learner,
        objective,
        difficulty: 3,
        seed: `s${i}`,
      });
      expect(seen.has(picked.id), `repeated on turn ${i}`).toBe(false);
      seen.add(picked.id);
      store.attempt(learner, objective.id, picked.id);
    }
  });

  it("falls back to the question met longest ago when an objective has only a few questions", async () => {
    const store = new MemoryBankStore();
    const small = OBJECTIVES.find((o) => o.id === "G3-MEA-TIME-005")!; // convert hours to days
    const order: string[] = [];
    // meet every different question the objective has at this level
    for (let i = 0; i < 40; i++) {
      const picked = await pickQuestion(store, {
        learnerId: learner,
        objective: small,
        difficulty: 1,
        seed: `t${i}`,
      });
      if (!order.includes(picked.id)) order.push(picked.id);
      store.attempt(learner, small.id, picked.id);
    }
    expect(order.length).toBeLessThan(10);
    // once they are all recent, asking again still gives a question — the one met longest ago
    const again = await pickQuestion(store, {
      learnerId: learner,
      objective: small,
      difficulty: 1,
      seed: "again",
    });
    expect(order).toContain(again.id);
  });

  it("reuses a stored question once the bank is rich enough, never one the learner has just had", async () => {
    const store = new MemoryBankStore();
    // fill the bank with 30 different questions
    for (let i = 0; i < 30; i++)
      await store.save(
        generateQuestion({ objective, difficulty: 3, seed: `fill-${i}`, templates: ALL_TEMPLATES }),
      );
    expect(store.questions.size).toBeGreaterThanOrEqual(10);
    const recent = [...store.questions.keys()].slice(0, 3);
    for (const id of recent) store.attempt(learner, objective.id, id);
    const before = store.saves;
    const picked = await pickQuestion(store, {
      learnerId: learner,
      objective,
      difficulty: 3,
      seed: "reuse",
      reuseFrom: 10,
    });
    expect(picked.reused).toBe(true);
    expect(store.saves).toBe(before);
    expect(recent).not.toContain(picked.id);
  });

  it("prefers questions a teacher has checked", async () => {
    const store = new MemoryBankStore();
    for (let i = 0; i < 30; i++)
      await store.save(
        generateQuestion({ objective, difficulty: 2, seed: `fill-${i}`, templates: ALL_TEMPLATES }),
      );
    const reviewedId = [...store.questions.keys()][7]!;
    store.questions.get(reviewedId)!.verification_status = "ADMIN_REVIEWED";
    const picked = await pickQuestion(store, {
      learnerId: learner,
      objective,
      difficulty: 2,
      seed: "reviewed",
      reuseFrom: 5,
    });
    expect(picked.id).toBe(reviewedId);
    expect(picked.question.label.text).toMatch(/checked by a teacher/);
  });

  it("skips rejected questions and honours an exclude list", async () => {
    const store = new MemoryBankStore();
    for (let i = 0; i < 30; i++)
      await store.save(
        generateQuestion({ objective, difficulty: 4, seed: `fill-${i}`, templates: ALL_TEMPLATES }),
      );
    const ids = [...store.questions.keys()];
    for (const id of ids.slice(0, 20)) store.questions.get(id)!.verification_status = "REJECTED";
    const exclude = ids.slice(20, 25);
    const picked = await pickQuestion(store, {
      learnerId: learner,
      objective,
      difficulty: 4,
      seed: "x",
      exclude,
      reuseFrom: 1,
    });
    expect(ids.slice(0, 20)).not.toContain(picked.id);
    expect(exclude).not.toContain(picked.id);
  });
});

describe("reading a stored question", () => {
  it("gives a learner's view without the key, and the server its key", async () => {
    const store = new MemoryBankStore();
    const { id } = await pickQuestion(store, {
      learnerId: learner,
      objective,
      difficulty: 3,
      seed: "view",
    });
    const view = await getPublicQuestion(store, id);
    expect(view?.id).toBe(id);
    expect(Object.keys(view!)).not.toContain("marking");
    const key = await getQuestionKey(store, id);
    expect(key?.questionId).toBe(id);
    expect(checkAnswer(key!, key!.display).result.correct).toBe(true);
    expect(nextHint(key!, 0)).toBe(key!.hints[0]);
    expect(nextHint(key!, key!.hints.length)).toBeNull();
    expect(await getPublicQuestion(store, "missing")).toBeNull();
    expect(await getQuestionKey(store, "missing")).toBeNull();
  });
});
