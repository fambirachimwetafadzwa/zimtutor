import { describe, expect, it } from "vitest";
import {
  evaluateExpression,
  isSumOfTerms,
  leftToRightValue,
  sameValue,
} from "../../src/lib/marking/expression";
import { Rational } from "../../src/lib/marking/rational";

const value = (text: string) => {
  const r = evaluateExpression(text);
  if (!r.ok) throw new Error(`${text}: ${r.error}`);
  return r.value.toString();
};

describe("evaluateExpression", () => {
  it.each([
    ["2 + 3", "5"],
    ["2 + 3 × 4", "14"],
    ["(2 + 3) × 4", "20"],
    ["12 x 5", "60"],
    ["12 X 5", "60"],
    ["20 ÷ 4", "5"],
    ["20 / 4 / 5", "1"],
    ["10 − 2 − 3", "5"],
    ["2(3 + 4)", "14"],
    ["(1 + 2)(3 + 4)", "21"],
    ["2^3", "8"],
    ["2³", "8"],
    ["10 − 2²", "6"],
    ["-3 + 5", "2"],
    ["3 - -2", "5"],
    ["50%", "0.5"],
    ["3,96 ÷ 3", "1.32"],
    ["2,5 ÷ 5", "0.5"],
    ["0.1 + 0.2", "0.3"],
    ["1/2 + 1/4", "0.75"],
    ["1 000 + 5", "1005"],
    ["[2 + 3] × {4}", "20"],
    ["3 + 4 =", "7"],
  ])("%s = %s", (text, expected) => {
    expect(value(text)).toBe(expected);
  });

  it("is exact with decimals and fractions", () => {
    expect(sameValue("0.1 + 0.2", "0.3")).toBe(true);
    expect(sameValue("1/3 + 1/3 + 1/3", "1")).toBe(true);
    expect(sameValue("2 + 3", "4 + 2")).toBe(false);
  });

  it("reports what is wrong instead of guessing", () => {
    expect(evaluateExpression("")).toEqual({ ok: false, error: "EMPTY" });
    expect(evaluateExpression("2 +")).toEqual({ ok: false, error: "SYNTAX" });
    expect(evaluateExpression("(2 + 3")).toEqual({ ok: false, error: "SYNTAX" });
    expect(evaluateExpression("2 + abc")).toEqual({ ok: false, error: "SYNTAX" });
    expect(evaluateExpression("5 ÷ 0")).toEqual({ ok: false, error: "DIVISION_BY_ZERO" });
    expect(evaluateExpression("2^100")).toEqual({ ok: false, error: "TOO_COMPLEX" });
  });

  it("is safe against hostile input", () => {
    expect(evaluateExpression("process.exit(1)").ok).toBe(false);
    expect(evaluateExpression("constructor")).toEqual({ ok: false, error: "SYNTAX" });
    expect(evaluateExpression("(".repeat(500))).toEqual({ ok: false, error: "TOO_COMPLEX" });
    expect(evaluateExpression("(".repeat(40) + "1" + ")".repeat(40))).toEqual({
      ok: false,
      error: "TOO_COMPLEX",
    });
    expect(evaluateExpression("9".repeat(300))).toEqual({ ok: false, error: "TOO_COMPLEX" });
    expect(evaluateExpression("1+".repeat(60) + "1").ok).toBe(true);
  });
});

describe("leftToRightValue (the order-of-operations slip)", () => {
  it("gives the value of ignoring precedence when it differs from the truth", () => {
    expect(leftToRightValue("2 + 3 × 4")?.toString()).toBe("20");
    expect(leftToRightValue("10 − 2 × 3")?.toString()).toBe("24");
    expect(leftToRightValue("5 + 10 ÷ 5")?.toString()).toBe("3");
    expect(leftToRightValue("2 + 3 × 4 − 1")?.toString()).toBe("19");
  });

  it("respects brackets", () => {
    expect(leftToRightValue("(2 + 3) × 4")).toBeNull(); // same as the true value: no slip possible
    expect(leftToRightValue("2 × (3 + 4) − 5")).toBeNull();
    expect(leftToRightValue("2 + (3 × 4) + 1")).toBeNull(); // (2 + 12) + 1 is the true value too
  });

  it("returns null when precedence makes no difference or the text cannot be read", () => {
    expect(leftToRightValue("2 + 3 + 4")).toBeNull();
    expect(leftToRightValue("not maths")).toBeNull();
  });
});

describe("isSumOfTerms (expanded notation)", () => {
  it("accepts the place-value breakdown in any order and style", () => {
    expect(isSumOfTerms("4000 + 300 + 5", [4000, 300, 5])).toBe(true);
    expect(isSumOfTerms("5 + 300 + 4000", [4000, 300, 5])).toBe(true);
    expect(isSumOfTerms("4×1000 + 3×100 + 5×1", [4000, 300, 5])).toBe(true);
    expect(isSumOfTerms("4 x 1000 + 3 x 100 + 5", [4000, 300, 5])).toBe(true);
  });

  it("rejects a sum that has the right total but is not the place-value breakdown", () => {
    expect(isSumOfTerms("4300 + 5", [4000, 300, 5])).toBe(false);
    expect(isSumOfTerms("4305", [4000, 300, 5])).toBe(false);
    // An empty place written as 0 is a fair expansion ("4000 + 300 + 0 + 5"), not a different breakdown.
    expect(isSumOfTerms("4000 + 300 + 0 + 5", [4000, 300, 5])).toBe(true);
    expect(isSumOfTerms("4000 + 300 + 5 + 5", [4000, 300, 5])).toBe(false);
    expect(isSumOfTerms("4000 + 300", [4000, 300, 5])).toBe(false);
    expect(isSumOfTerms("nonsense", [4000, 300, 5])).toBe(false);
    // Decimal expansions are given as exact decimals.
    expect(
      isSumOfTerms("3 + 0.4 + 0.05", [
        3,
        Rational.parseDecimal("0.4")!,
        Rational.parseDecimal("0.05")!,
      ]),
    ).toBe(true);
  });
});
