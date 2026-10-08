import { describe, expect, it } from "vitest";
import {
  bandCounts,
  buildPlan,
  distributeMarks,
  validateProportions,
} from "../../src/lib/exam/plan";
import { BANDS, parsePaperStructure } from "../../src/lib/exam/structure";
import { STRUCTURE } from "./support";

describe("the official structure, read from the syllabus", () => {
  it("has the two Grade 7 papers and the specification grid, each with the page they come from", () => {
    expect(
      STRUCTURE.papers.map((p) => [p.paperNumber, p.grade, p.marks, p.durationMinutes]),
    ).toEqual([
      [1, 7, 40, 120],
      [2, 7, 40, 120],
    ]);
    for (const paper of STRUCTURE.papers) expect(paper.citation.page).toBeGreaterThan(0);
    expect(STRUCTURE.documentTitle).toMatch(/Junior Mathematics Syllabus/);
    for (const number of [1, 2] as const)
      expect(BANDS.reduce((n, b) => n + STRUCTURE.proportions[number][b], 0)).toBe(100);
    expect(STRUCTURE.proportions[1]).toEqual({
      KNOWLEDGE_COMPREHENSION: 50,
      APPLICATION_ANALYSIS: 40,
      PROBLEM_SOLVING: 10,
    });
  });

  it("reads the prose-stated shape of each paper, and refuses one it does not know", () => {
    expect(
      parsePaperStructure({ question_type: "MULTIPLE_CHOICE", question_count: 40, marks_each: 1 }),
    ).toEqual({ kind: "CHOICE", questions: 40, marksEach: 1 });
    expect(() => parsePaperStructure({ question_type: "ESSAY" })).toThrow(/does not know/);
    expect(() =>
      parsePaperStructure({ question_type: "STRUCTURED", sections: [{ id: "A", total_marks: 5 }] }),
    ).toThrow(/how many questions/);
  });
});

describe("a full Paper 1", () => {
  const plan = buildPlan(STRUCTURE, { paperNumber: 1, length: "FULL" });

  it("has forty one-mark multiple-choice questions and the official time", () => {
    expect(plan.kind).toBe("EXAM_STYLE_PAPER_1");
    expect(plan.sections).toHaveLength(1);
    expect(plan.sections[0]).toMatchObject({ offered: 40, counted: 40 });
    expect(plan.sections[0]!.marks.every((m) => m === 1)).toBe(true);
    expect(plan.countedMarks).toBe(40);
    expect(plan.recommendedMinutes).toBe(120);
  });

  it("follows the specification grid unless an adult chose other shares", () => {
    expect(plan.proportions).toEqual(plan.officialProportions);
    const custom = buildPlan(STRUCTURE, {
      paperNumber: 1,
      length: "FULL",
      proportions: { KNOWLEDGE_COMPREHENSION: 70, APPLICATION_ANALYSIS: 20, PROBLEM_SOLVING: 10 },
    });
    expect(custom.proportions.KNOWLEDGE_COMPREHENSION).toBe(70);
    expect(custom.officialProportions.KNOWLEDGE_COMPREHENSION).toBe(50);
  });

  it("refuses shares that do not add up", () => {
    expect(() =>
      buildPlan(STRUCTURE, {
        paperNumber: 1,
        length: "FULL",
        proportions: { KNOWLEDGE_COMPREHENSION: 50, APPLICATION_ANALYSIS: 50, PROBLEM_SOLVING: 50 },
      }),
    ).toThrow(/add up to 100/);
  });

  it("cites the syllabus page it follows", () => {
    expect(plan.citation.page).toBe(82);
    expect(plan.title).toMatch(/Paper 1: 40 Multiple Choice Questions/);
  });
});

describe("a full Paper 2", () => {
  const plan = buildPlan(STRUCTURE, { paperNumber: 2, length: "FULL" });
  const [a, b] = plan.sections;

  it("has section A (ten questions, 25 marks, all answered) and section B (six of 5 marks, choose 3)", () => {
    expect(plan.kind).toBe("EXAM_STYLE_PAPER_2");
    expect(a).toMatchObject({ id: "A", offered: 10, counted: 10 });
    expect(a!.marks.reduce((x, y) => x + y, 0)).toBe(25);
    expect(a!.marks.every((m) => m === 2 || m === 3)).toBe(true);
    expect(b).toMatchObject({ id: "B", offered: 6, counted: 3 });
    expect(b!.marks).toEqual([5, 5, 5, 5, 5, 5]);
    expect(plan.countedMarks).toBe(40);
    expect(plan.recommendedMinutes).toBe(120);
  });
});

