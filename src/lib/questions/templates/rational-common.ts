import { numberToWords } from "../../marking/words";
import { byLevel } from "../kit";
import { gcd } from "../maths";
import type { Rng } from "../rng";
import type { Difficulty, StemData } from "../types";

/** Helpers for fractions, mixed numbers, decimals and percentages. */

const multiplesOfFive = (from: number, to: number): number[] =>
  Array.from({ length: Math.floor((to - from) / 5) + 1 }, (_, i) => from + 5 * i);

/**
 * Denominators each grade works with (the "Content" column of the proper-fractions rows):
 * G3 and G5: 2 to 10 and 20 · G4: 2, 4, 5, 10 and 20 · G6: 2 to 10 and multiples of 5 up to 50 ·
 * G7: 2 to 10 and multiples of 5 up to 100.
 */
export const FRACTION_DENOMS: Record<number, readonly number[]> = {
  3: [2, 3, 4, 5, 6, 7, 8, 9, 10, 20],
  4: [2, 4, 5, 10, 20],
  5: [2, 3, 4, 5, 6, 7, 8, 9, 10, 20],
  6: [2, 3, 4, 5, 6, 7, 8, 9, 10, ...multiplesOfFive(15, 50)],
  7: [2, 3, 4, 5, 6, 7, 8, 9, 10, ...multiplesOfFive(15, 100)],
};

/** Denominators for mixed numbers: G4 uses 2, 4, 5, 10; later grades 2 to 10. */
export const MIXED_DENOMS: Record<number, readonly number[]> = {
  4: [2, 4, 5, 10],
  5: [2, 3, 4, 5, 6, 7, 8, 9, 10],
  6: [2, 3, 4, 5, 6, 7, 8, 9, 10],
  7: [2, 3, 4, 5, 6, 7, 8, 9, 10],
};

/** Denominators for adding and subtracting fractions with the SAME denominator in Grade 3. */
export const G3_OPERATION_DENOMS = [2, 4, 5, 10] as const;

/** Easier denominators at the lower levels, the whole allowed set at the top. */
export function denomsFor(grade: number, difficulty: Difficulty): number[] {
  const all = [...(FRACTION_DENOMS[grade] ?? FRACTION_DENOMS[5]!)];
  const pool = byLevel(difficulty, [
    all.filter((x) => [2, 3, 4, 5, 10].includes(x)),
    all.filter((x) => x <= 10 && x !== 7 && x !== 9),
    all.filter((x) => x <= 10 || x === 20),
    all,
    all,
  ]);
  return pool.length > 0 ? pool : all;
}

/** A proper fraction with the denominator `den`; `coprime` keeps it in lowest terms. */
export function properFraction(
  rng: Rng,
  den: number,
  options: { coprime?: boolean } = {},
): [number, number] {
  const candidates = Array.from({ length: den - 1 }, (_, i) => i + 1).filter(
    (n) => !options.coprime || gcd(n, den) === 1,
  );
  return [rng.pick(candidates), den];
}

/** Two different denominators from the pool whose fractions are easy to compare through a common denominator. */
export function twoDenominators(rng: Rng, pool: readonly number[]): [number, number] {
  for (let tries = 0; tries < 100; tries++) {
    const a = rng.pick(pool);
    const b = rng.pick(pool);
    if (a !== b) return [a, b];
  }
  throw new Error("twoDenominators: pool too small");
}

export const frac = (n: number, d: number): string => `${n}/${d}`;
export const mixed = (w: number, n: number, d: number): string => `${w} ${n}/${d}`;

/** A fraction bar picture: `shaded` of `parts` equal parts, after `wholes` complete wholes. */
export function fractionBar(parts: number, shaded: number, wholes = 0): StemData {
  return { kind: "fraction-bar", parts, shaded, ...(wholes > 0 ? { wholes } : {}) };
}

// ── decimals ────────────────────────────────────────────────────────────────────────────────────

export interface Decimal {
  /** The value times 10^dp, an integer: 3.45 → 345. */
  scaled: number;
  dp: number;
  whole: number;
  /** "3.45". The last decimal digit is never 0, so `dp` is the true number of decimal places. */
  text: string;
}

export function decimalFrom(scaled: number, dp: number): Decimal {
  const digits = String(scaled).padStart(dp + 1, "0");
  const whole = Number(digits.slice(0, digits.length - dp));
  return { scaled, dp, whole, text: `${digits.slice(0, digits.length - dp)}.${digits.slice(-dp)}` };
}

/** A decimal with exactly `dp` places (last digit non-zero) and `wholeDigits` digits before the point (0 = "0.x"). */
export function makeDecimal(rng: Rng, dp: number, wholeDigits: number): Decimal {
  const whole = wholeDigits === 0 ? 0 : rng.int(10 ** (wholeDigits - 1), 10 ** wholeDigits - 1);
  let fraction = rng.int(10 ** (dp - 1), 10 ** dp - 1);
  if (fraction % 10 === 0) fraction += rng.int(1, 9);
  return decimalFrom(whole * 10 ** dp + fraction, dp);
}

/** Decimal places used at each level: G4 one, G5 up to two, G6 and G7 up to three. */
export function decimalPlacesFor(grade: number, difficulty: Difficulty): number {
  const max = grade <= 4 ? 1 : grade === 5 ? 2 : 3;
  return Math.min(max, byLevel(difficulty, [1, 1, 2, 3, 3]));
}

/** Digits before the decimal point: small numbers first, up to three digits in the upper grades. */
export function decimalWholeDigitsFor(grade: number, difficulty: Difficulty): number {
  const max = grade <= 4 ? 1 : grade === 5 ? 2 : 3;
  return Math.min(max, byLevel(difficulty, [0, 1, 1, 2, 3]));
}

/** "4.07" → "four point zero seven". */
export function decimalWords(text: string): string {
  const [whole, fraction = ""] = text.split(".");
  const spelled = [...fraction].map((c) => numberToWords(Number(c))).join(" ");
  return `${numberToWords(Number(whole))} point ${spelled}`;
}

/** Names of the decimal places: 1 → tenths, 2 → hundredths, 3 → thousandths. */
export const DECIMAL_PLACE_NAMES = ["", "tenths", "hundredths", "thousandths"] as const;

/** Decimal text without trailing zeros: "3.40" → "3.4". */
export const trimZeros = (text: string): string =>
  text.includes(".") ? text.replace(/\.?0+$/, "") : text;

export const hasTerminatingDecimal = (den: number): boolean => {
  let d = den;
  while (d % 2 === 0) d /= 2;
  while (d % 5 === 0) d /= 5;
  return d === 1;
};
