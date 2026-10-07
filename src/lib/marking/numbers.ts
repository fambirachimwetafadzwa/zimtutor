import { Rational, gcd } from "./rational";
import { wordsToNumber } from "./words";

/**
 * Reading what a learner typed as a number.
 *
 * The syllabus writes decimals with a COMMA and groups digits with SPACES ("1 234,5"), while many
 * learners also type "1,234.5" or "1234.5" (phones, calculators, currency). The reader therefore
 * accepts every reasonable convention, with one honest ambiguity: "1,234" is 1.234 in the syllabus
 * and 1 234 in international style. For that single shape BOTH readings are returned and the
 * caller accepts the answer if either reading is the expected value (recorded in the marking
 * detail), so a child is never marked wrong for a formatting habit.
 */

export interface ParsedNumber {
  /** Every value the text can validly mean. More than one only for the "1,234" shape. */
  candidates: Rational[];
  ambiguous: boolean;
  form: "integer" | "decimal" | "fraction" | "mixed" | "percent" | "words";
  /** Fractions and mixed numbers as written, to judge "lowest terms". */
  fraction?: { whole: bigint; num: bigint; den: bigint };
  percent: boolean;
  /** Typed with a unit-free plus/minus sign etc. — nothing needed here; kept for diagnostics. */
  original: string;
}

export type NumberParseError = "EMPTY" | "NOT_A_NUMBER" | "DIVISION_BY_ZERO" | "TOO_LONG";
export type NumberParse =
  { ok: true; value: ParsedNumber } | { ok: false; error: NumberParseError };

const MAX_LENGTH = 48;

const VULGAR: Record<string, [number, number]> = {
  "½": [1, 2],
  "⅓": [1, 3],
  "⅔": [2, 3],
  "¼": [1, 4],
  "¾": [3, 4],
  "⅕": [1, 5],
  "⅖": [2, 5],
  "⅗": [3, 5],
  "⅘": [4, 5],
  "⅙": [1, 6],
  "⅚": [5, 6],
  "⅛": [1, 8],
  "⅜": [3, 8],
  "⅝": [5, 8],
  "⅞": [7, 8],
};

/** Tidy typography without changing meaning. */
export function normaliseNumberText(raw: string): string {
  return raw
    .normalize("NFKC") // ½ → "1⁄2", full-width digits → ASCII, etc.
    .replace(/[    ]/g, " ")
    .replace(/[−–—]/g, "-")
    .replace(/[⁄∕]/g, "/")
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .trim();
}

function bigint(s: string): bigint {
  return BigInt(s);
}

const GROUPED_SPACES = /^-?\d{1,3}( \d{3})+([.,]\d+)?$/;

function parsePlainDecimal(
  text: string,
): { candidates: Rational[]; ambiguous: boolean; form: "integer" | "decimal" } | null {
  let t = text.replace(/^\+/, "");
  if (/ /.test(t)) {
    if (!GROUPED_SPACES.test(t)) return null;
    t = t.replace(/ /g, "");
  }
  if (/^-?\d+$/.test(t))
    return { candidates: [Rational.parseDecimal(t)!], ambiguous: false, form: "integer" };

  // Thousands separators with an optional decimal part: 1,234,567.89
  let m = /^(-?\d{1,3}(?:,\d{3})+)(?:\.(\d+))?$/.exec(t);
  if (m && !/^-?0\d*,/.test(m[1]!)) {
    const thousands = Rational.parseDecimal(`${m[1]!.replace(/,/g, "")}${m[2] ? `.${m[2]}` : ""}`);
    if (!thousands) return null;
    // A lone "1,234" is the one shape that could also be the syllabus's decimal comma (1.234).
    const loneGroup = (m[1]!.match(/,/g) ?? []).length === 1 && m[2] === undefined;
    const decimal = loneGroup ? Rational.parseDecimal(m[1]!.replace(",", ".")) : null;
    if (loneGroup && decimal)
      return { candidates: [decimal, thousands], ambiguous: true, form: "decimal" };
    return { candidates: [thousands], ambiguous: false, form: m[2] ? "decimal" : "integer" };
  }
  m = /^(-?\d{1,3}(?:\.\d{3})+)(?:,(\d+))?$/.exec(t);
  if (m && (m[2] !== undefined || /\.\d{3}\./.test(t) || /^-?\d{1,3}\.\d{3}\.\d{3}/.test(t))) {
    const value = Rational.parseDecimal(`${m[1]!.replace(/\./g, "")}${m[2] ? `.${m[2]}` : ""}`);
    return value
      ? { candidates: [value], ambiguous: false, form: m[2] ? "decimal" : "integer" }
      : null;
  }

  // A single separator.
  m = /^(-?)(\d*)([.,])(\d*)$/.exec(t);
  if (!m || (m[2] === "" && m[4] === "")) return null;
  const [, sign, intPart, separator, fracPart] = m as unknown as [
    string,
    string,
    string,
    string,
    string,
  ];
  const decimal = Rational.parseDecimal(`${sign}${intPart || "0"}.${fracPart || "0"}`);
  if (!decimal) return null;
  const candidates = [decimal];
  // "1,234" (comma, three digits, short integer part) might also be one thousand two hundred and thirty-four.
  if (
    separator === "," &&
    fracPart.length === 3 &&
    intPart.length >= 1 &&
    intPart.length <= 3 &&
    !/^0/.test(intPart)
  ) {
    const thousands = Rational.parseDecimal(`${sign}${intPart}${fracPart}`);
    if (thousands) return { candidates: [decimal, thousands], ambiguous: true, form: "decimal" };
  }
  return { candidates, ambiguous: false, form: "decimal" };
}

