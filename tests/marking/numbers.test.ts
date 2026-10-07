import { describe, expect, it } from "vitest";
import {
  looksLikeExpression,
  parseLearnerNumber,
  writtenInLowestTerms,
  type ParsedNumber,
} from "../../src/lib/marking/numbers";
import { Rational } from "../../src/lib/marking/rational";
import {
  numberToWords,
  ordinalNumeral,
  ordinalWords,
  wordsToNumber,
} from "../../src/lib/marking/words";

function parse(text: string): ParsedNumber {
  const result = parseLearnerNumber(text);
  if (!result.ok) throw new Error(`"${text}" did not parse: ${result.error}`);
  return result.value;
}
const values = (text: string) => parse(text).candidates.map((c) => c.toString());

describe("Rational", () => {
  it("is exact where floating point is not", () => {
    const sum = Rational.parseDecimal("0.1")!.add(Rational.parseDecimal("0.2")!);
    expect(sum.equals(Rational.parseDecimal("0.3")!)).toBe(true);
    expect(0.1 + 0.2 === 0.3).toBe(false);
  });

  it("normalises sign and common factors", () => {
    const r = new Rational(6n, -8n);
    expect([r.num, r.den]).toEqual([-3n, 4n]);
    expect(new Rational(2n, 4n).equals(new Rational(1n, 2n))).toBe(true);
  });

  it("does arithmetic and comparison exactly", () => {
    const half = new Rational(1n, 2n);
    const third = new Rational(1n, 3n);
    expect(half.add(third).toFractionString()).toBe("5/6");
    expect(half.sub(third).toFractionString()).toBe("1/6");
    expect(half.mul(third).toFractionString()).toBe("1/6");
    expect(half.div(third).toFractionString()).toBe("3/2");
    expect(half.compare(third)).toBe(1);
    expect(half.pow(3).toFractionString()).toBe("1/8");
    expect(half.pow(-2).toFractionString()).toBe("4");
  });

  it("prints finite decimals as decimals and the rest as fractions", () => {
    expect(new Rational(3n, 4n).toString()).toBe("0.75");
    expect(new Rational(-5n, 8n).toString()).toBe("-0.625");
    expect(new Rational(1n, 3n).toString()).toBe("1/3");
    expect(new Rational(7n).toString()).toBe("7");
    expect(Rational.parseDecimal("0.050")!.toString()).toBe("0.05");
  });

  it("refuses to divide by zero and to parse junk", () => {
    expect(() => new Rational(1n, 0n)).toThrow(RangeError);
    expect(() => Rational.ONE.div(Rational.ZERO)).toThrow(RangeError);
    expect(Rational.parseDecimal("abc")).toBeNull();
    expect(Rational.parseDecimal(".")).toBeNull();
  });
});

