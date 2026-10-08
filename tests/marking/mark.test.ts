import { describe, expect, it } from "vitest";
import { mark, normaliseText, powerOfTenDistance } from "../../src/lib/marking/mark";
import { Rational } from "../../src/lib/marking/rational";
import { MarkingConfigError } from "../../src/lib/marking/spec";

const status = (spec: unknown, answer: Parameters<typeof mark>[1]) => mark(spec, answer).status;

describe("EXACT_NUMERIC", () => {
  const spec = (value: string, extra: Record<string, unknown> = {}) => ({
    method: "EXACT_NUMERIC",
    value,
    ...extra,
  });

  it("marks equal values correct whatever the formatting", () => {
    for (const answer of [
      "12.5",
      " 12,5 ",
      "12.50",
      "12 1/2",
      "25/2",
      "twelve and a half".length ? "12.5" : "",
    ]) {
      expect(status(spec("12.5"), answer), answer).toBe("CORRECT");
    }
    expect(status(spec("1000"), "1 000")).toBe("CORRECT");
    expect(status(spec("1000"), "1000")).toBe("CORRECT");
    expect(status(spec("1250000"), "1,250,000")).toBe("CORRECT");
    expect(status(spec("405"), "four hundred and five")).toBe("CORRECT");
    expect(status(spec("6"), "six")).toBe("CORRECT");
  });

  it("is exact where floating point is not: 0.1 + 0.2", () => {
    expect(status(spec("0.3"), "0.30")).toBe("CORRECT");
    expect(status(spec("0.3"), "3/10")).toBe("CORRECT");
    expect(status(spec("0.3"), "0.30000000000000004")).toBe("INCORRECT");
  });

  it("marks wrong values incorrect and says nothing about the right one", () => {
    const r = mark(spec("12.5"), "13");
    expect(r.status).toBe("INCORRECT");
    expect(r.score).toBe(0);
    expect(JSON.stringify(r.detail)).not.toContain("12.5");
  });

  it('accepts either reading of the ambiguous "1,234"', () => {
    const thousands = mark(spec("1234"), "1,234");
    expect(thousands.status).toBe("CORRECT");
    expect(thousands.signals).toContain("AMBIGUOUS_SEPARATOR_ACCEPTED");
    const decimal = mark(spec("1.234"), "1,234");
    expect(decimal.status).toBe("CORRECT");
    expect(decimal.signals).not.toContain("AMBIGUOUS_SEPARATOR_ACCEPTED");
    expect(status(spec("12"), "1,234")).toBe("INCORRECT");
  });

  it("spots a place-value slip (answer off by a power of ten)", () => {
    expect(mark(spec("250"), "2500").signals).toContain("OFF_BY_POWER_OF_TEN");
    expect(mark(spec("250"), "25").signals).toContain("OFF_BY_POWER_OF_TEN");
    expect(mark(spec("250"), "251").signals).not.toContain("OFF_BY_POWER_OF_TEN");
    expect(powerOfTenDistance(Rational.of(2500), Rational.of(250))).toBe(1);
    expect(powerOfTenDistance(Rational.of(2), Rational.of(2000))).toBe(-3);
    expect(powerOfTenDistance(Rational.of(5), Rational.of(0))).toBeNull();
  });

  it("does not penalise input that cannot be marked", () => {
    expect(mark(spec("12"), "").status).toBe("INVALID_INPUT");
    expect(mark(spec("12"), "   ").signals).toEqual(["EMPTY"]);
    expect(mark(spec("12"), "banana").signals).toEqual(["NOT_A_NUMBER"]);
    expect(mark(spec("12"), "5 ÷ 0").status).toBe("INVALID_INPUT");
    expect(mark(spec("12"), "1/0").signals).toEqual(["DIVISION_BY_ZERO"]);
  });

  it("tells the learner when they typed a sum instead of its value", () => {
    const r = mark(spec("12"), "7 + 5");
    expect(r.status).toBe("INVALID_INPUT");
    expect(r.signals).toEqual(["EXPRESSION_GIVEN"]);
  });

  it("supports a tolerance for estimates and extra accepted answers", () => {
    expect(mark(spec("1000", { tolerance: "50" }), "1040").signals).toContain("WITHIN_TOLERANCE");
    expect(status(spec("1000", { tolerance: "50" }), "1040")).toBe("CORRECT");
    expect(status(spec("1000", { tolerance: "50" }), "1060")).toBe("INCORRECT");
    expect(status(spec("4", { alsoAccept: ["-4"] }), "-4")).toBe("CORRECT");
  });

  it("treats the right value in the wrong requested form as ALMOST (retry, no penalty)", () => {
    const asDecimal = spec("0.75", { requireForm: "decimal" });
    expect(status(asDecimal, "0.75")).toBe("CORRECT");
    expect(mark(asDecimal, "3/4").signals).toContain("WRONG_FORM");
    expect(status(asDecimal, "3/4")).toBe("ALMOST");
    const asFraction = spec("0.75", { requireForm: "fraction" });
    expect(status(asFraction, "3/4")).toBe("CORRECT");
    expect(status(asFraction, "6/8")).toBe("CORRECT"); // any fraction of the right value (lowest terms is a different method)
    expect(status(asFraction, "0.75")).toBe("ALMOST");
    expect(status(spec("25", { requireForm: "percent" }), "25%")).toBe("CORRECT");
    expect(status(spec("25", { requireForm: "percent" }), "25")).toBe("CORRECT");
  });

  it("refuses a malformed key loudly", () => {
    expect(() => mark({ method: "EXACT_NUMERIC" }, "1")).toThrow(MarkingConfigError);
    expect(() => mark(spec("not a number"), "1")).toThrow(MarkingConfigError);
    expect(() => mark({ method: "SOMETHING_ELSE" }, "1")).toThrow(MarkingConfigError);
  });
});

