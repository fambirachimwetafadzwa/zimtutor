import { describe, expect, it } from "vitest";
import {
  objectiveId,
  pad,
  rowId,
  rowItemId,
  sha256,
  slugify,
  strandKey,
  textHash,
} from "../../src/ingestion/ids";

describe("slugify", () => {
  it("upper-cases, drops filler words and keeps the meaningful ones", () => {
    expect(slugify("Place value of digits")).toBe("PLACE-VALUE-DIGITS");
    expect(slugify("Addition of whole numbers")).toBe("ADDITION-WHOLE-NUMBERS");
    expect(slugify("Direction, angles and lines")).toBe("DIRECTION-ANGLES-LINES");
    expect(slugify("Ordinal numbers from first to thirtieth")).toBe(
      "ORDINAL-NUMBERS-FIRST-THIRTIETH",
    );
  });

  it("includes an explicit group heading when given", () => {
    expect(slugify("Whole numbers Numerals")).toBe("WHOLE-NUMBERS-NUMERALS");
  });

  it("caps very long names so ids stay manageable", () => {
    const slug = slugify(
      "Highest Common Factor and Lowest Common Multiple of two numbers whose sum is large",
    );
    expect(slug.split("-").length).toBeLessThanOrEqual(6);
  });

  it("only ever emits characters the database id constraint allows", () => {
    for (const text of ["Café à la crème", "50% of 200", "a/b + c", "  --  ", "Ünïcode ñame"]) {
      expect(slugify(text)).toMatch(/^[A-Z0-9]+(-[A-Z0-9]+)*$|^$/);
    }
  });

  it("falls back to all words if every word is filler", () => {
    expect(slugify("to of the")).toBe("TO-OF-THE");
  });
});

describe("strandKey", () => {
  it("keeps every word so the same sub-topic can be linked across grades", () => {
    expect(strandKey("Proper Fractions")).toBe("proper-fractions");
    expect(strandKey("Addition of whole numbers")).toBe("addition-of-whole-numbers");
  });
});

describe("hashing", () => {
  it("is stable and sensitive to wording but not to whitespace", () => {
    expect(textHash("compare   fractions")).toBe(textHash(" compare fractions "));
    expect(textHash("compare fractions")).not.toBe(textHash("order fractions"));
    expect(sha256("abc")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is Unicode-normalisation stable", () => {
    expect(textHash("café")).toBe(textHash("café"));
  });
});

describe("identifier builders", () => {
  it("builds the documented formats", () => {
    expect(objectiveId("G5-NUM-PROPER-FRACTIONS", 2)).toBe("G5-NUM-PROPER-FRACTIONS-002");
    expect(rowId("G5-NUM-PROPER-FRACTIONS", 1)).toBe("G5-NUM-PROPER-FRACTIONS.R1");
    expect(rowItemId("G5-NUM-PROPER-FRACTIONS.R1", "ACT", 3)).toBe(
      "G5-NUM-PROPER-FRACTIONS.R1:ACT03",
    );
    expect(pad(7, 3)).toBe("007");
  });
});
