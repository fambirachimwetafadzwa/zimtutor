import { describe, expect, it } from "vitest";
import { toMultipleChoice } from "../../src/lib/exam/mcq";
import { mark } from "../../src/lib/marking/mark";
import { isMisconceptionCode } from "../../src/lib/misconceptions/registry";
import { generateQuestion, type VerifiedQuestion } from "../../src/lib/questions/generate";
import { fmtInt } from "../../src/lib/questions/kit";
import { Rng } from "../../src/lib/questions/rng";
import { ALL_TEMPLATES } from "../../src/lib/questions/templates";
import { answerFormsFrom, findLeak } from "../../src/lib/questions/verify";
import { OBJECTIVES } from "../questions/support";

/** Whole-number answers offered as a choice (Paper 1 is multiple choice). */

interface Sample {
  base: VerifiedQuestion;
  converted: VerifiedQuestion;
}

function samples(): { converted: Sample[]; refused: number } {
  const out: Sample[] = [];
  let refused = 0;
  for (const objective of OBJECTIVES.filter((o) => o.grade >= 6)) {
    for (const difficulty of [1, 2, 3, 4, 5] as const) {
      for (const seed of ["mc-a", "mc-b"]) {
        let base: VerifiedQuestion;
        try {
          base = generateQuestion({ objective, difficulty, seed, templates: ALL_TEMPLATES });
        } catch {
          break;
        }
        if (base.marking.method !== "EXACT_NUMERIC") continue;
        const converted = toMultipleChoice(base, new Rng(`${seed}|choice`));
        if (converted) out.push({ base, converted });
        else refused++;
      }
    }
  }
  return { converted: out, refused };
}

const { converted, refused } = samples();

describe("a whole-number answer offered as a choice", () => {
  it("is possible for a good number of questions, and declined for the rest", () => {
    expect(converted.length).toBeGreaterThan(150);
    expect(refused).toBeGreaterThan(0);
  });

  it("includes problem-solving questions, which the natural multiple-choice questions lack", () => {
    const skills = new Set(converted.map((c) => c.converted.assessmentSkill));
    expect(skills).toContain("PROBLEM_SOLVING");
  });

  it("makes four distinct options with exactly one right answer, marked by the engine", () => {
    for (const { base, converted: q } of converted) {
      expect(q.type, q.stem).toBe("MULTIPLE_CHOICE");
      expect(q.options, q.stem).toHaveLength(4);
      expect(new Set(q.options!.map((o) => o.text)).size).toBe(4);
      expect(q.marking.method).toBe("MULTIPLE_CHOICE");
      const rightText = q.options!.find((o) => o.id === q.correctAnswer)!.text;
      expect(rightText).toBe(
        fmtInt(Number(base.marking.method === "EXACT_NUMERIC" ? base.marking.value : NaN)),
      );
      for (const option of q.options!) {
        const result = mark(q.marking, option.id);
        expect(result.correct, `${q.stem} → ${option.id}`).toBe(option.id === q.correctAnswer);
      }
    }
  });

  it("keeps the misconception each predicted wrong answer shows, on the option that shows it", () => {
    let withTags = 0;
    for (const { base, converted: q } of converted) {
      for (const [optionId, tag] of Object.entries(q.distractorMap)) {
        withTags++;
        expect(isMisconceptionCode(tag)).toBe(true);
        const option = q.options!.find((o) => o.id === optionId)!;
        // that option's number really is one the base question predicted would show this slip
        const predicted = Object.entries(base.distractorMap).find(
          ([value]) => fmtInt(Number(value)) === option.text,
        );
        expect(predicted?.[1], `${q.stem}: ${option.text}`).toBe(tag);
      }
      expect(q.distractorMap[q.correctAnswer as string]).toBeUndefined();
    }
    expect(withTags).toBeGreaterThan(100);
  });

  it("keeps the question's own words, picture and hints, and none of the hints gives the answer away", () => {
    for (const { base, converted: q } of converted) {
      expect(q.stem).toBe(base.stem);
      expect(q.stemData).toEqual(base.stemData);
      expect(q.hints).toEqual(base.hints);
      // the same check every question passes: no hint contains the right answer (a one-digit answer is
      // not checked, because the digit is bound to turn up in the question's own words)
      const forms = answerFormsFrom({
        marking: q.marking,
        correctAnswer: q.correctAnswer,
        options: q.options,
      });
      for (const hint of q.hints) expect(findLeak(hint, forms), hint).toBeNull();
      expect(q.answerHint).toBeUndefined();
    }
  });

  it("is the same every time for the same seed, and a new question (new hash) for the bank", () => {
    const first = converted[0]!;
    const again = toMultipleChoice(first.base, new Rng("mc-a|choice"));
    expect(again?.options).toEqual(first.converted.options);
    expect(first.converted.contentHash).not.toBe(first.base.contentHash);
    expect(first.converted.templateId).toBe(`${first.base.templateId}.choice`);
    for (const c of converted) expect(c.converted.contentHash).not.toBe(c.base.contentHash);
  });

  it("declines what it cannot do safely", () => {
    const rng = new Rng("x");
    const all: VerifiedQuestion[] = [];
    for (const objective of OBJECTIVES.filter((o) => o.grade === 7)) {
      try {
        all.push(
          generateQuestion({ objective, difficulty: 3, seed: "decline", templates: ALL_TEMPLATES }),
        );
      } catch {
        /* no template at this level */
      }
    }
    for (const q of all) {
      const result = toMultipleChoice(q, rng);
      if (q.marking.method !== "EXACT_NUMERIC") expect(result, q.stem).toBeNull();
      if (/\b(?:type|write|enter|round)\b/i.test(q.stem)) expect(result, q.stem).toBeNull();
    }
  });
});
