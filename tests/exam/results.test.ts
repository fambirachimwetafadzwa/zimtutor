import { describe, expect, it } from "vitest";
import { buildPlan } from "../../src/lib/exam/plan";
import { summarise, type ResultItem } from "../../src/lib/exam/results";
import { STRUCTURE } from "./support";

const item = (over: Partial<ResultItem> & Pick<ResultItem, "section" | "number">): ResultItem => ({
  part: 1,
  marks: 1,
  band: "KNOWLEDGE_COMPREHENSION",
  topicCode: "NUM",
  objectiveId: "G7-NUM-X-001",
  awarded: 1,
  answered: true,
  tags: [],
  ...over,
});

describe("the result of a multiple-choice paper", () => {
  const plan = buildPlan(STRUCTURE, { paperNumber: 1, length: "SHORT" }); // 20 questions
  const items: ResultItem[] = Array.from({ length: 20 }, (_, i) =>
    item({
      section: "A",
      number: i + 1,
      band:
        i < 10 ? "KNOWLEDGE_COMPREHENSION" : i < 18 ? "APPLICATION_ANALYSIS" : "PROBLEM_SOLVING",
      topicCode: i % 2 === 0 ? "NUM" : "OPS",
      objectiveId: i % 2 === 0 ? "G7-NUM-X-001" : "G7-OPS-Y-001",
      awarded: i < 6 || (i >= 10 && i < 12) ? 1 : 0,
      answered: i !== 19,
      tags:
        i === 7
          ? ["PLACE_VALUE_CONFUSION"]
          : i === 9
            ? ["PLACE_VALUE_CONFUSION", "BASIC_FACT_ERROR"]
            : [],
    }),
  );
  const result = summarise(plan, items);

  it("marks it out of 20 and gives the percentage", () => {
    expect(result.marksAvailable).toBe(20);
    expect(result.marksAwarded).toBe(8);
    expect(result.percent).toBe(40);
  });

  it("divides the marks between the skills and the topics", () => {
    expect(result.bands).toEqual([
      { band: "KNOWLEDGE_COMPREHENSION", awarded: 6, available: 10, percent: 60 },
      { band: "APPLICATION_ANALYSIS", awarded: 2, available: 8, percent: 25 },
      { band: "PROBLEM_SOLVING", awarded: 0, available: 2, percent: 0 },
    ]);
    expect(result.topics.map((t) => t.topicCode)).toEqual(["NUM", "OPS"]);
    expect(result.topics.reduce((n, t) => n + t.awarded, 0)).toBe(8);
    expect(result.topics.reduce((n, t) => n + t.available, 0)).toBe(20);
  });

  it("counts the questions left alone, names where marks were lost and the slips that showed", () => {
    expect(result.unanswered).toBe(1);
    expect(result.revisit.reduce((n, r) => n + r.lost, 0)).toBe(12);
    expect(result.revisit[0]!.lost).toBeGreaterThanOrEqual(result.revisit[1]!.lost);
    expect(result.misconceptions).toEqual([
      { tag: "PLACE_VALUE_CONFUSION", count: 2 },
      { tag: "BASIC_FACT_ERROR", count: 1 },
    ]);
  });

  it("does not blame a slip on a question that was right", () => {
    const right = summarise(
      plan,
      items.map((i) => ({ ...i, awarded: 1, answered: true })),
    );
    expect(right.percent).toBe(100);
    expect(right.misconceptions).toEqual([]);
    expect(right.revisit).toEqual([]);
  });
});

describe("the result of a structured paper with a choice in section B", () => {
  const plan = buildPlan(STRUCTURE, { paperNumber: 2, length: "SHORT" }); // A: 5 q, 13 marks; B: 3 offered, 2 count
  const section = (id: string, number: number, parts: number, awarded: number, answered = true) =>
    Array.from({ length: parts }, (_, p) =>
      item({
        section: id,
        number,
        part: p + 1,
        awarded: p < awarded ? 1 : 0,
        answered,
        objectiveId: `G7-OPS-${id}${number}`,
      }),
    );
  const a = [
    ...section("A", 1, 3, 3),
    ...section("A", 2, 2, 2),
    ...section("A", 3, 3, 1),
    ...section("A", 4, 2, 0),
    ...section("A", 5, 3, 3),
  ];

  it("counts the best two of the questions answered in section B", () => {
    const b = [...section("B", 1, 5, 2), ...section("B", 2, 5, 5), ...section("B", 3, 5, 4)];
    const result = summarise(plan, [...a, ...b]);
    expect(result.marksAvailable).toBe(23);
    expect(result.marksAwarded).toBe(9 + 5 + 4);
    expect(result.counted).toEqual(["A:1", "A:2", "A:3", "A:4", "A:5", "B:2", "B:3"]);
    expect(result.unanswered).toBe(0);
  });

  it("counts a question not answered as nothing when fewer than two were answered", () => {
    const b = [
      ...section("B", 1, 5, 5),
      ...section("B", 2, 5, 0, false),
      ...section("B", 3, 5, 0, false),
    ];
    const result = summarise(plan, [...a, ...b]);
    expect(result.marksAvailable).toBe(23);
    expect(result.marksAwarded).toBe(9 + 5);
    expect(result.unanswered).toBe(1);
    expect(result.counted).toContain("B:1");
    expect(result.counted).toContain("B:2");
    expect(result.counted).not.toContain("B:3");
  });

  it("never counts more questions than the paper asks for", () => {
    const b = [...section("B", 1, 5, 5), ...section("B", 2, 5, 5), ...section("B", 3, 5, 5)];
    const result = summarise(plan, [...a, ...b]);
    expect(result.counted.filter((c) => c.startsWith("B:"))).toHaveLength(2);
    expect(result.marksAwarded).toBe(9 + 10);
  });
});