describe("fractions", () => {
  it("FRACTION_EQUIVALENT accepts any fraction of the right value, but not a decimal", () => {
    const spec = { method: "FRACTION_EQUIVALENT", value: "3/4" };
    expect(status(spec, "6/8")).toBe("CORRECT");
    expect(status(spec, "3/4")).toBe("CORRECT");
    expect(status(spec, "9/12")).toBe("CORRECT");
    expect(mark(spec, "0.75").signals).toContain("WRONG_FORM");
    expect(status(spec, "0.75")).toBe("ALMOST");
    expect(status(spec, "2/3")).toBe("INCORRECT");
  });

  it("FRACTION_LOWEST_TERMS needs the simplified form", () => {
    const spec = { method: "FRACTION_LOWEST_TERMS", value: "3/4" };
    expect(status(spec, "3/4")).toBe("CORRECT");
    const unsimplified = mark(spec, "6/8");
    expect(unsimplified.status).toBe("ALMOST");
    expect(unsimplified.signals).toContain("NOT_IN_LOWEST_TERMS");
    expect(status(spec, "1/2")).toBe("INCORRECT");
  });

  it("works with mixed numbers and improper fractions", () => {
    const spec = { method: "FRACTION_LOWEST_TERMS", value: "5/2" };
    expect(status(spec, "5/2")).toBe("CORRECT");
    expect(status(spec, "2 1/2")).toBe("CORRECT");
    expect(status(spec, "2 2/4")).toBe("ALMOST");
    expect(status({ method: "FRACTION_EQUIVALENT", value: "2" }, "2")).toBe("CORRECT");
  });

  it("reports unreadable fractions without a penalty", () => {
    expect(status({ method: "FRACTION_EQUIVALENT", value: "1/2" }, "half")).toBe("INVALID_INPUT");
    expect(status({ method: "FRACTION_EQUIVALENT", value: "1/2" }, "")).toBe("INVALID_INPUT");
  });
});

describe("EXPRESSION_EQUIVALENT", () => {
  it("marks by exact value", () => {
    const spec = { method: "EXPRESSION_EQUIVALENT", expression: "3,96 ÷ 3" };
    expect(status(spec, "1.32")).toBe("CORRECT");
    expect(status(spec, "3.96/3")).toBe("CORRECT");
    expect(status(spec, "1.3")).toBe("INCORRECT");
    expect(status(spec, "1 +")).toBe("INVALID_INPUT");
  });

  it("accepts a comma as a thousands separator when that reading is the right one", () => {
    const spec = {
      method: "EXPRESSION_EQUIVALENT",
      expression: "45000",
      kind: "expanded",
      terms: [40000, 5000],
    };
    expect(status(spec, "40,000 + 5,000")).toBe("CORRECT");
    expect(status(spec, "40 000 + 5 000")).toBe("CORRECT");
    expect(status(spec, "40,000 + 6,000")).toBe("INCORRECT");
    // a decimal comma still works when that is the reading that fits
    expect(status({ method: "EXPRESSION_EQUIVALENT", expression: "3.456 + 2" }, "3,456 + 2")).toBe(
      "CORRECT",
    );
  });

  it("marks expanded notation by its terms, not just its total", () => {
    const spec = {
      method: "EXPRESSION_EQUIVALENT",
      expression: "4305",
      kind: "expanded",
      terms: [4000, 300, 5],
    };
    expect(status(spec, "4000 + 300 + 5")).toBe("CORRECT");
    expect(status(spec, "4 x 1000 + 3 x 100 + 5")).toBe("CORRECT");
    const rightTotal = mark(spec, "4300 + 5");
    expect(rightTotal.status).toBe("ALMOST");
    expect(rightTotal.signals).toContain("WRONG_FORM");
    expect(status(spec, "4000 + 300 + 50")).toBe("INCORRECT");
    expect(() =>
      mark({ method: "EXPRESSION_EQUIVALENT", expression: "4305", kind: "expanded" }, "4305"),
    ).toThrow(MarkingConfigError);
  });
});

