import { describe, expect, it } from "vitest";
import type { Run } from "../../src/ingestion/pdf";
import { assembleText } from "../../src/ingestion/text";

function run(text: string, extra: Partial<Run> = {}): Run {
  return {
    text,
    x: 0,
    width: text.length * 5,
    baseline: 100,
    size: 12,
    font: "Times",
    bold: false,
    mcid: 1,
    artifact: false,
    formula: false,
    order: 0,
    ...extra,
  };
}

describe("assembleText", () => {
  it("joins runs and collapses whitespace", () => {
    const r = assembleText([run("Place "), run("value  of"), run(" digits")]);
    expect(r.text).toBe("Place value of digits");
    expect(r.sourceText).toBe("Place value of digits");
  });

  it("joins visual lines with a single space and records them", () => {
    const r = assembleText([
      run("Giving values of", { baseline: 100 }),
      run("digits in numbers", { baseline: 114 }),
    ]);
    expect(r.text).toBe("Giving values of digits in numbers");
    expect(r.lines).toEqual(["Giving values of", "digits in numbers"]);
  });

  it("turns a raised small digit into a superscript, keeping the verbatim source unchanged", () => {
    const r = assembleText([run("Standard measures in cm"), run("2", { size: 8, baseline: 96 })]);
    expect(r.text).toBe("Standard measures in cm²");
    expect(r.sourceText).toBe("Standard measures in cm2");
    expect(r.normalizations).toEqual(["SUPERSCRIPT"]);
  });

  it("handles powers of ten", () => {
    const r = assembleText([
      run("(2 x 10"),
      run("4", { size: 8, baseline: 96 }),
      run(") + (3 x 10"),
      run("3", { size: 8, baseline: 96 }),
      run(")"),
    ]);
    expect(r.text).toBe("(2 x 10⁴) + (3 x 10³)");
  });

  it("does not add junk for a space typeset in the small raised font (cm³ followed by a space)", () => {
    const r = assembleText([
      run("1cm"),
      run("3", { size: 8, baseline: 96 }),
      run(" ", { size: 8, baseline: 96 }),
      run("= 1ml"),
    ]);
    expect(r.text).toBe("1cm³ = 1ml");
    expect(r.normalizations).toEqual(["SUPERSCRIPT"]);
  });

  it("flags superscript it cannot map instead of silently guessing", () => {
    const r = assembleText([run("5"), run("th", { size: 8, baseline: 96 })]);
    expect(r.text).toBe("5^(th)");
    expect(r.normalizations).toEqual(["SUPERSCRIPT_UNMAPPED"]);
  });

  it("flags subscript text, which this syllabus is not expected to contain", () => {
    expect(
      assembleText([run("H"), run("2", { size: 8, baseline: 106 }), run("O")]).hasSubscript,
    ).toBe(true);
  });

  it("reports equation runs so the item can be forced through human review", () => {
    expect(assembleText([run("1 2", { formula: true })]).hasFormula).toBe(true);
    expect(assembleText([run("plain")]).hasFormula).toBe(false);
  });

  it("is empty for no runs", () => {
    expect(assembleText([])).toMatchObject({ text: "", lines: [] });
  });
});
