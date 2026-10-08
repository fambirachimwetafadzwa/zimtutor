import { numberToWords, ordinalNumeral, ordinalWords } from "../../marking/words";
import {
  byLevel,
  defineTemplate,
  fmtInt,
  joinWords,
  numberWordVariants,
  PLACE_NAMES,
  scoped,
  type Wrong,
} from "../kit";
import {
  isPrime,
  primeFactorisation,
  PRIMES_TO_100,
  roundToNearest,
  toRoman,
  truncateTo,
} from "../maths";
import type { Rng } from "../rng";
import { GRADE_MAX, type Difficulty } from "../types";
import {
  asWrongs,
  breakdownText,
  distinctNumbers,
  groupsText,
  makeWhole,
  numberVariants,
  placeAnswers,
  placeParts,
  wholeDigitsFor,
} from "./common";

/**
 * Numeration of whole numbers: reading and writing numbers, place value, expanded notation,
 * comparing and ordering, counting and sequences, rounding, ordinals, Roman numerals, primes.
 * Number ranges follow the "Content" column of the syllabus for each grade.
 */

const WHOLE_STRANDS = /^(numerals|words|whole-numbers)$/;

/** Most digits a whole number may have in a grade (the ranges 0–1 000 … 0–10 000 000). */
const maxDigits = (grade: number): number => String(GRADE_MAX[grade]!).length - 1;

// ── read and write numbers ──────────────────────────────────────────────────────────────────────