describe("NUMERIC_WITH_UNIT", () => {
  const cm = { method: "NUMERIC_WITH_UNIT", value: "250", unit: "cm" };

  it("accepts the right number with the right unit, written any common way", () => {
    for (const answer of ["250 cm", "250cm", "250 centimetres", "250 CM"])
      expect(status(cm, answer), answer).toBe("CORRECT");
    expect(status({ method: "NUMERIC_WITH_UNIT", value: "12.5", unit: "$" }, "$12,50")).toBe(
      "CORRECT",
    );
    expect(status({ method: "NUMERIC_WITH_UNIT", value: "12.5", unit: "$" }, "12.50 dollars")).toBe(
      "CORRECT",
    );
    expect(status({ method: "NUMERIC_WITH_UNIT", value: "90", unit: "min" }, "1 h 30 min")).toBe(
      "ALMOST",
    ); // right quantity, wrong unit asked
  });

  it("treats a missing unit as ALMOST unless the question gave the unit", () => {
    expect(mark(cm, "250").signals).toContain("MISSING_UNIT");
    expect(status(cm, "250")).toBe("ALMOST");
    expect(status({ ...cm, unitOptional: true }, "250")).toBe("CORRECT");
    expect(status(cm, "251")).toBe("INCORRECT"); // the wrong number is simply wrong
  });

  it("treats the right quantity in another unit as ALMOST for conversions, correct otherwise", () => {
    expect(status(cm, "2.5 m")).toBe("ALMOST");
    expect(mark(cm, "2.5 m").signals).toContain("WRONG_UNIT");
    expect(status({ ...cm, strictUnit: false }, "2.5 m")).toBe("CORRECT");
    expect(status({ ...cm, strictUnit: false }, "25 m")).toBe("INCORRECT");
  });

  it("refuses a unit of a different kind", () => {
    const r = mark(cm, "250 kg");
    expect(r.status).toBe("INCORRECT");
    expect(r.signals).toContain("UNIT_DIMENSION_MISMATCH");
  });

  it("recognises the unit-conversion slip (a power of ten)", () => {
    expect(
      mark({ method: "NUMERIC_WITH_UNIT", value: "2500", unit: "m" }, "250 m").signals,
    ).toContain("OFF_BY_POWER_OF_TEN");
    expect(mark(cm, "2500 cm").signals).toContain("OFF_BY_POWER_OF_TEN");
  });

  it("adds compound quantities exactly", () => {
    const kg = { method: "NUMERIC_WITH_UNIT", value: "5.2", unit: "kg" };
    expect(status(kg, "5 kg 200 g")).toBe("CORRECT");
    expect(status(kg, "5 kg 20 g")).toBe("INCORRECT");
    expect(
      status({ method: "NUMERIC_WITH_UNIT", value: "1.5", unit: "h", strictUnit: false }, "90 min"),
    ).toBe("CORRECT");
    expect(status(kg, "5 kg 200 m")).toBe("INVALID_INPUT"); // mixed dimensions: not a quantity
  });

  it("handles areas, volumes, angles, percent and speed", () => {
    expect(status({ method: "NUMERIC_WITH_UNIT", value: "12", unit: "cm²" }, "12 cm2")).toBe(
      "CORRECT",
    );
    expect(status({ method: "NUMERIC_WITH_UNIT", value: "12", unit: "cm²" }, "12 sq cm")).toBe(
      "CORRECT",
    );
    expect(status({ method: "NUMERIC_WITH_UNIT", value: "27", unit: "cm³" }, "27 cm³")).toBe(
      "CORRECT",
    );
    expect(status({ method: "NUMERIC_WITH_UNIT", value: "90", unit: "°" }, "90 degrees")).toBe(
      "CORRECT",
    );
    expect(status({ method: "NUMERIC_WITH_UNIT", value: "25", unit: "%" }, "25%")).toBe("CORRECT");
    expect(status({ method: "NUMERIC_WITH_UNIT", value: "60", unit: "km/h" }, "60 km/h")).toBe(
      "CORRECT",
    );
    expect(
      status(
        { method: "NUMERIC_WITH_UNIT", value: "1", unit: "ha", strictUnit: false },
        "10 000 m²",
      ),
    ).toBe("CORRECT");
  });

  it("rejects an unknown expected unit as a configuration error", () => {
    expect(() => mark({ method: "NUMERIC_WITH_UNIT", value: "1", unit: "furlongs" }, "1")).toThrow(
      MarkingConfigError,
    );
  });
});