export function parseLearnerNumber(raw: string): NumberParse {
  if (raw.length > MAX_LENGTH * 2) return { ok: false, error: "TOO_LONG" };
  let text = normaliseNumberText(raw);
  if (text === "") return { ok: false, error: "EMPTY" };
  if (text.length > MAX_LENGTH) return { ok: false, error: "TOO_LONG" };

  // "½" alone is fine (NFKC makes it "1/2"), but NFKC turns "2½" into "21/2": detect that shape
  // in the ORIGINAL text before it is lost.
  const vulgarMixed = /^(-?\d+)\s*([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])$/.exec(raw.normalize("NFC").trim());
  if (vulgarMixed) {
    const [n, d] = VULGAR[vulgarMixed[2]!]!;
    const whole = bigint(vulgarMixed[1]!);
    const negative = vulgarMixed[1]!.startsWith("-");
    const value = new Rational(abs(whole) * BigInt(d) + BigInt(n), BigInt(d));
    return {
      ok: true,
      value: {
        candidates: [negative ? value.neg() : value],
        ambiguous: false,
        form: "mixed",
        fraction: { whole: abs(whole), num: BigInt(n), den: BigInt(d) },
        percent: false,
        original: raw,
      },
    };
  }

  let percent = false;
  if (text.endsWith("%")) {
    percent = true;
    text = text.slice(0, -1).trim();
  }

  // Mixed number: "2 1/2"
  let m = /^(-?)(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(text);
  if (m) {
    const whole = bigint(m[2]!);
    const num = bigint(m[3]!);
    const den = bigint(m[4]!);
    if (den === 0n) return { ok: false, error: "DIVISION_BY_ZERO" };
    const value = new Rational(whole * den + num, den);
    return {
      ok: true,
      value: {
        candidates: [m[1] ? value.neg() : value],
        ambiguous: false,
        form: "mixed",
        fraction: { whole, num, den },
        percent,
        original: raw,
      },
    };
  }

  // Fraction: "3/4"
  m = /^(-?)(\d+)\s*\/\s*(\d+)$/.exec(text);
  if (m) {
    const num = bigint(m[2]!);
    const den = bigint(m[3]!);
    if (den === 0n) return { ok: false, error: "DIVISION_BY_ZERO" };
    const value = new Rational(num, den);
    return {
      ok: true,
      value: {
        candidates: [m[1] ? value.neg() : value],
        ambiguous: false,
        form: "fraction",
        fraction: { whole: 0n, num, den },
        percent,
        original: raw,
      },
    };
  }

  const plain = parsePlainDecimal(text);
  if (plain) {
    return {
      ok: true,
      value: {
        candidates: plain.candidates,
        ambiguous: plain.ambiguous,
        form: percent ? "percent" : plain.form,
        percent,
        original: raw,
      },
    };
  }

  // Number words ("six", "four hundred and five")
  const words = wordsToNumber(text);
  if (words !== null) {
    return {
      ok: true,
      value: {
        candidates: [new Rational(words)],
        ambiguous: false,
        form: "words",
        percent: false,
        original: raw,
      },
    };
  }
  return { ok: false, error: "NOT_A_NUMBER" };
}

const abs = (n: bigint) => (n < 0n ? -n : n);

/** A fraction as written is in lowest terms when numerator and denominator share no factor. */
export function writtenInLowestTerms(parsed: ParsedNumber): boolean {
  if (!parsed.fraction) return true; // not written as a fraction: nothing to reduce
  const { num, den } = parsed.fraction;
  return gcd(num, den) === 1n;
}

/** Does the text contain more than a number (operators, letters)? Used to give a clearer message. */
export function looksLikeExpression(raw: string): boolean {
  const t = normaliseNumberText(raw);
  return (
    /\d\s*[+*×÷x^()]\s*\d|\d\s*-\s*\d/.test(t) &&
    !/^\d+\s*\/\s*\d+$/.test(t) &&
    !/^-?\d+\s+\d+\s*\/\s*\d+$/.test(t)
  );
}
