import { byLevel, fmtInt, PLACE_NAMES, type Wrong } from "../kit";
import type { Rng } from "../rng";
import type { Difficulty } from "../types";

/** Helpers shared by several template families. */

/** How many digits a whole number has at each difficulty, per grade (never beyond the grade's range). */
const WHOLE_DIGITS: Record<number, readonly [number, number, number, number, number]> = {
  3: [2, 3, 3, 3, 3],
  4: [3, 3, 4, 4, 4],
  5: [3, 4, 4, 5, 5],
  6: [4, 5, 5, 6, 6],
  7: [5, 6, 6, 7, 7],
};

export function wholeDigitsFor(grade: number, difficulty: Difficulty): number {
  return byLevel(difficulty, WHOLE_DIGITS[grade] ?? WHOLE_DIGITS[5]!);
}

export interface WholeOptions {
  /** At least one zero inside the number (the classic place-holder trap). */
  zero?: boolean;
  /** At least this many digits that are not zero (so an expansion has several terms). */
  minNonZero?: number;
  /** No digit appears twice (so "the digit 7" names exactly one place). */
  distinct?: boolean;
  /** No zeros at all. */
  noZero?: boolean;
}

/** A whole number with exactly `digits` digits. */
export function makeWhole(rng: Rng, digits: number, options: WholeOptions = {}): number {
  for (let attempt = 0; attempt < 500; attempt++) {
    const ds: number[] = [];
    for (let i = 0; i < digits; i++) ds.push(rng.int(i === 0 || options.noZero ? 1 : 0, 9));
    if (options.zero && digits >= 2) ds[rng.int(1, digits - 1)] = 0;
    if (options.distinct && new Set(ds).size !== ds.length) continue;
    if (options.minNonZero && ds.filter((x) => x !== 0).length < options.minNonZero) continue;
    return Number(ds.join(""));
  }
  throw new Error(`makeWhole: no ${digits}-digit number satisfies ${JSON.stringify(options)}`);
}

export interface PlacePart {
  digit: number;
  /** 0 = ones, 1 = tens, 2 = hundreds … */
  place: number;
  value: number;
  name: string;
}

/** The digits of n with their places and values, most significant first. */
export function placeParts(n: number): PlacePart[] {
  const digits = String(n).split("").map(Number);
  return digits.map((digit, i) => {
    const place = digits.length - 1 - i;
    return { digit, place, value: digit * 10 ** place, name: PLACE_NAMES[place] ?? `10^${place}` };
  });
}

/** "1 ten" / "4 tens": the place name agrees with the digit. */
export const countedPlace = (digit: number, name: string): string =>
  `${digit} ${digit === 1 ? name.replace(/s$/, "") : name}`;

/** "4 thousands, 3 hundreds, 0 tens and 5 ones". */
export function breakdownText(n: number): string {
  const parts = placeParts(n).map((p) => countedPlace(p.digit, p.name));
  return parts.length === 1
    ? parts[0]!
    : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** "4 | 305": the number cut into groups of three digits, as it is read. */
export function groupsText(n: number): string {
  return fmtInt(n).split(" ").join(" | ");
}

/**
 * Whole numbers that look like `n` but are not: one with a zero missing (the place-holder slip), one
 * with a zero too many, one with two digits swapped, one with a digit changed. The tag says which
 * mistake each one stands for. Every value stays within [1, max].
 */
export function numberVariants(
  rng: Rng,
  n: number,
  max: number,
): Array<{ value: number; tag?: string }> {
  const ds = String(n).split("").map(Number);
  const out: Array<{ value: number; tag?: string }> = [];
  const seen = new Set<number>([n]);
  const push = (value: number, tag?: string) => {
    if (!Number.isFinite(value) || value < 1 || value > max || seen.has(value)) return;
    seen.add(value);
    out.push(tag ? { value, tag } : { value });
  };

  const zeros = ds.map((d, i) => (d === 0 && i > 0 ? i : -1)).filter((i) => i >= 0);
  if (zeros.length > 0) {
    const copy = [...ds];
    copy.splice(rng.pick(zeros), 1);
    push(Number(copy.join("")), "ZERO_PLACEHOLDER_ERROR");
  }
  {
    const copy = [...ds];
    copy.splice(rng.int(1, ds.length), 0, 0);
    push(Number(copy.join("")), "PLACE_VALUE_CONFUSION");
  }
  const swappable = ds
    .map((d, i) => (i < ds.length - 1 && d !== ds[i + 1] && !(i === 0 && ds[1] === 0) ? i : -1))
    .filter((i) => i >= 0);
  if (swappable.length > 0) {
    const i = rng.pick(swappable);
    const copy = [...ds];
    [copy[i], copy[i + 1]] = [copy[i + 1]!, copy[i]!];
    push(Number(copy.join("")), "PLACE_VALUE_CONFUSION");
  }
  for (let tries = 0; tries < 12 && out.length < 6; tries++) {
    const i = rng.int(0, ds.length - 1);
    const copy = [...ds];
    copy[i] = (copy[i]! + rng.int(1, 3)) % 10;
    if (i === 0 && copy[0] === 0) continue;
    push(Number(copy.join("")));
  }
  return out;
}

export const asWrongs = (
  variants: Array<{ value: number; tag?: string }>,
  text: (n: number) => string,
): Wrong[] => variants.map((v) => ({ answer: text(v.value), ...(v.tag ? { tag: v.tag } : {}) }));

/** Pick `count` distinct values spread out enough to be told apart. */
export function distinctNumbers(
  rng: Rng,
  count: number,
  make: () => number,
  accept: (n: number, chosen: number[]) => boolean = () => true,
): number[] {
  const chosen: number[] = [];
  for (let tries = 0; tries < 400 && chosen.length < count; tries++) {
    const n = make();
    if (!chosen.includes(n) && accept(n, chosen)) chosen.push(n);
  }
  if (chosen.length < count) throw new Error("distinctNumbers: could not find enough values");
  return chosen;
}

/** The singular/plural accepted spellings of a place name, for typed answers. */
export function placeAnswers(place: number): string[] {
  const name = PLACE_NAMES[place] ?? "";
  const singular = name.replace(/s$/, "");
  return place === 0
    ? ["ones", "one", "units", "unit", "ones place", "units place"]
    : [name, singular, `${name} place`, `${singular} place`];
}