describe("choices and text", () => {
  it("MULTIPLE_CHOICE reads the way learners type options", () => {
    const spec = { method: "MULTIPLE_CHOICE", correct: ["B"] };
    for (const answer of ["B", "b", "(B)", "B.", "b)", " B "])
      expect(status(spec, answer), answer).toBe("CORRECT");
    expect(status(spec, "C")).toBe("INCORRECT");
    expect(status(spec, "")).toBe("INVALID_INPUT");
    expect(status({ method: "MULTIPLE_CHOICE", correct: ["A", "C"] }, "c")).toBe("CORRECT");
  });

  it("TRUE_FALSE accepts the natural ways to say it", () => {
    const spec = { method: "TRUE_FALSE", value: true };
    for (const answer of ["true", "True", "T", "yes", true])
      expect(status(spec, answer), String(answer)).toBe("CORRECT");
    for (const answer of ["false", "F", "no", false])
      expect(status(spec, answer), String(answer)).toBe("INCORRECT");
    expect(status(spec, "maybe")).toBe("INVALID_INPUT");
    expect(status({ method: "TRUE_FALSE", value: false }, "No")).toBe("CORRECT");
  });

  it("TEXT_NORMALISED ignores case, punctuation, articles and plurals", () => {
    const spec = { method: "TEXT_NORMALISED", accepted: ["rectangle"] };
    for (const answer of [
      "rectangle",
      "Rectangle",
      "A rectangle",
      "the rectangle.",
      "rectangles",
      "  RECTANGLE!  ",
    ]) {
      expect(status(spec, answer), answer).toBe("CORRECT");
    }
    expect(status(spec, "square")).toBe("INCORRECT");
    expect(status(spec, "")).toBe("INVALID_INPUT");
    expect(
      status({ method: "TEXT_NORMALISED", accepted: ["north east", "NE"] }, "north-east"),
    ).toBe("CORRECT");
    expect(normaliseText("  Café — Ünïcode!  ")).toBe("cafe unicode");
  });
});

describe("ORDERED_SEQUENCE", () => {
  const spec = { method: "ORDERED_SEQUENCE", sequence: ["0.5", "3/4", "1", "1.25"] };

  it("compares numbers by value, in any written form", () => {
    expect(status(spec, ["0,5", "0.75", "1", "1 1/4"])).toBe("CORRECT");
    expect(status(spec, "1/2, 3/4, 1, 5/4")).toBe("CORRECT");
    expect(status(spec, "0.5 → 0.75 → 1 → 1.25")).toBe("CORRECT");
  });

  it("gives partial credit for items in the right place but is not correct", () => {
    const r = mark(spec, ["0.5", "1", "3/4", "1.25"]);
    expect(r.status).toBe("INCORRECT");
    expect(r.score).toBe(0.5);
    expect(r.signals).toContain("SEQUENCE_PARTIAL");
    expect(mark(spec, ["1.25", "1", "3/4", "0.5"]).score).toBe(0);
  });

  it("orders words too", () => {
    expect(
      status(
        { method: "ORDERED_SEQUENCE", sequence: ["first", "second", "third"] },
        "First, Second, Third",
      ),
    ).toBe("CORRECT");
  });

  it("does not credit a short answer as complete", () => {
    expect(status(spec, ["0.5", "3/4"])).toBe("INCORRECT");
    expect(status(spec, [])).toBe("INVALID_INPUT");
  });
});