export const numeralWords = defineTemplate({
  id: "num.numeral-words",
  description: "Read whole numbers in numerals or words and write them in numerals or words.",
  covers: (o) =>
    scoped(o, {
      topic: "NUM",
      strand: WHOLE_STRANDS,
      text: /\b(?:read|write)\b[^.]*\b(?:numerals?|words)\b/i,
      not: /roman|ordinal|sequence/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const t = o.text.toLowerCase();
    type Kind = "readNumeral" | "readWords" | "writeNumeral" | "writeWords";
    const kinds: Kind[] = [];
    if (/read/.test(t)) {
      if (/numerals?/.test(t)) kinds.push("readNumeral");
      if (/words/.test(t)) kinds.push("readWords");
    }
    if (/write/.test(t)) {
      if (/numerals?/.test(t)) kinds.push("writeNumeral");
      if (/words/.test(t)) kinds.push("writeWords");
    }
    let kind = rng.pick(kinds);
    // The easiest level recognises the right form among choices instead of writing it.
    if (d === 1)
      kind = kind === "writeNumeral" ? "readWords" : kind === "writeWords" ? "readNumeral" : kind;

    const n = makeWhole(rng, wholeDigitsFor(o.grade, d), { zero: d >= 3 });
    const words = numberToWords(n);
    const variants = numberVariants(rng, n, GRADE_MAX[o.grade]!);
    const hasZero = String(n).slice(1).includes("0");
    const groups = n >= 1000 ? groupsText(n) : null;

    if (kind === "readNumeral") {
      return q.mcq({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Which words show the number ${fmtInt(n)}?`,
        correct: words,
        wrongs: asWrongs(variants, numberToWords),
        explanation: `${fmtInt(n)} is ${breakdownText(n)}. We read it as “${words}”.`,
        hints: [
          "Read the number from the left, one place at a time.",
          groups
            ? `Cut the number into groups of three digits: ${groups}. The group on the left comes before the word “thousand” (or “million”).`
            : "Say the hundreds first, then the tens and the ones.",
          hasZero
            ? "A zero means that place is empty, so nothing is said for it."
            : "Say each place in turn and join the parts together.",
        ],
      });
    }
    if (kind === "readWords") {
      return q.mcq({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Which numeral shows “${words}”?`,
        correct: fmtInt(n),
        wrongs: asWrongs(variants, fmtInt),
        explanation: `“${words}” is ${breakdownText(n)}, so it is written ${fmtInt(n)}.`,
        hints: [
          "Listen for the place words: thousand, hundred … They tell you how big the number is.",
          "Write a digit for every place. If a place is not said, put a 0 there.",
          `The number has ${String(n).length} digits.`,
        ],
      });
    }
    if (kind === "writeNumeral") {
      return q.numeric({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Write this number in numerals: ${words}.`,
        answer: String(n),
        requireForm: "digits",
        answerHint: "Type the number using digits.",
        wrongs: asWrongs(variants, String),
        explanation: `“${words}” is ${breakdownText(n)}, so it is written ${fmtInt(n)}.`,
        hints: [
          "Listen for the place words: thousand, hundred … They tell you how many digits to write.",
          "Write a digit for every place. If a place is not said, put a 0 there.",
          `The number has ${String(n).length} digits.`,
        ],
      });
    }
    return q.text({
      skill: "KNOWLEDGE_COMPREHENSION",
      stem: `Write ${fmtInt(n)} in words.`,
      accepted: numberWordVariants(n),
      answerHint: "Use words, not digits.",
      explanation: `${fmtInt(n)} is ${breakdownText(n)}. In words: ${words}.`,
      hints: [
        "Say the number aloud, one group at a time, from the left.",
        groups
          ? `Cut the number into groups of three digits: ${groups}.`
          : "Say the hundreds first, then the tens and the ones.",
        hasZero
          ? "A zero means that place is empty, so nothing is said for it."
          : "Join the parts you said with “and” before the tens and ones.",
      ],
    });
  },
});

// ── place value ─────────────────────────────────────────────────────────────────────────────────

export const placeValue = defineTemplate({
  id: "num.place-value",
  description: "Value and place of a digit in a whole number, and comparing the value of digits.",
  covers: (o) =>
    scoped(o, {
      topic: "NUM",
      strand: /^(?!decimal)/,
      text: /place value|values? of (?:the )?digits?/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const wantsCompare = /compare/i.test(o.text);
    const mode = wantsCompare
      ? "compare"
      : rng.pick(["value", "value", "value", "place", "place", "digit"] as const);
    const digits = wholeDigitsFor(o.grade, d);

    if (mode === "compare") {
      const size = Math.max(2, digits);
      const repeated = rng.int(1, 9);
      let ds: number[] = [];
      let slots: number[] = [];
      for (let tries = 0; tries < 100; tries++) {
        slots = rng.sample([...Array(size).keys()], 2).sort((a, b) => a - b);
        const pool = rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter((x) => x !== repeated));
        let next = 0;
        ds = Array.from({ length: size }, (_, i) => (slots.includes(i) ? repeated : pool[next++]!));
        if (ds[0] !== 0) break;
      }
      const n = Number(ds.join(""));
      const place = (slot: number) => size - 1 - slot;
      const big = repeated * 10 ** place(slots[0]!);
      const small = repeated * 10 ** place(slots[1]!);
      if (d <= 3) {
        return q.mcq({
          skill: "KNOWLEDGE_COMPREHENSION",
          stem: `In the number ${fmtInt(n)} the digit ${repeated} appears twice. Which ${repeated} has the greater value?`,
          correct: `The first ${repeated} (on the left)`,
          wrongs: [
            { answer: "They are worth the same", tag: "PLACE_VALUE_CONFUSION" },
            { answer: `The last ${repeated} (on the right)` },
          ],
          explanation: `The first ${repeated} is in the ${PLACE_NAMES[place(slots[0]!)]} place, so it is worth ${fmtInt(big)}. The other ${repeated} is in the ${PLACE_NAMES[place(slots[1]!)]} place and is worth only ${fmtInt(small)}. The same digit is worth more further to the left.`,
          hints: [
            "The same digit can be worth different amounts in different places.",
            "Find the place of each digit. Which place is worth more?",
            "Places further to the left are worth more.",
          ],
        });
      }
      return q.numeric({
        skill: "ANALYSIS",
        stem: `In the number ${fmtInt(n)} the digit ${repeated} appears twice. How much greater is the value of the first ${repeated} (on the left) than the value of the other ${repeated}?`,
        answer: String(big - small),
        wrongs: [
          { answer: String(big + small), tag: "PLACE_VALUE_CONFUSION" },
          { answer: "0", tag: "PLACE_VALUE_CONFUSION" },
          { answer: String(big), tag: "PLACE_VALUE_CONFUSION" },
        ],
        explanation: `The first ${repeated} is worth ${fmtInt(big)} and the other is worth ${fmtInt(small)}. The difference is ${fmtInt(big)} − ${fmtInt(small)} = ${fmtInt(big - small)}.`,
        hints: [
          "First find the value of each of the two digits.",
          "Work out the value of the left digit, then of the right digit.",
          "Subtract the smaller value from the larger value.",
        ],
      });
    }

    const n = makeWhole(rng, digits, { distinct: true });
    const parts = placeParts(n).filter((p) => p.digit > 0);
    const target = rng.pick(parts);
    const shown = fmtInt(n);

    if (mode === "digit") {
      return q.numeric({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Which digit is in the ${target.name} place of ${shown}?`,
        answer: String(target.digit),
        wrongs: placeParts(n)
          .filter((p) => p.place !== target.place)
          .map((p) => ({ answer: String(p.digit), tag: "PLACE_VALUE_CONFUSION" })),
        explanation: `In ${shown} the digits are worth ${breakdownText(n)}. The digit in the ${target.name} place is ${target.digit}.`,
        hints: [
          "Put the number in a place-value chart, one digit in each column.",
          "Count the places from the right: ones, tens, hundreds, thousands …",
          `Count ${target.place + 1} ${target.place === 0 ? "place" : "places"} from the right.`,
        ],
      });
    }

    if (mode === "place") {
      const wrongPlaces = [target.place - 1, target.place + 1, target.place + 2, target.place - 2]
        .filter((p) => p >= 0 && p <= digits && p !== target.place)
        .map((p) => ({ answer: PLACE_NAMES[p]!, tag: "PLACE_VALUE_CONFUSION" }));
      const common = {
        skill: "KNOWLEDGE_COMPREHENSION" as const,
        stem: `In the number ${shown}, which place is the digit ${target.digit} in?`,
        explanation: `${shown} is ${breakdownText(n)}. The digit ${target.digit} is in the ${target.name} place.`,
        hints: [
          "Put the number in a place-value chart and find the digit.",
          "Count the places from the right: ones, tens, hundreds, thousands …",
          target.place === 0
            ? `The digit ${target.digit} is the last digit: nothing is to its right.`
            : `${target.place === 1 ? "One digit is" : `${target.place} digits are`} to the right of ${target.digit}.`,
        ],
      };
      if (d <= 3) return q.mcq({ ...common, correct: target.name, wrongs: wrongPlaces });
      return q.text({
        ...common,
        accepted: placeAnswers(target.place),
        answerHint: "Write the name of the place, such as hundreds.",
      });
    }

    const value = target.value;
    const wrongs: Wrong[] = [
      { answer: String(target.digit), tag: "PLACE_VALUE_CONFUSION" },
      { answer: String(value * 10), tag: "PLACE_VALUE_CONFUSION" },
      ...(value >= 10 ? [{ answer: String(value / 10), tag: "PLACE_VALUE_CONFUSION" }] : []),
      ...(value >= 100 ? [{ answer: String(value / 100), tag: "PLACE_VALUE_CONFUSION" }] : []),
    ];
    const common = {
      skill: "KNOWLEDGE_COMPREHENSION" as const,
      stem: `What is the value of the digit ${target.digit} in ${shown}?`,
      explanation: `In ${shown} the digit ${target.digit} is in the ${target.name} place, so its value is ${target.digit} × ${fmtInt(10 ** target.place)} = ${fmtInt(value)}.`,
      hints: [
        "Look at which column the digit is in. The column tells you how much each unit is worth.",
        "Count the places from the right: ones, tens, hundreds, thousands …",
        `The digit ${target.digit} is in the ${target.name} place. How many ${target.name} is that worth?`,
      ],
    };
    if (d <= 2)
      return q.mcq({
        ...common,
        correct: fmtInt(value),
        wrongs: wrongs.map((w) => ({ ...w, answer: fmtInt(Number(w.answer)) })),
      });
    return q.numeric({ ...common, answer: String(value), wrongs });
  },
});

// ── expanded notation ───────────────────────────────────────────────────────────────────────────

export const expandedNotation = defineTemplate({
  id: "num.expanded-notation",
  description: "Write whole numbers in expanded notation and recover a number from its expansion.",
  covers: (o) =>
    scoped(o, { topic: "NUM", strand: /^(?!decimal)/, text: /expand|notation/i, not: /decimal/i }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const digits = Math.min(
      maxDigits(o.grade),
      Math.max(2, wholeDigitsFor(o.grade, d) - (d <= 2 ? 1 : 0)),
    );
    const n = makeWhole(rng, digits, { zero: d >= 3 && digits >= 3, minNonZero: 2 });
    const all = placeParts(n);
    const parts = all.filter((p) => p.digit > 0);
    const terms = parts.map((p) => p.value);
    const expanded = terms.map(fmtInt).join(" + ");
    const hasZero = String(n).includes("0");

    // typical errors
    const digitSum = parts.map((p) => p.digit).join(" + ");
    // ignoring the empty place: the digits after the zero move up one place
    const top = all[0]!.place;
    const shifted = parts.map((p, i) => p.digit * 10 ** (top - i));
    const shiftedSum = shifted.reduce((a, b) => a + b, 0);
    const shiftedText = shifted.map(fmtInt).join(" + ");
    // the last two digits written in each other's places
    const swappedTerms = (() => {
      const ds = all.map((p) => p.digit);
      const a = ds.length - 2;
      if (ds[a] === ds[a + 1]) return null;
      [ds[a], ds[a + 1]] = [ds[a + 1]!, ds[a]!];
      const terms = ds.map((digit, i) => digit * 10 ** (ds.length - 1 - i)).filter((v) => v > 0);
      return terms.reduce((x, y) => x + y, 0) === n ? null : terms;
    })();
    const hints = [
      "Each digit is worth its value in its own place. Write one term for every digit that is not zero.",
      "Say the value of each digit: ones, tens, hundreds, thousands …",
    ];

    const mode =
      d <= 2
        ? "choose"
        : d === 3
          ? rng.pick(["write", "reverse"] as const)
          : rng.pick(["write", "reverse", "write"] as const);
    if (mode === "choose") {
      const wrongs: Wrong[] = [
        { answer: digitSum, tag: "PLACE_VALUE_CONFUSION" },
        ...(swappedTerms
          ? [{ answer: swappedTerms.map(fmtInt).join(" + "), tag: "PLACE_VALUE_CONFUSION" }]
          : []),
        ...(hasZero && shiftedSum !== n
          ? [{ answer: shiftedText, tag: "ZERO_PLACEHOLDER_ERROR" }]
          : []),
        {
          answer: parts.map((p) => fmtInt(p.value * 10)).join(" + "),
          tag: "PLACE_VALUE_CONFUSION",
        },
      ];
      return q.mcq({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Which of these is ${fmtInt(n)} in expanded notation?`,
        correct: expanded,
        wrongs,
        explanation: `${fmtInt(n)} is ${breakdownText(n)}, so in expanded notation it is ${expanded}.`,
        hints,
      });
    }
    if (mode === "write") {
      return q.expression({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Write ${fmtInt(n)} in expanded notation.`,
        expression: String(n),
        kind: "expanded",
        terms,
        answerText: expanded,
        answerHint: "Write a sum with one term for each digit that is not zero.",
        wrongs: [
          { answer: digitSum, tag: "PLACE_VALUE_CONFUSION" },
          ...(hasZero && shiftedSum !== n
            ? [{ answer: shifted.join(" + "), tag: "ZERO_PLACEHOLDER_ERROR" }]
            : []),
        ],
        explanation: `${fmtInt(n)} is ${breakdownText(n)}. Writing the value of each digit gives ${expanded}.`,
        solutionSteps: parts.map((p) => `${p.digit} ${p.name} = ${fmtInt(p.value)}`),
        hints,
      });
    }
    // reverse: from the expansion to the number
    const shuffled = d >= 4 ? rng.shuffle(parts) : parts;
    const concatenated = Number(parts.map((p) => p.digit).join(""));
    return q.numeric({
      skill: "KNOWLEDGE_COMPREHENSION",
      stem: `What number is ${shuffled.map((p) => fmtInt(p.value)).join(" + ")}?`,
      answer: String(n),
      requireForm: "digits",
      wrongs: [
        ...(hasZero ? [{ answer: String(concatenated), tag: "ZERO_PLACEHOLDER_ERROR" }] : []),
        ...(hasZero && shiftedSum !== n
          ? [{ answer: String(shiftedSum), tag: "ZERO_PLACEHOLDER_ERROR" }]
          : []),
        { answer: String(n * 10), tag: "PLACE_VALUE_CONFUSION" },
      ],
      explanation: `Add the values: ${terms.map(fmtInt).join(" + ")} = ${fmtInt(n)}. The places that are missing from the sum hold zeros.`,
      hints: [
        "Each term is the value of one digit. Which place is each one in?",
        "Write each digit in its place in a place-value chart. Places with no term get a 0.",
        `The number has ${String(n).length} digits.`,
      ],
    });
  },
});

// ── comparing and ordering ──────────────────────────────────────────────────────────────────────

/** Two numbers that first differ in the place chosen by the difficulty (later places = harder). */
function closePair(rng: Rng, digits: number, difficulty: number): [number, number] {
  for (let tries = 0; tries < 200; tries++) {
    const a = makeWhole(rng, digits, { zero: difficulty >= 4 });
    const ds = String(a).split("").map(Number);
    const firstDiff = Math.min(digits - 1, Math.max(0, difficulty - 1));
    const copy = [...ds];
    copy[firstDiff] = (copy[firstDiff]! + rng.int(1, 9)) % 10;
    if (firstDiff === 0 && copy[0] === 0) continue;
    // scramble the lower places so that "the larger last digits" does not decide the comparison
    for (let i = firstDiff + 1; i < digits; i++) copy[i] = rng.int(0, 9);
    const b = Number(copy.join(""));
    if (a !== b) return [a, b];
  }
  throw new Error("closePair: failed");
}

export const compareWhole = defineTemplate({
  id: "num.compare-whole",
  description: "Compare whole numbers with the signs <, > and =, and pick the largest or smallest.",
  covers: (o) =>
    scoped(o, {
      topic: "NUM",
      strand: /^(comparison-of-numbers|whole-numbers)$/,
      text: /compare/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const digits = wholeDigitsFor(o.grade, d);
    const mode =
      d >= 4 && rng.chance(0.3) ? "equal" : d >= 3 && rng.chance(0.4) ? "extreme" : "sign";
    const signHint = [
      "Count the digits first. A number with more digits is bigger.",
      "If both numbers have the same number of digits, compare them place by place, starting on the left.",
    ];

    if (mode === "extreme") {
      const nums = distinctNumbers(rng, 4, () => closePair(rng, digits, d)[rng.int(0, 1)]!);
      const largest = rng.chance(0.5);
      const sorted = [...nums].sort((a, b) => a - b);
      const answer = largest ? sorted[3]! : sorted[0]!;
      return q.mcq({
        skill: "ANALYSIS",
        stem: `Which of these numbers is the ${largest ? "largest" : "smallest"}?`,
        correct: fmtInt(answer),
        wrongs: nums.filter((x) => x !== answer).map((x) => ({ answer: fmtInt(x) })),
        explanation: `Comparing from the left place by place: ${sorted.map(fmtInt).join(" < ")}. The ${largest ? "largest" : "smallest"} is ${fmtInt(answer)}.`,
        hints: [...signHint, "Look for the first place where the numbers are different."],
      });
    }

    let left: string;
    let right: string;
    let sign: "<" | ">" | "=";
    if (mode === "equal") {
      const n = makeWhole(rng, digits, { zero: true, minNonZero: 2 });
      const expanded = placeParts(n)
        .filter((p) => p.digit > 0)
        .map((p) => fmtInt(p.value))
        .join(" + ");
      [left, right] = rng.chance(0.5) ? [expanded, fmtInt(n)] : [fmtInt(n), expanded];
      sign = "=";
    } else {
      const [a, b] = closePair(rng, digits, d);
      left = fmtInt(a);
      right = fmtInt(b);
      sign = a < b ? "<" : a > b ? ">" : "=";
    }
    return q.mcq({
      skill: mode === "equal" ? "ANALYSIS" : "KNOWLEDGE_COMPREHENSION",
      stem: `Which sign makes the statement true?  ${left}  ___  ${right}`,
      correct: sign,
      wrongs: (["<", "=", ">"] as const)
        .filter((s) => s !== sign)
        .map((s) => ({ answer: s, tag: "PLACE_VALUE_CONFUSION" })),
      keepOrder: true,
      explanation:
        mode === "equal"
          ? `${left} and ${right} are the same number written in two ways, so the sign is =.`
          : `Comparing place by place from the left, ${left} is ${sign === "<" ? "smaller than" : "bigger than"} ${right}, so the sign is ${sign}.`,
      hints:
        mode === "equal"
          ? ["Work out the value of the one that is written as a sum.", "Compare the two values."]
          : [...signHint, "Remember: the sign opens towards the bigger number."],
    });
  },
});

export const orderWhole = defineTemplate({
  id: "num.order-whole",
  description: "Arrange whole numbers in ascending or descending order.",
  covers: (o) =>
    scoped(o, {
      topic: "NUM",
      strand: /^(comparison-of-numbers|whole-numbers)$/,
      text: /arrange|order of (?:size|magnitude)|ascending/i,
      not: /count|fraction|decimal|mixed/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const digits = wholeDigitsFor(o.grade, d);
    const count = byLevel(d, [3, 3, 4, 4, 5]);
    const ascending = rng.chance(0.5);
    // at higher levels the numbers share their first digits, so each place has to be looked at
    const prefixLength = d >= 3 ? Math.max(0, digits - 3) : 0;
    const prefix = prefixLength > 0 ? makeWhole(rng, prefixLength, { noZero: true }) : 0;
    const tailDigits = digits - prefixLength;
    const nums = distinctNumbers(rng, count, () => {
      const tail = rng.int(10 ** (tailDigits - 1), 10 ** tailDigits - 1);
      return prefixLength > 0 ? Number(`${prefix}${tail}`) : tail;
    });
    const sorted = [...nums].sort((a, b) => a - b);
    const sequence = (ascending ? sorted : [...sorted].reverse()).map(fmtInt);
    return q.ordering({
      skill: "KNOWLEDGE_COMPREHENSION",
      stem: `Arrange these numbers in ${ascending ? "ascending" : "descending"} order (from the ${ascending ? "smallest to the largest" : "largest to the smallest"}): ${nums.map(fmtInt).join(", ")}.`,
      sequence,
      explanation: `${ascending ? "Ascending" : "Descending"} order is from the ${ascending ? "smallest" : "largest"} to the ${ascending ? "largest" : "smallest"}: ${sequence.join(", ")}.`,
      hints: [
        "Compare the numbers place by place, starting from the left.",
        `Find the ${ascending ? "smallest" : "largest"} number first and put it first.`,
        `The ${ascending ? "smallest" : "largest"} number is ${sequence[0]}.`,
      ],
    });
  },
});

// ── counting and sequences ──────────────────────────────────────────────────────────────────────

const COUNT_STEPS: Record<number, readonly number[]> = {
  5: [2, 5, 10, 25, 50, 100, 250, 500, 1000, 10000],
  6: [2, 5, 10, 25, 50, 100, 250, 500, 1000, 10000, 100000],
  7: [2, 5, 10, 25, 50, 100, 250, 500, 1000, 10000, 100000, 1000000],
};

export const countOnBack = defineTemplate({
  id: "num.count-on-back",
  description: "Count on or back in steps and name the missing number.",
  covers: (o) =>
    scoped(o, { topic: "NUM", strand: /^whole-numbers$/, text: /count in ascending/i }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const steps = COUNT_STEPS[o.grade] ?? COUNT_STEPS[5]!;
    const pool = byLevel(d, [
      steps.filter((s) => s <= 10),
      steps.filter((s) => s >= 2 && s <= 25),
      steps.filter((s) => s >= 25 && s <= 500),
      steps.filter((s) => s >= 100 && s <= 10000),
      steps.filter((s) => s >= 1000),
    ]);
    const step = rng.pick(pool.length > 0 ? pool : steps);
    const up = rng.chance(0.5);
    const max = GRADE_MAX[o.grade]!;
    const length = 5;
    // start so that all terms stay inside the grade's range and never go below zero
    const span = step * length;
    const from = up ? 0 : Math.ceil(span / step);
    const to = Math.max(from, Math.floor((up ? max - span : max) / step));
    const start = step * rng.int(from, to);
    const seq = Array.from({ length }, (_, i) => start + (up ? i : -i) * step);
    const missing = rng.int(2, length - 1);
    const shown = seq.map((v, i) => (i === missing ? "___" : fmtInt(v)));
    const answer = seq[missing]!;
    return q.numeric({
      skill: "KNOWLEDGE_COMPREHENSION",
      stem: `Count ${up ? "on" : "back"} in ${fmtInt(step)}s. Find the missing number: ${shown.join(", ")}.`,
      answer: String(answer),
      wrongs: [
        { answer: String(seq[missing - 1]! + (up ? -step : step)) },
        { answer: String(answer + (up ? step : -step)) },
        { answer: String(answer + (up ? 10 * step : -10 * step)), tag: "PLACE_VALUE_CONFUSION" },
      ].filter((w) => Number(w.answer) >= 0),
      explanation: `Each number is ${fmtInt(step)} ${up ? "more" : "less"} than the one before it. After ${fmtInt(seq[missing - 1]!)} comes ${fmtInt(answer)}.`,
      hints: [
        "Look at two numbers next to each other. How much do they change by?",
        `The numbers go ${up ? "up" : "down"} by the same amount each time.`,
        `${up ? "Add" : "Subtract"} that amount to the number just before the gap.`,
      ],
    });
  },
});

interface Sequence {
  terms: number[];
  rule: string;
  /** Wrong rules that could be mistaken for this one. */
  wrongRules: string[];
}

/** An arithmetic (or, at the hardest levels, doubling) sequence that stays inside `max`. */
function makeSequence(
  rng: Rng,
  grade: number,
  difficulty: Difficulty,
  length: number,
  max: number,
): Sequence {
  const steps = byLevel(difficulty, [
    [2, 5, 10],
    [3, 4, 5, 10, 20],
    [3, 6, 7, 8, 9, 25],
    [11, 12, 15, 25, 50, 100],
    [12, 15, 25, 50, 75, 125, 250],
  ]).filter((s) => s * (length + 1) <= max);
  const kind =
    difficulty >= 4 && grade >= 4 && rng.chance(0.35)
      ? "double"
      : difficulty >= 3 && rng.chance(0.4)
        ? "down"
        : "up";
  if (kind === "double") {
    const start = rng.pick([1, 2, 3, 5]);
    const terms = Array.from({ length }, (_, i) => start * 2 ** i);
    if (terms[length - 1]! <= max)
      return {
        terms,
        rule: "Multiply by 2",
        wrongRules: ["Add 2", "Add the last two numbers", "Multiply by 3"],
      };
  }
  const step = rng.pick(steps.length > 0 ? steps : [2, 5, 10]);
  if (kind === "down") {
    const start = step * (length + rng.int(1, 6));
    return {
      terms: Array.from({ length }, (_, i) => start - i * step),
      rule: `Subtract ${fmtInt(step)}`,
      wrongRules: [
        `Add ${fmtInt(step)}`,
        `Subtract ${fmtInt(step + 1)}`,
        `Divide by ${fmtInt(step)}`,
      ],
    };
  }
  const start = rng.int(0, 2 * step);
  return {
    terms: Array.from({ length }, (_, i) => start + i * step),
    rule: `Add ${fmtInt(step)}`,
    wrongRules: [
      `Add ${fmtInt(step + 1)}`,
      `Subtract ${fmtInt(step)}`,
      `Multiply by ${fmtInt(step)}`,
    ],
  };
}

const ruleSentence = (s: Sequence) => `The rule is “${s.rule.toLowerCase()}”.`;

export const numberSequences = defineTemplate({
  id: "num.sequences",
  description: "Find the rule of a number sequence, complete it, and continue it.",
  covers: (o) =>
    scoped(o, {
      topic: "NUM",
      strand: /^(number-sequence|whole-numbers)$/,
      text: /sequence|pattern/i,
      not: /create|their own/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const max = GRADE_MAX[o.grade]!;
    const wantsRule = /pattern|establish/i.test(o.text);
    const mode = wantsRule ? "rule" : rng.pick(["missing", "missing", "next"] as const);

    if (mode === "next") {
      const seq = makeSequence(rng, o.grade, d, 7, max);
      const shown = seq.terms.slice(0, 4);
      const answers = seq.terms.slice(4, 7);
      return q.list({
        skill: "APPLICATION",
        stem: `Write the next three numbers in this sequence: ${shown.map(fmtInt).join(", ")}, …`,
        sequence: answers.map(String),
        answerHint: "Type the three numbers in order, with commas between them.",
        explanation: `${ruleSentence(seq)} The next three numbers are ${answers.map(fmtInt).join(", ")}.`,
        hints: [
          "Look at two numbers next to each other. What changes between them?",
          "Check that the same change works for every pair of neighbours.",
          "Use the rule on the last number shown, then again on the new number.",
        ],
      });
    }

    const seq = makeSequence(rng, o.grade, d, 6, max);
    if (mode === "rule") {
      return q.mcq({
        skill: "ANALYSIS",
        stem: `Look at this number pattern: ${seq.terms.map(fmtInt).join(", ")}. What is the rule?`,
        correct: seq.rule,
        wrongs: seq.wrongRules.map((rule) => ({ answer: rule })),
        explanation: ruleSentence(seq),
        hints: [
          "Look at two numbers next to each other. What changes between them?",
          "Check that the same change works for every pair of neighbours.",
        ],
      });
    }
    const gap = rng.int(2, 4);
    const shown = seq.terms.map((v, i) => (i === gap ? "___" : fmtInt(v)));
    const answer = seq.terms[gap]!;
    return q.numeric({
      skill: "KNOWLEDGE_COMPREHENSION",
      stem: `Complete the number sequence: ${shown.join(", ")}.`,
      answer: String(answer),
      wrongs: [
        { answer: String(answer + 1) },
        { answer: String(answer - 1) },
        { answer: String(seq.terms[gap + 1]! + (seq.terms[gap + 1]! - answer)) },
      ].filter((w) => Number(w.answer) >= 0),
      explanation: `${ruleSentence(seq)} So the missing number is ${fmtInt(answer)}.`,
      hints: [
        "Look at the numbers next to the gap. How do they change?",
        "Find the rule from a pair of neighbours that are both shown.",
        "Use the rule on the number just before the gap.",
      ],
    });
  },
});

// ── rounding ────────────────────────────────────────────────────────────────────────────────────

const ROUND_UNITS: Record<number, readonly number[]> = {
  3: [10, 100],
  4: [10, 100, 1000],
  5: [10, 100, 1000, 10000],
  6: [10, 100, 1000, 10000, 100000],
  7: [10, 100, 1000, 10000, 100000, 1000000],
};
const UNIT_NAMES: Record<number, string> = {
  10: "ten",
  100: "hundred",
  1000: "thousand",
  10000: "ten thousand",
  100000: "hundred thousand",
  1000000: "million",
};

const ROUND_CONTEXTS = [
  { setting: (n: string) => `A sports day was attended by ${n} people.`, thing: "people" },
  { setting: (n: string) => `A farmer harvested ${n} kg of maize.`, thing: "kg of maize" },
  {
    setting: (n: string) => `A school has ${n} exercise books in its store.`,
    thing: "exercise books",
  },
  { setting: (n: string) => `A village has ${n} people living in it.`, thing: "people" },
  { setting: (n: string) => `A factory made ${n} bricks last month.`, thing: "bricks" },
  {
    setting: (n: string) => `A bus company carried ${n} passengers in a year.`,
    thing: "passengers",
  },
] as const;

export const roundWhole = defineTemplate({
  id: "num.round-whole",
  description: "Round whole numbers to the nearest 10, 100, 1 000 … and use rounding to estimate.",
  covers: (o) =>
    scoped(o, {
      topic: "NUM",
      strand: /^(approximation|whole-numbers)$/,
      text: /round|approximat/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q, local }) => {
    const units = ROUND_UNITS[o.grade] ?? ROUND_UNITS[5]!;
    const unit = units[Math.min(units.length - 1, Math.max(0, d - 1 - rng.int(0, 1)))]!;
    const unitDigits = String(unit).length;
    const max = GRADE_MAX[o.grade]!;
    const digits = Math.min(maxDigits(o.grade), Math.max(unitDigits, wholeDigitsFor(o.grade, d)));
    // the digit just right of the rounding place decides the direction
    const decider = d >= 3 && rng.chance(0.35) ? 5 : rng.int(0, 9);
    const lowerDigits = unitDigits - 2;
    const lower =
      lowerDigits <= 0
        ? 0
        : d >= 4 && rng.chance(0.3)
          ? 10 ** lowerDigits - 1
          : rng.int(0, 10 ** lowerDigits - 1);
    const high = makeWhole(rng, digits - unitDigits + 1, { noZero: true });
    const n = high * unit + decider * (unit / 10) + lower;
    const answer = roundToNearest(n, unit);
    const down = truncateTo(n, unit);
    const up = down + unit;
    const nearest = UNIT_NAMES[unit]!;
    const roundUp = decider >= 5;
    const wrongs: Wrong[] = [
      { answer: String(roundUp ? down : up), tag: "ROUNDING_DIRECTION_ERROR" },
      ...(unit >= 100
        ? [{ answer: String(roundToNearest(n, unit / 10)), tag: "PLACE_VALUE_CONFUSION" }]
        : []),
      ...(units.includes(unit * 10) && roundToNearest(n, unit * 10) > 0
        ? [{ answer: String(roundToNearest(n, unit * 10)), tag: "PLACE_VALUE_CONFUSION" }]
        : []),
      { answer: String(roundUp ? up + unit : down - unit > 0 ? down - unit : up + unit) },
    ].filter((w) => Number(w.answer) <= max);
    const hints = [
      `Find the ${nearest}s place: that is the digit you are rounding to.`,
      "Look at the digit just to the right of it. If it is 5 or more, round up. If it is less than 5, stay where you are.",
      `The digit to look at is ${decider}.`,
    ];
    const explanation = `To round ${fmtInt(n)} to the nearest ${nearest}, look at the digit to the right of the ${nearest}s place. It is ${decider}, which is ${roundUp ? "5 or more, so we round UP" : "less than 5, so we round DOWN"}. The answer is ${fmtInt(answer)}.`;

    const life =
      (o.grade >= 5 && /life|approximat/i.test(o.text) && d >= 3) ||
      (d >= 4 && local && rng.chance(0.5));
    if (life) {
      const ctx = rng.pick(ROUND_CONTEXTS);
      return q.numeric({
        skill: "APPLICATION",
        type: "WORD_PROBLEM",
        stem: `${ctx.setting(fmtInt(n))} About how many ${ctx.thing} is that, to the nearest ${nearest}?`,
        answer: String(answer),
        wrongs,
        usesLocalContext: local,
        explanation,
        hints,
      });
    }
    if (unit <= 100 && d <= 2 && String(n).length === unitDigits) {
      return q.numeric({
        skill: "KNOWLEDGE_COMPREHENSION",
        type: "VISUAL_DIAGRAM",
        stem: `The arrow points at ${fmtInt(n)} on the number line. Round ${fmtInt(n)} to the nearest ${nearest}.`,
        stemData: {
          kind: "number-line",
          from: down,
          to: up,
          step: unit / 10,
          labelled: [down, up],
          pointer: n,
        },
        answer: String(answer),
        wrongs,
        explanation: `${fmtInt(n)} is between ${fmtInt(down)} and ${fmtInt(up)}. It is closer to ${fmtInt(answer)}, so ${fmtInt(n)} rounds to ${fmtInt(answer)}.`,
        hints: [
          `${fmtInt(n)} is between two multiples of ${fmtInt(unit)}. Which two?`,
          "Is the arrow closer to the left end or the right end?",
          "If it is exactly in the middle, we round up.",
        ],
      });
    }
    if (d <= 2) {
      return q.mcq({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Round ${fmtInt(n)} to the nearest ${nearest}.`,
        correct: fmtInt(answer),
        wrongs: wrongs.map((w) => ({ ...w, answer: fmtInt(Number(w.answer)) })),
        explanation,
        hints,
      });
    }
    return q.numeric({
      skill: "APPLICATION",
      stem: `Round ${fmtInt(n)} to the nearest ${nearest}.`,
      answer: String(answer),
      wrongs,
      explanation,
      hints,
    });
  },
});

// ── ordinal numbers ─────────────────────────────────────────────────────────────────────────────

const ORDINAL_MAX: Record<number, number> = { 3: 30, 4: 50, 5: 100, 6: 100, 7: 100 };

export const ordinals = defineTemplate({
  id: "num.ordinals",
  description: "Write ordinal numbers in numerals and words, and use them for positions.",
  covers: (o) =>
    scoped(o, {
      topic: "NUM",
      strand: /^(ordinal|whole-numbers)/,
      text: /ordinal|positions of objects/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q, local }) => {
    const max = ORDINAL_MAX[o.grade]!;
    const positional = /ranking|positioning|positions/i.test(o.text);
    const lo = byLevel(d, [1, 2, 4, 10, 11]);
    const n = rng.int(Math.min(lo, max - 1), max);
    const ord = ordinalNumeral(n);
    const name = rng.pick(["Tendai", "Rudo", "Farai", "Chipo", "Tapiwa", "Nyasha"]);

    if (positional) {
      if (rng.chance(0.5)) {
        return q.numeric({
          skill: "APPLICATION",
          type: "WORD_PROBLEM",
          stem: `${name} is ${ord} in the queue at the ${local ? "tuck shop" : "school gate"}. How many people are in front of ${name}?`,
          answer: String(n - 1),
          wrongs: [{ answer: String(n) }, { answer: String(n + 1) }],
          usesLocalContext: local,
          explanation: `${name} is ${ord}, so there are ${n - 1} people before ${name} in the queue.`,
          hints: [
            "Draw the queue. The first person has nobody in front.",
            `${name} is number ${n} in the line. Does ${name} count among the people in front?`,
          ],
        });
      }
      const total = n + rng.int(2, Math.max(3, Math.min(20, max - n)));
      return q.numeric({
        skill: "APPLICATION",
        type: "WORD_PROBLEM",
        stem: `${total} runners took part in a race. ${name} finished ${ord}. How many runners finished after ${name}?`,
        answer: String(total - n),
        wrongs: [
          { answer: String(total - n + 1) },
          { answer: String(total - n - 1) },
          { answer: String(total) },
        ],
        explanation: `${name} finished ${ord}, so ${n} runners finished up to and including ${name}. ${total} − ${n} = ${total - n} finished after ${name}.`,
        hints: [
          "How many runners finished up to and including your runner?",
          "The runners who finished after are the ones that are left.",
        ],
      });
    }

    const mode = /words and numerals/i.test(o.text)
      ? rng.pick(["numeralToWords", "wordsToNumeral"] as const)
      : rng.pick(["cardinalToOrdinal", "wordsToNumeral", "cardinalToOrdinal"] as const);
    if (mode === "numeralToWords") {
      const words = ordinalWords(n);
      return q.text({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Write ${ord} in words.`,
        accepted: [words],
        answerHint: "Use words, not digits.",
        explanation: `${ord} is written “${words}”.`,
        hints: [
          "Say the number first: “twenty-one”, “thirty-two” …",
          "Then change the last word into its ordinal form (one → first, two → second, three → third, five → fifth).",
        ],
      });
    }
    if (mode === "wordsToNumeral") {
      return q.text({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Write “${ordinalWords(n)}” using numerals and the ordinal ending.`,
        accepted: [ord],
        answerHint: "A number followed by st, nd, rd or th.",
        explanation: `“${ordinalWords(n)}” is position number ${n}, which is written ${ord}.`,
        hints: [
          "First write the number in digits.",
          "Then add the ending: st after 1, nd after 2, rd after 3, th after most others (but 11, 12 and 13 take th).",
        ],
      });
    }
    if (d <= 2) {
      const base = String(n);
      return q.mcq({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `${name} came number ${n} in a race. Which shows ${name}'s position?`,
        correct: ord,
        wrongs: ["st", "nd", "rd", "th"]
          .map((s) => `${base}${s}`)
          .filter((x) => x !== ord)
          .map((x) => ({ answer: x })),
        explanation: `Position ${n} is written ${ord}.`,
        hints: [
          "An ordinal number tells the position: 1st, 2nd, 3rd …",
          "Look at the last digit to choose the ending: 1 → st, 2 → nd, 3 → rd, others → th.",
        ],
      });
    }
    return q.text({
      skill: "KNOWLEDGE_COMPREHENSION",
      stem: `Write the ordinal number for ${n}.`,
      accepted: [ord],
      answerHint: "A number followed by st, nd, rd or th.",
      explanation: `The ordinal number for ${n} is ${ord}.`,
      hints: [
        "Keep the number and add an ending.",
        "Look at the last digit: 1 → st, 2 → nd, 3 → rd, others → th. The numbers 11, 12 and 13 are special: they take th.",
      ],
    });
  },
});

// ── Roman numerals ──────────────────────────────────────────────────────────────────────────────

/** Largest Roman numeral set for each grade, from the Content column (I–X, I–L, I–XX …). */
const ROMAN_MAX: Record<number, number> = { 3: 10, 4: 50, 5: 20, 6: 50, 7: 50 };

export const romanNumerals = defineTemplate({
  id: "num.roman",
  description: "Read, write and convert Roman numerals within the range printed for the grade.",
  covers: (o) => scoped(o, { topic: "NUM", text: /roman/i }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const max = ROMAN_MAX[o.grade]!;
    const lo = byLevel(d, [1, 4, 6, 9, 14]);
    const n = rng.int(Math.min(lo, max - 1), max);
    const roman = toRoman(n);
    const wrongRomans = (): Wrong[] => {
      const out: Wrong[] = [];
      const add = (value: number | string) => {
        const text =
          typeof value === "number" ? (value >= 1 && value <= max ? toRoman(value) : "") : value;
        if (text && text !== roman) out.push({ answer: text });
      };
      if (n === 4) add("IIII");
      if (n === 9) add("VIIII");
      if (n === 19) add("XVIIII");
      for (const delta of [1, -1, 5, -5, 10]) add(n + delta);
      return out;
    };
    const wrongNumbers = (): Wrong[] =>
      [n + 1, n - 1, n + 5, n - 5, n + 10, n + 2]
        .filter((v) => v >= 1 && v !== n)
        .map((v) => ({ answer: String(v) }));

    const mode =
      d <= 2
        ? rng.pick(["toArabic", "toRoman"] as const)
        : d === 3
          ? rng.pick(["toArabic", "toRoman", "matching"] as const)
          : rng.pick(["toArabic", "toRoman", "toArabic"] as const);
    const hints = [
      "I = 1, V = 5, X = 10, L = 50.",
      "A smaller symbol written BEFORE a bigger one is taken away (IV = 4). Written AFTER it, it is added (VI = 6).",
    ];
    if (mode === "matching") {
      const ns = distinctNumbers(rng, 4, () => rng.int(1, max));
      return q.matching({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: "Match each Roman numeral to the same number in Arabic numerals.",
        pairs: Object.fromEntries(ns.map((v) => [toRoman(v), String(v)])),
        explanation: `The matches are: ${ns.map((v) => `${toRoman(v)} = ${v}`).join(", ")}.`,
        hints,
      });
    }
    if (mode === "toArabic") {
      if (d <= 2)
        return q.mcq({
          skill: "KNOWLEDGE_COMPREHENSION",
          stem: `Which Arabic numeral is the same as the Roman numeral ${roman}?`,
          correct: String(n),
          wrongs: wrongNumbers(),
          explanation: `The Roman numeral ${roman} stands for ${n}, so ${roman} = ${n}.`,
          hints,
        });
      return q.numeric({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Write the Roman numeral ${roman} as an Arabic numeral.`,
        answer: String(n),
        requireForm: "digits",
        wrongs: wrongNumbers(),
        explanation: `The Roman numeral ${roman} stands for ${n}, so ${roman} = ${n}.`,
        hints,
      });
    }
    if (d <= 2)
      return q.mcq({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Which Roman numeral is the same as ${n}?`,
        correct: roman,
        wrongs: wrongRomans(),
        explanation: `The number ${n} is written ${roman} in Roman numerals, so ${n} = ${roman}.`,
        hints,
      });
    return q.text({
      skill: "KNOWLEDGE_COMPREHENSION",
      stem: `Write ${n} as a Roman numeral.`,
      accepted: [roman],
      answerHint: o.grade >= 4 ? "Use the letters I, V, X and L." : "Use the letters I, V and X.",
      explanation: `The number ${n} is written ${roman} in Roman numerals, so ${n} = ${roman}.`,
      hints,
    });
  },
});

// ── prime numbers and prime factors ─────────────────────────────────────────────────────────────

/** Composite numbers that look prime at a glance. */
const LOOKS_PRIME = [51, 57, 87, 91, 49, 77, 33, 39, 21, 27, 63, 69, 93, 95, 85, 75];

export const primeNumbers = defineTemplate({
  id: "num.primes",
  description: "Identify prime numbers and write numbers as products of prime factors.",
  covers: (o) => scoped(o, { topic: "NUM", grades: [6, 7], text: /prime/i }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const limit = o.grade === 7 ? 100 : 50;

    if (/factor/i.test(o.text)) {
      const composites = Array.from({ length: limit - 5 }, (_, i) => i + 6).filter(
        (v) => !isPrime(v) && primeFactorisation(v).length >= (d >= 3 ? 3 : 2),
      );
      const n = rng.pick(composites);
      const factors = primeFactorisation(n);
      const distinct = [...new Set(factors)];
      if (d <= 3 || rng.chance(0.4)) {
        const correct = factors.join(" × ");
        const wrongs: Wrong[] = [{ answer: `1 × ${n}` }];
        if (factors.length >= 3) {
          const merged = [...factors];
          merged.splice(0, 2, factors[0]! * factors[1]!);
          wrongs.push({ answer: merged.join(" × ") });
        }
        const bumped = [...factors];
        bumped[bumped.length - 1] = [2, 3, 5, 7].find((p) => p !== bumped[bumped.length - 1])!;
        wrongs.push({ answer: bumped.join(" × ") });
        const compositeDivisor = Array.from({ length: n }, (_, i) => i + 2).find(
          (k) => k < n && n % k === 0 && !isPrime(k),
        );
        if (compositeDivisor)
          wrongs.push({ answer: `${compositeDivisor} × ${n / compositeDivisor}` });
        return q.mcq({
          skill: "APPLICATION",
          stem: `Which shows ${n} written as a product of prime factors?`,
          correct,
          wrongs,
          explanation: `Keep splitting ${n} until every factor is prime: ${n} = ${correct}.`,
          hints: [
            "A prime factor is a factor that is a prime number: it has no factors other than 1 and itself.",
            "Check each choice: is every number in it prime? Then multiply to see if you get back to the number.",
          ],
        });
      }
      return q.list({
        skill: "APPLICATION",
        stem: `List the different prime factors of ${n}, smallest first.`,
        sequence: distinct.map(String),
        answerHint: "Type the prime numbers with commas between them.",
        explanation: `${n} = ${factors.join(" × ")}. The different prime factors are ${joinWords(distinct.map(String))}.`,
        hints: [
          "Start by dividing by the smallest prime number, 2, then 3, then 5 …",
          "Keep dividing until what is left is a prime number.",
        ],
      });
    }

    const primes = PRIMES_TO_100.filter((p) => p <= limit);
    const mode = d <= 2 ? "pick" : rng.pick(["pick", "trueFalse", "count", "list"] as const);
    if (mode === "trueFalse") {
      const n = rng.chance(0.5)
        ? rng.pick(primes.filter((p) => p > 10))
        : rng.pick(LOOKS_PRIME.filter((v) => v <= limit));
      return q.trueFalse({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `True or false: ${n} is a prime number.`,
        value: isPrime(n),
        explanation: isPrime(n)
          ? `${n} has no factors other than 1 and ${n}, so it is prime.`
          : `${n} = ${primeFactorisation(n).join(" × ")}, so it has more than two factors. It is not prime.`,
        hints: [
          "A prime number has exactly two factors: 1 and itself.",
          "Try dividing by 2, 3, 5 and 7. Does any of them divide exactly?",
        ],
      });
    }
    if (mode === "count" || mode === "list") {
      const lo = rng.pick([10, 20, 30].filter((v) => v + 10 <= limit));
      const hi = lo + 10;
      const inside = primes.filter((p) => p > lo && p < hi);
      if (mode === "count")
        return q.numeric({
          skill: "ANALYSIS",
          stem: `How many prime numbers are there between ${lo} and ${hi}?`,
          answer: String(inside.length),
          wrongs: [
            { answer: String(inside.length + 1) },
            { answer: String(inside.length - 1) },
          ].filter((w) => Number(w.answer) >= 0),
          explanation: `The prime numbers between ${lo} and ${hi} are ${joinWords(inside.map(String))}: that is ${inside.length}.`,
          hints: [
            "List the numbers between the two given numbers.",
            "Cross out every number that can be divided exactly by 2, 3, 5 or 7.",
          ],
        });
      return q.list({
        skill: "ANALYSIS",
        stem: `List all the prime numbers between ${lo} and ${hi}, smallest first.`,
        sequence: inside.map(String),
        answerHint: "Type the numbers with commas between them.",
        explanation: `The prime numbers between ${lo} and ${hi} are ${joinWords(inside.map(String))}.`,
        hints: [
          "List the numbers between the two given numbers.",
          "Cross out every even number and every number in the 5 times table.",
          "Check each number that is left: does 3 or 7 divide it exactly?",
        ],
      });
    }
    const prime = rng.pick(primes.filter((p) => p > 2));
    const fakes = rng.sample(
      LOOKS_PRIME.filter((v) => v <= limit),
      3,
    );
    const extra = d >= 3 && rng.chance(0.4) ? [1] : [];
    return q.mcq({
      skill: "KNOWLEDGE_COMPREHENSION",
      stem: "Which of these numbers is a prime number?",
      correct: String(prime),
      wrongs: [...extra, ...fakes].map((v) => ({ answer: String(v) })),
      explanation: `${prime} has only two factors, 1 and ${prime}, so it is prime. The others have more factors; for example ${fakes[0]} = ${primeFactorisation(fakes[0]!).join(" × ")}.`,
      hints: [
        "A prime number has exactly two factors: 1 and itself.",
        "Try dividing each number by 3 and by 7. Does one of them divide exactly?",
      ],
    });
  },
});

// ── abacus ──────────────────────────────────────────────────────────────────────────────────────

export const abacus = defineTemplate({
  id: "num.abacus",
  description: "Read and set numbers on an abacus described by the beads on each rod.",
  covers: (o) => scoped(o, { topic: "NUM", grades: [4], text: /abacus/i }),
  generate: ({ difficulty: d, rng, q }) => {
    const n = makeWhole(rng, byLevel(d, [2, 3, 3, 4, 4]), { zero: d >= 3 });
    const parts = placeParts(n);
    if (rng.chance(0.5)) {
      const nonZeroDigits = Number(
        parts
          .map((p) => p.digit)
          .filter((x) => x !== 0)
          .join(""),
      );
      return q.numeric({
        skill: "KNOWLEDGE_COMPREHENSION",
        type: "VISUAL_DIAGRAM",
        stem: "The table shows the number of beads on each rod of an abacus. What number does the abacus show?",
        stemData: {
          kind: "table",
          caption: "Beads on each rod of an abacus",
          headers: parts.map((p) => p.name.charAt(0).toUpperCase() + p.name.slice(1)),
          rows: [parts.map((p) => String(p.digit))],
        },
        answer: String(n),
        requireForm: "digits",
        wrongs: [
          ...(nonZeroDigits !== n
            ? [{ answer: String(nonZeroDigits), tag: "ZERO_PLACEHOLDER_ERROR" }]
            : []),
          { answer: String(parts.reduce((a, p) => a + p.digit, 0)), tag: "PLACE_VALUE_CONFUSION" },
        ],
        explanation: `Each rod stands for a place. ${breakdownText(n)} makes ${fmtInt(n)}.`,
        hints: [
          "Each rod is a place: the rod on the right is the ones.",
          "The number of beads on a rod is the digit for that place. An empty rod is a 0.",
        ],
      });
    }
    const target = rng.pick(parts.filter((p) => p.place >= 1));
    return q.numeric({
      skill: "KNOWLEDGE_COMPREHENSION",
      stem: `An abacus shows the number ${fmtInt(n)}. How many beads are on the ${target.name} rod?`,
      answer: String(target.digit),
      wrongs: parts
        .filter((p) => p.place !== target.place)
        .map((p) => ({ answer: String(p.digit), tag: "PLACE_VALUE_CONFUSION" })),
      explanation: `${fmtInt(n)} is ${breakdownText(n)}, so the ${target.name} rod holds ${target.digit} ${target.digit === 1 ? "bead" : "beads"}.`,
      hints: [
        "Each rod stands for a place: ones, tens, hundreds …",
        `Find the ${target.name} digit in the number.`,
      ],
    });
  },
});

export const wholeNumberTemplates = [
  numeralWords,
  placeValue,
  expandedNotation,
  compareWhole,
  orderWhole,
  countOnBack,
  numberSequences,
  roundWhole,
  ordinals,
  romanNumerals,
  primeNumbers,
  abacus,
];