describe("a short paper", () => {
  it("is the same shape at half the size", () => {
    const one = buildPlan(STRUCTURE, { paperNumber: 1, length: "SHORT" });
    expect(one.sections[0]).toMatchObject({ offered: 20, counted: 20 });
    expect(one.recommendedMinutes).toBe(60);
    const two = buildPlan(STRUCTURE, { paperNumber: 2, length: "SHORT" });
    expect(two.sections[0]!.offered).toBe(5);
    expect(two.sections[0]!.marks.reduce((x, y) => x + y, 0)).toBe(13);
    expect(two.sections[1]).toMatchObject({ offered: 3, counted: 2 });
    expect(two.countedMarks).toBe(23);
  });
});

describe("marks and shares", () => {
  it("shares marks between questions as evenly as possible, never zero", () => {
    expect(distributeMarks(25, 10)).toEqual([3, 2, 3, 2, 3, 2, 3, 2, 3, 2]);
    expect(distributeMarks(13, 5).reduce((x, y) => x + y, 0)).toBe(13);
    for (const [total, count] of [
      [7, 3],
      [40, 40],
      [10, 4],
      [9, 9],
    ] as const) {
      const marks = distributeMarks(total, count);
      expect(marks).toHaveLength(count);
      expect(marks.reduce((x, y) => x + y, 0)).toBe(total);
      expect(Math.max(...marks) - Math.min(...marks)).toBeLessThanOrEqual(1);
      expect(Math.min(...marks)).toBeGreaterThanOrEqual(1);
    }
    expect(() => distributeMarks(3, 5)).toThrow();
  });

  it("turns shares into whole numbers of questions that add up exactly", () => {
    expect(
      bandCounts(40, {
        KNOWLEDGE_COMPREHENSION: 50,
        APPLICATION_ANALYSIS: 40,
        PROBLEM_SOLVING: 10,
      }),
    ).toEqual({ KNOWLEDGE_COMPREHENSION: 20, APPLICATION_ANALYSIS: 16, PROBLEM_SOLVING: 4 });
    for (const total of [1, 3, 7, 10, 20, 33, 40]) {
      for (const p of [
        { KNOWLEDGE_COMPREHENSION: 50, APPLICATION_ANALYSIS: 40, PROBLEM_SOLVING: 10 },
        { KNOWLEDGE_COMPREHENSION: 33, APPLICATION_ANALYSIS: 33, PROBLEM_SOLVING: 34 },
        { KNOWLEDGE_COMPREHENSION: 0, APPLICATION_ANALYSIS: 0, PROBLEM_SOLVING: 100 },
        { KNOWLEDGE_COMPREHENSION: 12.5, APPLICATION_ANALYSIS: 12.5, PROBLEM_SOLVING: 75 },
      ]) {
        const counts = bandCounts(total, p);
        expect(BANDS.reduce((n, b) => n + counts[b], 0)).toBe(total);
        for (const band of BANDS)
          expect(Math.abs(counts[band] - (total * p[band]) / 100)).toBeLessThan(1);
      }
    }
  });

  it("checks that a set of shares is usable", () => {
    expect(
      validateProportions({
        KNOWLEDGE_COMPREHENSION: 50,
        APPLICATION_ANALYSIS: 40,
        PROBLEM_SOLVING: 10,
      }),
    ).toBeNull();
    expect(
      validateProportions({
        KNOWLEDGE_COMPREHENSION: -5,
        APPLICATION_ANALYSIS: 55,
        PROBLEM_SOLVING: 50,
      }),
    ).toMatch(/0 to 100/);
    expect(
      validateProportions({
        KNOWLEDGE_COMPREHENSION: 50,
        APPLICATION_ANALYSIS: 30,
        PROBLEM_SOLVING: 10,
      }),
    ).toMatch(/add up to 100/);
    expect(
      validateProportions({
        KNOWLEDGE_COMPREHENSION: Number.NaN,
        APPLICATION_ANALYSIS: 50,
        PROBLEM_SOLVING: 50,
      }),
    ).toMatch(/0 to 100/);
  });
});
