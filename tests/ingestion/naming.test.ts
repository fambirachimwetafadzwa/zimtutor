import { describe, expect, it } from "vitest";
import { composeSubtopicName, nameContinues, shortOf } from "../../src/ingestion/naming";
import { bullet, dash, indentedPara, item, para } from "./helpers";

describe("composeSubtopicName", () => {
  it("separates a bold group heading from the name (Grade 3 'Whole numbers' / 'Numerals')", () => {
    const parts = composeSubtopicName([para("Whole numbers", { bold: true }), para("Numerals")]);
    expect(parts).toMatchObject({
      group: "Whole numbers",
      name: "Numerals",
      shortName: "Numerals",
    });
    expect(parts.slug).toBe("WHOLE-NUMBERS-NUMERALS");
  });

  it("does not mistake an all-bold single line for a group heading", () => {
    expect(composeSubtopicName([para("Rate", { bold: true })]).group).toBeNull();
  });

  it("joins a name with its scope line, but derives a clean short name", () => {
    const parts = composeSubtopicName([para("Addition of whole numbers"), para("(0 – 1 000 000)")]);
    expect(parts.name).toBe("Addition of whole numbers (0 – 1 000 000)");
    expect(parts.shortName).toBe("Addition of whole numbers");
  });

  it("joins a wrapped name across paragraphs", () => {
    const parts = composeSubtopicName([para("Mass (up to"), para("1 000kg)")]);
    expect(parts.name).toBe("Mass (up to 1 000kg)");
    expect(parts.shortName).toBe("Mass");
  });

  it("renders a dash list as 'Name: a, b, c' (Grade 7 Rate)", () => {
    const parts = composeSubtopicName([
      para("Rate"),
      dash("Distance"),
      dash("Speed"),
      dash("Time"),
    ]);
    expect(parts.name).toBe("Rate: Distance, Speed, Time");
    expect(parts.shortName).toBe("Rate");
  });

  it("keeps two sub-topics that share one row as two entries (HCF / LCM)", () => {
    const parts = composeSubtopicName([
      bullet("HCF of two numbers (where the HCF is less than 10)"),
      bullet("LCM of two numbers (where the LCM is less than 100)"),
    ]);
    expect(parts.entries).toHaveLength(2);
    expect(parts.name).toBe(
      "HCF of two numbers (where the HCF is less than 10); LCM of two numbers (where the LCM is less than 100)",
    );
    expect(parts.shortName).toBe("HCF of two numbers and LCM of two numbers");
  });

  it("repairs a bullet split across a page break (unlabelled list item continues the entry)", () => {
    const parts = composeSubtopicName([
      bullet("Highest Common Factor (HCF) of two numbers (where the"),
      item({ text: "HCF is less than 20)", label: "" }),
      bullet("Lowest Common Multiple (LCM) of two numbers (where the LCM is less than 100)"),
    ]);
    expect(parts.name).toBe(
      "Highest Common Factor (HCF) of two numbers (where the HCF is less than 20); Lowest Common Multiple (LCM) of two numbers (where the LCM is less than 100)",
    );
  });

  it("collapses a derived name that merely extends an earlier one ('Area' + 'Area of')", () => {
    const parts = composeSubtopicName([
      bullet("Area:"),
      para("units of area up to a hectare"),
      bullet("Area of:"),
      indentedPara("-rectangle,"),
      indentedPara("-square"),
    ]);
    expect(parts.name).toBe("Area: units of area up to a hectare; Area of: rectangle, square");
    expect(parts.shortName).toBe("Area");
  });

  it("strips a leading bullet glyph and never returns an empty name for non-empty input", () => {
    expect(composeSubtopicName([bullet("Data handling")]).name).toBe("Data handling");
    expect(composeSubtopicName([bullet("(0–10)")]).shortName).toBe("(0–10)");
  });
});

describe("shortOf", () => {
  it("cuts at the first qualifier", () => {
    expect(shortOf("Proper Fractions (denominators 2 to 10 and 20)")).toBe("Proper Fractions");
    expect(shortOf("Direction, angles and lines: including acute, obtuse")).toBe(
      "Direction, angles and lines",
    );
    expect(shortOf("Money")).toBe("Money");
  });
});

describe("nameContinues (is the first-column text on a new page the wrapped rest of the previous name?)", () => {
  it("recognises an open bracket", () => {
    expect(
      nameContinues(
        "Addition of proper fractions (with same or different denominators of 2 to",
        "10 and multiples of 5 up to 50)",
      ),
    ).toBe(true);
    expect(
      nameContinues(
        "Highest Common Factor (HCF) of two numbers (where the",
        "HCF is less than 20)",
      ),
    ).toBe(true);
  });

  it("recognises a trailing colon or comma", () => {
    expect(nameContinues("Area of:", "- rectangle,")).toBe(true);
    expect(nameContinues("Shapes,", "Plane")).toBe(true);
  });

  it("recognises a parenthetical scope that starts the next page", () => {
    expect(
      nameContinues("Multiplication of whole numbers", "(whose product is less than 100 000)"),
    ).toBe(true);
  });

  it("recognises a mid-sentence start", () => {
    expect(nameContinues("Division of whole numbers by two-", "digit numbers")).toBe(true);
  });

  it("does NOT treat a genuinely new sub-topic as a continuation", () => {
    expect(nameContinues("Multiplication of whole numbers", "Division of whole numbers")).toBe(
      false,
    );
    expect(nameContinues("Mass (Units and conversions of mass up to 10 kilograms)", "Length")).toBe(
      false,
    );
  });
});
