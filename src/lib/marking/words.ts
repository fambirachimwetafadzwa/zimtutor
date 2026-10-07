/**
 * English number words (the syllabus asks learners to read and write numbers in words, and to use
 * ordinals "first to thirtieth").
 *
 *   numberToWords(405)      → "four hundred and five"
 *   wordsToNumber("Four hundred five") → 405n
 *   ordinalWords(21)        → "twenty-first"
 */

const ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES: Array<[bigint, string]> = [
  [1_000_000_000n, "billion"],
  [1_000_000n, "million"],
  [1_000n, "thousand"],
];

function below1000(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds > 0) parts.push(`${ONES[hundreds]} hundred`);
  if (rest > 0) {
    const tail =
      rest < 20
        ? ONES[rest]!
        : `${TENS[Math.floor(rest / 10)]}${rest % 10 ? `-${ONES[rest % 10]}` : ""}`;
    parts.push(hundreds > 0 ? `and ${tail}` : tail);
  }
  return parts.join(" ");
}

/** Whole numbers 0 … 999 999 999 999 in British/Zimbabwean style ("and" after hundreds). */
export function numberToWords(value: number | bigint): string {
  let n = typeof value === "bigint" ? value : BigInt(value);
  if (n < 0n) return `minus ${numberToWords(-n)}`;
  if (n === 0n) return "zero";
  if (n >= 1_000_000_000_000n) throw new RangeError("Number too large for words");
  const parts: string[] = [];
  for (const [size, name] of SCALES) {
    if (n >= size) {
      parts.push(`${below1000(Number(n / size))} ${name}`);
      n %= size;
    }
  }
  if (n > 0n) {
    const rest = Number(n);
    // "one thousand and five", "two million and one": "and" joins a final sub-hundred group.
    parts.push(parts.length > 0 && rest < 100 ? `and ${below1000(rest)}` : below1000(rest));
  }
  return parts.join(" ");
}

const ORDINAL_IRREGULAR: Record<string, string> = {
  one: "first",
  two: "second",
  three: "third",
  five: "fifth",
  eight: "eighth",
  nine: "ninth",
  twelve: "twelfth",
};

/** "first" … "ninety-ninth" and beyond for simple cases. */
export function ordinalWords(n: number): string {
  const words = numberToWords(n);
  const match = /(^|[\s-])([a-z]+)$/.exec(words);
  if (!match) return words;
  const last = match[2]!;
  const ordinal =
    ORDINAL_IRREGULAR[last] ?? (last.endsWith("y") ? `${last.slice(0, -1)}ieth` : `${last}th`);
  return `${words.slice(0, words.length - last.length)}${ordinal}`;
}

/** 1 → "1st", 22 → "22nd", 13 → "13th". */
export function ordinalNumeral(n: number): string {
  const lastTwo = n % 100;
  const suffix =
    lastTwo >= 11 && lastTwo <= 13
      ? "th"
      : (({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th");
  return `${n}${suffix}`;
}

const WORD_VALUES = new Map<string, number>();
ONES.forEach((w, i) => WORD_VALUES.set(w, i));
TENS.forEach((w, i) => w && WORD_VALUES.set(w, i * 10));
WORD_VALUES.set("fourty", 40); // a common spelling slip: be kind, accept it

/** Parse number words ("four hundred and five", "twenty-one", "one thousand two hundred"). Null if not a number. */
export function wordsToNumber(text: string): bigint | null {
  const tokens = text
    .toLowerCase()
    .replace(/[,]/g, " ")
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter((t) => t !== "" && t !== "and");
  if (tokens.length === 0) return null;
  let negative = false;
  if (tokens[0] === "minus" || tokens[0] === "negative") {
    negative = true;
    tokens.shift();
  }
  let total = 0n;
  let current = 0n;
  let sawNumber = false;
  for (const token of tokens) {
    const small = WORD_VALUES.get(token);
    if (small !== undefined) {
      current += BigInt(small);
      sawNumber = true;
    } else if (token === "hundred") {
      if (!sawNumber) return null;
      current = (current === 0n ? 1n : current) * 100n;
    } else {
      const scale = SCALES.find(([, name]) => name === token);
      if (!scale || !sawNumber) return null;
      total += (current === 0n ? 1n : current) * scale[0];
      current = 0n;
    }
  }
  const value = total + current;
  return negative ? -value : value;
}
