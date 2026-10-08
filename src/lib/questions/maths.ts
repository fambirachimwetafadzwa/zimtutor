/**
 * Small exact helpers for the question templates: divisors, primes, Roman numerals, rounding, and
 * decimals held as SCALED INTEGERS (345 with 2 decimal places is 3.45). Nothing here uses floating
 * point for anything a learner will see.
 */

export const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));
export const lcm = (a: number, b: number): number => (a / gcd(a, b)) * b;

/** All positive divisors of n, ascending. */
export function divisors(n: number): number[] {
  const small: number[] = [];
  const large: number[] = [];
  for (let d = 1; d * d <= n; d++) {
    if (n % d === 0) {
      small.push(d);
      if (d * d !== n) large.push(n / d);
    }
  }
  return [...small, ...large.reverse()];
}

export function isPrime(n: number): boolean {
  if (n < 2) return false;
  for (let d = 2; d * d <= n; d++) if (n % d === 0) return false;
  return true;
}

export const PRIMES_TO_100 = Array.from({ length: 100 }, (_, i) => i + 1).filter(isPrime);

/** Prime factors with repetition, ascending: 60 → [2, 2, 3, 5]. */
export function primeFactorisation(n: number): number[] {
  const out: number[] = [];
  let rest = n;
  for (let p = 2; p * p <= rest; p++) {
    while (rest % p === 0) {
      out.push(p);
      rest /= p;
    }
  }
  if (rest > 1) out.push(rest);
  return out;
}

// ── Roman numerals ──────────────────────────────────────────────────────────────────────────────
const ROMAN: Array<[number, string]> = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

export function toRoman(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 3999) throw new RangeError("Roman numerals: 1..3999");
  let rest = n;
  let out = "";
  for (const [value, symbol] of ROMAN) {
    while (rest >= value) {
      out += symbol;
      rest -= value;
    }
  }
  return out;
}

// ── rounding (half up, exact) ───────────────────────────────────────────────────────────────────
/** Round a non-negative whole number to the nearest `unit` (10, 100, 1 000 …), halves round up. */
export function roundToNearest(n: number, unit: number): number {
  const u = BigInt(unit);
  return Number(((BigInt(n) + u / 2n) / u) * u);
}

/** Round DOWN to a multiple of `unit` (what a learner gets if they ignore the next digit). */
export const truncateTo = (n: number, unit: number): number => Math.floor(n / unit) * unit;

// ── decimals as scaled integers ─────────────────────────────────────────────────────────────────
/** 345 with dp 2 → "3.45"; 340 with dp 2 → "3.40" (keeps zeros); 5 with dp 1 → "0.5". */
export function scaledText(scaled: number, dp: number): string {
  if (dp === 0) return String(scaled);
  const negative = scaled < 0;
  const digits = String(Math.abs(scaled)).padStart(dp + 1, "0");
  const text = `${digits.slice(0, -dp)}.${digits.slice(-dp)}`;
  return negative ? `-${text}` : text;
}

/** As above, but without trailing zeros: 340 dp 2 → "3.4"; 300 dp 2 → "3". */
export function trimmedDecimal(scaled: number, dp: number): string {
  const text = scaledText(scaled, dp);
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

/** Digits of a scaled decimal's fractional part: (345, 2) → [3, 4, 5]. */
export function fractionDigits(scaled: number, dp: number): number[] {
  return [
    ...String(Math.abs(scaled))
      .padStart(dp + 1, "0")
      .slice(-dp),
  ].map(Number);
}

export const powerOfTen = (k: number): number => 10 ** k;

/** Greatest number of decimal places in a list of decimal texts. */
export const decimalPlaces = (text: string): number => text.split(".")[1]?.length ?? 0;

/** The digits of a whole number from the left. */
export const wholeDigits = (n: number): number[] => [...String(n)].map(Number);

/** n with its digits in the stated places swapped or changed, as a number. */
export const fromDigits = (digits: number[]): number => Number(digits.join(""));
