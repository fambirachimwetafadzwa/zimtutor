import { describe, expect, it } from "vitest";
import { mark } from "../../src/lib/marking/mark";
import { canonicalKey, diagnose } from "../../src/lib/misconceptions/diagnose";

const numeric = { method: "EXACT_NUMERIC", value: "803" };

describe("diagnose", () => {
  const input = {
    distractorMap: { "703": "CARRYING_ERROR", "13": "PLACE_VALUE_CONFUSION" },
    candidateTags: ["CARRYING_ERROR", "PLACE_VALUE_CONFUSION", "UNIT_CONVERSION_ERROR"],
  };

  it("tags a predicted wrong answer, however it is typed", () => {
    for (const typed of ["703", " 703 ", "703.0", "0703"]) {
      expect(diagnose(input, mark(numeric, typed), typed), typed).toEqual(["CARRYING_ERROR"]);
    }
    expect(diagnose(input, mark(numeric, "13"), "13")).toEqual(["PLACE_VALUE_CONFUSION"]);
  });

  it("says nothing about right, unreadable or merely untidy answers", () => {
    expect(diagnose(input, mark(numeric, "803"), "803")).toEqual([]);
    expect(diagnose(input, mark(numeric, ""), "")).toEqual([]);
    expect(
      diagnose(
        input,
        mark({ method: "NUMERIC_WITH_UNIT", value: "803", unit: "cm" }, "803"),
        "803",
      ),
    ).toEqual([]);
  });

  it("says nothing about an unpredicted wrong answer", () => {
    expect(diagnose(input, mark(numeric, "111"), "111")).toEqual([]);
  });

  it("falls back to the power-of-ten signal by kind of question", () => {
    const conversion = {
      distractorMap: {},
      solutionKind: "unit-conversion",
      candidateTags: ["UNIT_CONVERSION_ERROR"],
    };
    expect(diagnose(conversion, mark(numeric, "8030"), "8030")).toEqual(["UNIT_CONVERSION_ERROR"]);
    const decimals = {
      distractorMap: {},
      solutionKind: "decimal-places",
      candidateTags: ["DECIMAL_PLACE_CONFUSION"],
    };
    expect(diagnose(decimals, mark(numeric, "80.3"), "80.3")).toEqual(["DECIMAL_PLACE_CONFUSION"]);
    const noKind = { distractorMap: {}, candidateTags: ["UNIT_CONVERSION_ERROR"] };
    expect(diagnose(noKind, mark(numeric, "8030"), "8030")).toEqual([]);
  });

  it("never returns a tag the question did not declare", () => {
    const stray = {
      distractorMap: { "703": "ORDER_OF_OPERATIONS_ERROR" },
      candidateTags: ["CARRYING_ERROR"],
    };
    expect(diagnose(stray, mark(numeric, "703"), "703")).toEqual([]);
  });

  it("tags multiple-choice picks and text answers", () => {
    const mcq = {
      distractorMap: { C: "FRACTION_SIZE_BY_DENOMINATOR" },
      candidateTags: ["FRACTION_SIZE_BY_DENOMINATOR"],
    };
    expect(diagnose(mcq, mark({ method: "MULTIPLE_CHOICE", correct: ["A"] }, "c"), "c")).toEqual([
      "FRACTION_SIZE_BY_DENOMINATOR",
    ]);
    const text = {
      distractorMap: { perimeter: "AREA_VS_PERIMETER" },
      candidateTags: ["AREA_VS_PERIMETER"],
    };
    expect(
      diagnose(
        text,
        mark({ method: "TEXT_NORMALISED", accepted: ["area"] }, "Perimeter."),
        "Perimeter.",
      ),
    ).toEqual(["AREA_VS_PERIMETER"]);
  });

  it("tags the wrong part of a multi-part question", () => {
    const spec = {
      method: "MULTI_PART",
      parts: [
        { id: "a", marks: 1, spec: { method: "EXACT_NUMERIC", value: "12" } },
        { id: "b", marks: 1, spec: { method: "EXACT_NUMERIC", value: "20" } },
      ],
    };
    const multi = {
      distractorMap: { "b:200": "DECIMAL_PLACE_CONFUSION" },
      candidateTags: ["DECIMAL_PLACE_CONFUSION"],
    };
    const answer = { a: "12", b: "200" };
    expect(diagnose(multi, mark(spec, answer), answer)).toEqual(["DECIMAL_PLACE_CONFUSION"]);
  });

  it("builds canonical keys the same way the generators will", () => {
    expect(canonicalKey("0,50")).toBe("0.5");
    expect(canonicalKey("1/3")).toBe("1/3");
    expect(canonicalKey("  Perimeter!  ")).toBe("perimeter");
    expect(canonicalKey("2 1/2")).toBe("2.5");
  });
});
