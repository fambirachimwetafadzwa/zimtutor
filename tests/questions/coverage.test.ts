import { describe, expect, it } from "vitest";
import { coverageReport } from "../../src/lib/questions/coverage";
import { ALL_TEMPLATES } from "../../src/lib/questions/templates";
import { OBJECTIVES } from "./support";

/**
 * Which objectives have machine-marked practice, and which are deliberately without it. A new
 * objective without a template, or a template that matches nothing, fails here: gaps in practice
 * are decided on purpose, never by accident.
 */

/** Objectives without generated practice, and why. */
const WITHOUT_PRACTICE: Record<string, string> = {
  "G3-MEA-MONEY-002":
    "Features on Zimbabwean coins and notes: factual content that changes when the currency is redesigned; needs verified source material, not generated text.",
  "G4-MEA-MONEY-004":
    "Heritage features on Zimbabwean coins and notes: needs verified source material.",
  "G5-MEA-MONEY-001": "Features on Zimbabwean currency: needs verified source material.",
  "G4-MEA-SHAPES-005":
    "Drawing solid shapes is a practical task on paper; it cannot be marked by the question types.",
  "G4-MEA-SHAPES-006": "Constructing solid shapes is a practical task with real materials.",
  "G6-MEA-SHAPES-002":
    "Drawing lines of symmetry is a practical task on paper (lines of symmetry are counted in G6-MEA-SHAPES-001 and -003).",
  "G7-MEA-SHAPES-2-3-DIMENSIONAL-003":
    "Constructing models of 3-dimensional shapes is a practical task with real materials.",
};

const report = coverageReport(OBJECTIVES, ALL_TEMPLATES);

describe("practice coverage", () => {
  it("leaves exactly the documented objectives without a template", () => {
    expect(report.uncovered.map((r) => r.objective.id).sort()).toEqual(
      Object.keys(WITHOUT_PRACTICE).sort(),
    );
  });

  it("only documents objectives that exist in the syllabus", () => {
    const known = new Set(OBJECTIVES.map((o) => o.id));
    for (const id of Object.keys(WITHOUT_PRACTICE)) expect(known.has(id), id).toBe(true);
  });

  it("has no template that matches no objective", () => {
    expect(report.unusedTemplates).toEqual([]);
  });

  it("covers at least 98% of the 444 objectives", () => {
    expect(report.rows).toHaveLength(444);
    expect(report.covered.length / report.rows.length).toBeGreaterThanOrEqual(0.98);
  });

  it("covers every grade and every one of the four topics", () => {
    for (const grade of [3, 4, 5, 6, 7]) {
      const inGrade = report.covered.filter((r) => r.objective.grade === grade);
      expect(inGrade.length, `Grade ${grade}`).toBeGreaterThan(40);
    }
    for (const topic of ["NUM", "OPS", "MEA", "REL"] as const) {
      const all = report.rows.filter((r) => r.objective.topicCode === topic);
      const covered = all.filter((r) => r.templateIds.length > 0);
      expect(all.length, `${topic} objectives`).toBeGreaterThan(0);
      expect(covered.length / all.length, topic).toBeGreaterThanOrEqual(0.95);
    }
  });

  it("gives template ids that are unique, lower-case and stable", () => {
    const ids = ALL_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(\.[a-z0-9-]+)+$/);
  });
});