describe("MATCHING_PAIRS", () => {
  const spec = {
    method: "MATCHING_PAIRS",
    pairs: { "3 sides": "triangle", "4 sides": "quadrilateral", "5 sides": "pentagon" },
  };

  it("scores each pair", () => {
    expect(
      status(spec, { "3 sides": "Triangle", "4 sides": "quadrilateral", "5 sides": "pentagon" }),
    ).toBe("CORRECT");
    const r = mark(spec, {
      "3 sides": "triangle",
      "4 sides": "pentagon",
      "5 sides": "quadrilateral",
    });
    expect(r.status).toBe("INCORRECT");
    expect(r.score).toBeCloseTo(1 / 3);
    expect(r.signals).toContain("PAIRS_PARTIAL");
    expect(status(spec, {})).toBe("INVALID_INPUT");
    expect(status(spec, "triangle")).toBe("INVALID_INPUT");
  });
});

describe("MULTI_PART", () => {
  const spec = {
    method: "MULTI_PART",
    parts: [
      { id: "a", marks: 2, spec: { method: "EXACT_NUMERIC", value: "12" } },
      { id: "b", marks: 1, spec: { method: "NUMERIC_WITH_UNIT", value: "5", unit: "cm" } },
      { id: "c", marks: 1, spec: { method: "TRUE_FALSE", value: false } },
    ],
  };

  it("adds up marks across parts and reports each part", () => {
    expect(status(spec, { a: "12", b: "5 cm", c: "false" })).toBe("CORRECT");
    const partial = mark(spec, { a: "12", b: "6 cm", c: "false" });
    expect(partial.status).toBe("INCORRECT");
    expect(partial.score).toBeCloseTo(3 / 4);
    expect(partial.parts!.b!.status).toBe("INCORRECT");
    expect(partial.parts!.a!.status).toBe("CORRECT");
  });

  it("is ALMOST when nothing is wrong but something needs tidying", () => {
    expect(status(spec, { a: "12", b: "5", c: "false" })).toBe("ALMOST");
  });

  it("is INVALID_INPUT when nothing was answered, and refuses a wrong shape", () => {
    expect(status(spec, { a: "", b: "", c: "" })).toBe("INVALID_INPUT");
    expect(status(spec, "12")).toBe("INVALID_INPUT");
  });

  it("nests", () => {
    const nested = {
      method: "MULTI_PART",
      parts: [
        {
          id: "x",
          marks: 1,
          spec: {
            method: "MULTI_PART",
            parts: [
              { id: "p", marks: 1, spec: { method: "TRUE_FALSE", value: true } },
              { id: "q", marks: 1, spec: { method: "TRUE_FALSE", value: true } },
            ],
          },
        },
        { id: "y", marks: 1, spec: { method: "TRUE_FALSE", value: true } },
      ],
    };
    expect(status(nested, { x: { p: "true", q: "true" }, y: "true" })).toBe("CORRECT");
  });
});

describe("MANUAL_REVIEW and answer privacy", () => {
  it("cannot be marked by machine", () => {
    expect(mark({ method: "MANUAL_REVIEW" }, "my explanation").status).toBe("NEEDS_REVIEW");
  });

  it("never puts the expected answer into the stored marking detail", () => {
    const cases: Array<[unknown, Parameters<typeof mark>[1], string]> = [
      [{ method: "EXACT_NUMERIC", value: "98765" }, "1", "98765"],
      [{ method: "FRACTION_LOWEST_TERMS", value: "7/9" }, "1/2", "7/9"],
      [{ method: "NUMERIC_WITH_UNIT", value: "98765", unit: "cm" }, "1 cm", "98765"],
      [{ method: "EXPRESSION_EQUIVALENT", expression: "98765" }, "1", "98765"],
      [{ method: "TEXT_NORMALISED", accepted: ["hexagon"] }, "square", "hexagon"],
      [{ method: "MULTIPLE_CHOICE", correct: ["C"] }, "A", "C"],
      [{ method: "ORDERED_SEQUENCE", sequence: ["11", "22", "33"] }, ["33", "22", "11"], "11, 22"],
    ];
    for (const [spec, answer, secret] of cases) {
      const r = mark(spec, answer);
      expect(r.status).not.toBe("CORRECT");
      // What is stored and shown back to the learner: the trace and the signals.
      expect(JSON.stringify([r.detail, r.signals]), String(secret)).not.toContain(secret);
    }
  });
});
