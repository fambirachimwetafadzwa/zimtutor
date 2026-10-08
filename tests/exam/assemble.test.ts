import { describe, expect, it } from "vitest";
import {
  NotEnoughQuestions,
  achievedShares,
  assemble,
  type Candidate,
} from "../../src/lib/exam/assemble";
import { buildPlan } from "../../src/lib/exam/plan";
import { BANDS } from "../../src/lib/exam/structure";
import { Rng } from "../../src/lib/questions/rng";
import { STRUCTURE, poolFor } from "./support";

const pool = poolFor(7);
const plan = (
  paperNumber: 1 | 2,
  length: "FULL" | "SHORT",
  proportions?: Parameters<typeof buildPlan>[1]["proportions"],
) => buildPlan(STRUCTURE, { paperNumber, length, ...(proportions ? { proportions } : {}) });

const bandShares = (paper: ReturnType<typeof assemble>) => paper.achieved;

describe("the pool a Grade 7 paper is chosen from", () => {
  it("is large, covers every topic and every skill, and has no question twice", () => {
    expect(pool.length).toBeGreaterThan(400);
    expect(new Set(pool.map((c) => c.key)).size).toBe(pool.length);
    expect(new Set(pool.map((c) => c.topicCode))).toEqual(new Set(["NUM", "OPS", "MEA", "REL"]));
    for (const band of BANDS) expect(pool.some((c) => c.band === band)).toBe(true);
  });

  it("has multiple-choice questions in every skill, problem solving included", () => {
    for (const band of BANDS)
      expect(pool.filter((c) => c.choice && c.band === band).length, band).toBeGreaterThan(10);
  });
});

describe("a full multiple-choice paper (Paper 1)", () => {
  const paper = assemble(plan(1, "FULL"), pool, new Rng("paper-1"));

  it("has forty multiple-choice questions, numbered in order, one mark each, none twice", () => {
    expect(paper.items).toHaveLength(40);
    expect(paper.items.map((i) => i.number)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    expect(paper.items.every((i) => i.candidate.choice && i.marks === 1 && i.part === 1)).toBe(
      true,
    );
    expect(new Set(paper.items.map((i) => i.candidate.key)).size).toBe(40);
  });

  it("tests the skills in the proportions of the specification grid", () => {
    expect(paper.achieved).toEqual({
      KNOWLEDGE_COMPREHENSION: 50,
      APPLICATION_ANALYSIS: 40,
      PROBLEM_SOLVING: 10,
    });
    expect(paper.shortfalls).toEqual([]);
    // the report matches what is really in the paper
    expect(achievedShares(paper.plan, paper.items)).toEqual(paper.achieved);
  });

  it("spreads the questions over the topics and over the objectives", () => {
    const perTopic = new Map<string, number>();
    const perObjective = new Map<string, number>();
    for (const { candidate: c } of paper.items) {
      perTopic.set(c.topicCode, (perTopic.get(c.topicCode) ?? 0) + 1);
      perObjective.set(c.objectiveId, (perObjective.get(c.objectiveId) ?? 0) + 1);
    }
    for (const topic of ["NUM", "OPS", "MEA"])
      expect(perTopic.get(topic) ?? 0, topic).toBeGreaterThanOrEqual(5);
    expect(Math.max(...perObjective.values())).toBeLessThanOrEqual(3);
    expect(perObjective.size).toBeGreaterThanOrEqual(25);
  });

  it("puts the easier skills first, and within a skill the easier questions first", () => {
    const order = paper.items.map((i) => BANDS.indexOf(i.candidate.band));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const band of BANDS) {
      const levels = paper.items
        .filter((i) => i.candidate.band === band)
        .map((i) => i.candidate.difficulty);
      expect([...levels].sort((a, b) => a - b)).toEqual(levels);
    }
  });

  it("is the same paper for the same seed, and a different one for another", () => {
    const again = assemble(plan(1, "FULL"), pool, new Rng("paper-1"));
    expect(again.items.map((i) => i.candidate.key)).toEqual(
      paper.items.map((i) => i.candidate.key),
    );
    const other = assemble(plan(1, "FULL"), pool, new Rng("paper-2"));
    expect(other.items.map((i) => i.candidate.key)).not.toEqual(
      paper.items.map((i) => i.candidate.key),
    );
  });
});