describe("parseLearnerNumber", () => {
  it("reads integers, signs and surrounding whitespace", () => {
    expect(values("42")).toEqual(["42"]);
    expect(values("  -17 ")).toEqual(["-17"]);
    expect(values("−17")).toEqual(["-17"]); // typographic minus
    expect(values("+8")).toEqual(["8"]);
    expect(values("007")).toEqual(["7"]);
  });

  it("reads the syllabus convention: space-grouped thousands and a decimal comma", () => {
    expect(values("1 000")).toEqual(["1000"]);
    expect(values("12 345")).toEqual(["12345"]);
    expect(values("3,96")).toEqual(["3.96"]);
    expect(values("1 234,5")).toEqual(["1234.5"]);
    expect(values("1 234,567")).toEqual(["1234.567"]); // integer part too long for the comma to be a thousands mark
  });

  it("reads international style too", () => {
    expect(values("3.96")).toEqual(["3.96"]);
    expect(values("1,234,567")).toEqual(["1234567"]);
    expect(values("1,234.5")).toEqual(["1234.5"]);
    expect(values(".5")).toEqual(["0.5"]);
    expect(values("0,5")).toEqual(["0.5"]);
  });

  it('treats "1,234" as ambiguous: 1.234 or one thousand two hundred and thirty-four', () => {
    const parsed = parse("1,234");
    expect(parsed.ambiguous).toBe(true);
    expect(parsed.candidates.map((c) => c.toString())).toEqual(["1.234", "1234"]);
    expect(parse("12,345").candidates.map((c) => c.toString())).toEqual(["12.345", "12345"]);
    // but not when the shape cannot be a thousands mark
    expect(parse("0,123").ambiguous).toBe(false);
    expect(parse("1,23").ambiguous).toBe(false);
    expect(parse("1,2345").ambiguous).toBe(false);
  });

  it("reads fractions and mixed numbers exactly", () => {
    expect(values("3/4")).toEqual(["0.75"]);
    expect(values("3 / 4")).toEqual(["0.75"]);
    expect(values("2 1/2")).toEqual(["2.5"]);
    expect(values("-1/3")).toEqual(["-1/3"]);
    expect(parse("2 1/2").form).toBe("mixed");
    expect(parse("3/4").form).toBe("fraction");
    expect(values("½")).toEqual(["0.5"]);
    expect(values("2½")).toEqual(["2.5"]);
    expect(values("¾")).toEqual(["0.75"]);
  });

  it("flags percentages without rescaling them", () => {
    const parsed = parse("25%");
    expect(parsed.percent).toBe(true);
    expect(parsed.candidates[0]!.toString()).toBe("25");
  });

  it("reads number words", () => {
    expect(values("six")).toEqual(["6"]);
    expect(values("Four hundred and five")).toEqual(["405"]);
    expect(values("twenty-one")).toEqual(["21"]);
    expect(parse("six").form).toBe("words");
  });

  it("rejects what is not a number, with a reason", () => {
    expect(parseLearnerNumber("")).toEqual({ ok: false, error: "EMPTY" });
    expect(parseLearnerNumber("   ")).toEqual({ ok: false, error: "EMPTY" });
    expect(parseLearnerNumber("abc")).toEqual({ ok: false, error: "NOT_A_NUMBER" });
    expect(parseLearnerNumber("1 5")).toEqual({ ok: false, error: "NOT_A_NUMBER" });
    expect(parseLearnerNumber("1.2.3")).toEqual({ ok: false, error: "NOT_A_NUMBER" });
    expect(parseLearnerNumber("5/0")).toEqual({ ok: false, error: "DIVISION_BY_ZERO" });
    expect(parseLearnerNumber("1".repeat(200))).toEqual({ ok: false, error: "TOO_LONG" });
  });

  it("recognises answers that are expressions rather than values", () => {
    expect(looksLikeExpression("2+3")).toBe(true);
    expect(looksLikeExpression("12 × 4")).toBe(true);
    expect(looksLikeExpression("3/4")).toBe(false);
    expect(looksLikeExpression("2 1/2")).toBe(false);
    expect(looksLikeExpression("42")).toBe(false);
  });

  it("judges lowest terms from what was written", () => {
    expect(writtenInLowestTerms(parse("3/4"))).toBe(true);
    expect(writtenInLowestTerms(parse("6/8"))).toBe(false);
    expect(writtenInLowestTerms(parse("2 2/4"))).toBe(false);
    expect(writtenInLowestTerms(parse("2 1/2"))).toBe(true);
    expect(writtenInLowestTerms(parse("0.75"))).toBe(true);
  });
});

describe("number words", () => {
  it.each([
    [0, "zero"],
    [7, "seven"],
    [13, "thirteen"],
    [21, "twenty-one"],
    [100, "one hundred"],
    [405, "four hundred and five"],
    [999, "nine hundred and ninety-nine"],
    [1000, "one thousand"],
    [1005, "one thousand and five"],
    [1250, "one thousand two hundred and fifty"],
    [100000, "one hundred thousand"],
    [1000000, "one million"],
    [2500001, "two million five hundred thousand and one"],
  ])("writes %i as %s and reads it back", (n, words) => {
    expect(numberToWords(n)).toBe(words);
    expect(wordsToNumber(words)).toBe(BigInt(n));
  });

  it("reads loose spellings", () => {
    expect(wordsToNumber("four hundred five")).toBe(405n);
    expect(wordsToNumber("Forty")).toBe(40n);
    expect(wordsToNumber("fourty")).toBe(40n);
    expect(wordsToNumber("a banana")).toBeNull();
    expect(wordsToNumber("thousand")).toBeNull();
  });

  it("writes ordinals as the syllabus needs them (first to thirtieth)", () => {
    expect(ordinalWords(1)).toBe("first");
    expect(ordinalWords(2)).toBe("second");
    expect(ordinalWords(3)).toBe("third");
    expect(ordinalWords(5)).toBe("fifth");
    expect(ordinalWords(8)).toBe("eighth");
    expect(ordinalWords(9)).toBe("ninth");
    expect(ordinalWords(12)).toBe("twelfth");
    expect(ordinalWords(20)).toBe("twentieth");
    expect(ordinalWords(21)).toBe("twenty-first");
    expect(ordinalWords(30)).toBe("thirtieth");
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 30].map(ordinalNumeral)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "23rd",
      "30th",
    ]);
  });

  it("round-trips every number up to 2 000 in both directions", () => {
    for (let n = 0; n <= 2000; n++) expect(wordsToNumber(numberToWords(n))).toBe(BigInt(n));
  });
});