describe("controllable proportions", () => {
  it("follows the shares an adult chose, to within one question", () => {
    for (const shares of [
      { KNOWLEDGE_COMPREHENSION: 70, APPLICATION_ANALYSIS: 20, PROBLEM_SOLVING: 10 },
      { KNOWLEDGE_COMPREHENSION: 20, APPLICATION_ANALYSIS: 40, PROBLEM_SOLVING: 40 },
      { KNOWLEDGE_COMPREHENSION: 0, APPLICATION_ANALYSIS: 50, PROBLEM_SOLVING: 50 },
    ]) {
      const paper = assemble(
        plan(1, "SHORT", shares),
        pool,
        new Rng(`shares-${shares.PROBLEM_SOLVING}`),
      );
      expect(paper.items).toHaveLength(20);
      for (const band of BANDS)
        expect(Math.abs(bandShares(paper)[band] - shares[band]), band).toBeLessThanOrEqual(5);
    }
  });
});

describe("when the pool cannot give what was asked", () => {
  const withoutProblemSolving = pool.filter((c) => c.band !== "PROBLEM_SOLVING");

  it("says so, with the shares it really reached, and fills from the nearest skill", () => {
    const paper = assemble(plan(1, "FULL"), withoutProblemSolving, new Rng("short"));
    expect(paper.items).toHaveLength(40);
    expect(paper.achieved.PROBLEM_SOLVING).toBe(0);
    expect(paper.shortfalls).toEqual([{ band: "PROBLEM_SOLVING", wanted: 4, got: 0 }]);
    expect(paper.achieved.APPLICATION_ANALYSIS).toBeGreaterThan(40);
  });

  it("refuses to make a paper of too few questions", () => {
    const few = pool.filter((c) => c.choice).slice(0, 12);
    expect(() => assemble(plan(1, "FULL"), few, new Rng("few"))).toThrow(NotEnoughQuestions);
    expect(() => assemble(plan(2, "FULL"), pool.slice(0, 8), new Rng("few"))).toThrow(
      NotEnoughQuestions,
    );
  });
});

describe("a full structured paper (Paper 2)", () => {
  const p = plan(2, "FULL");
  const paper = assemble(p, pool, new Rng("paper-2"));
  const questions = (section: string) => {
    const inSection = paper.items.filter((i) => i.section === section);
    const numbers = [...new Set(inSection.map((i) => i.number))];
    return numbers.map((n) => inSection.filter((i) => i.number === n));
  };

  it("has section A with ten questions of 25 marks and section B with six questions of five marks", () => {
    const a = questions("A");
    const b = questions("B");
    expect(a).toHaveLength(10);
    expect(a.map((parts) => parts.length)).toEqual(p.sections[0]!.marks);
    expect(a.flat().reduce((n, i) => n + i.marks, 0)).toBe(25);
    expect(b).toHaveLength(6);
    expect(b.every((parts) => parts.length === 5)).toBe(true);
  });

  it("makes every question a set of different parts on one theme, numbered (a), (b), ...", () => {
    for (const parts of [...questions("A"), ...questions("B")]) {
      expect(parts.map((i) => i.part)).toEqual(parts.map((_, i) => i + 1));
      expect(new Set(parts.map((i) => i.candidate.key)).size).toBe(parts.length);
      const topics = new Set(parts.map((i) => i.candidate.topicCode));
      expect(topics.size).toBe(1);
    }
    expect(new Set(paper.items.map((i) => i.candidate.key)).size).toBe(paper.items.length);
  });

  it("follows the specification grid closely, and reports what it reached", () => {
    for (const band of BANDS)
      expect(Math.abs(paper.achieved[band] - p.proportions[band]), band).toBeLessThanOrEqual(8);
    expect(achievedShares(p, paper.items)).toEqual(paper.achieved);
  });

  it("asks for a written answer rather than a choice where it can", () => {
    const choice = paper.items.filter((i) => i.candidate.choice).length;
    expect(choice / paper.items.length).toBeLessThan(0.5);
  });
});

describe("a pool of any shape", () => {
  it("never puts the same question in a paper twice, however small the pool", () => {
    const tiny: Candidate[] = pool
      .filter((c) => c.choice)
      .filter((_, i) => i % 5 === 0)
      .slice(0, 60);
    const paper = assemble(plan(1, "SHORT"), tiny, new Rng("tiny"));
    expect(new Set(paper.items.map((i) => i.candidate.key)).size).toBe(paper.items.length);
  });
});
