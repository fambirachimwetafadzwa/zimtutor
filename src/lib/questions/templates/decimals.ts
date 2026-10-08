import { Rational } from "../../marking/rational";
import { numberToWords } from "../../marking/words";
import {
  byLevel,
  defineTemplate,
  fmtDecimal,
  fmtInt,
  fractionWords,
  PLACE_NAMES,
  scoped,
  type Wrong,
} from "../kit";
import { gcd, roundToNearest, scaledText, truncateTo } from "../maths";
import type { Rng } from "../rng";
import type { Difficulty } from "../types";
import {
  DECIMAL_PLACE_NAMES,
  decimalFrom,
  decimalPlacesFor,
  decimalWholeDigitsFor,
  decimalWords,
  denomsFor,
  frac,
  makeDecimal,
  properFraction,
  type Decimal,
} from "./rational-common";
import { asWrongs } from "./common";

/**
 * Decimals and percentages: reading and writing, place value, expanded form, comparing, ordering,
 * rounding, links with fractions, grids, and percentages. Decimal places follow the printed
 * Content (G4 one · G5 two · G6 and G7 three).
 */

const DEC = /^(decimals|decimal-numbers)$/;
const PCT = /^percentages$/;

/** "0.07" for (7, −2); "700" for (7, 2). */
function placeValueText(digit: number, exponent: number): string {
  return exponent >= 0 ? String(digit * 10 ** exponent) : scaledText(digit, -exponent);
}

const placeUnit = (dp: number, count: number): string => {
  const name = DECIMAL_PLACE_NAMES[dp] ?? `10^-${dp}`;
  return count === 1 ? name.replace(/s$/, "") : name;
};

/** "four and seven hundredths", "seven tenths". */
function decimalAsFractionWords(d: Decimal): string {
  const fractionPart = d.scaled % 10 ** d.dp;
  const tail = `${numberToWords(fractionPart)} ${placeUnit(d.dp, fractionPart)}`;
  return d.whole === 0 ? tail : `${numberToWords(d.whole)} and ${tail}`;
}

// ── identify, read and write decimals ───────────────────────────────────────────────────────────

export const decimalNumeration = defineTemplate({
  id: "dec.numeration",
  description: "Identify, read and write decimals.",
  covers: (o) =>
    scoped(o, {
      topic: "NUM",
      strand: DEC,
      text: /write decimals|write decimal numbers|identify decimal|read\/sign decimal/i,
      not: /expand|form\b|notation/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const dp = Math.max(1, decimalPlacesFor(o.grade, d));
    const dec = makeDecimal(rng, dp, Math.max(d === 1 ? 0 : 1, decimalWholeDigitsFor(o.grade, d)));
    const t = o.text.toLowerCase();
    const shown = fmtDecimal(dec.text);
    const fractionInt = dec.scaled % 10 ** dp;

    if (/identify/.test(t)) {
      const den = 10 ** dp;
      const options = rng.sample(
        [
          { answer: `${dec.whole} ${fractionInt}/${den}` },
          { answer: frac(fractionInt, den) },
          { answer: `${dec.scaled}%` },
          { answer: String(dec.scaled) },
        ],
        3,
      );
      return q.mcq({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: "Which of these is a decimal number?",
        correct: shown,
        wrongs: options,
        keepEqualValues: true,
        explanation: `A decimal number has a decimal point that separates the whole numbers from the parts of a whole. ${shown} is a decimal number.`,
        hints: [
          "A decimal number is written with a point (or a comma) in it.",
          "Look for the choice with a decimal point between digits.",
        ],
      });
    }
    if (/read/.test(t)) {
      const correct = decimalWords(dec.text);
      const wrongText: Wrong[] = [];
      const digitsAfter = dec.text.split(".")[1]!;
      if (dp >= 2)
        wrongText.push({
          answer: `${numberToWords(dec.whole)} point ${numberToWords(Number(digitsAfter))}`,
          tag: "DECIMAL_PLACE_CONFUSION",
        });
      if (digitsAfter.includes("0"))
        wrongText.push({
          answer: decimalWords(`${dec.whole}.${digitsAfter.replace(/0/g, "")}`),
          tag: "DECIMAL_PLACE_CONFUSION",
        });
      wrongText.push({
        answer: decimalWords(`${dec.whole}.${[...digitsAfter].reverse().join("")}`),
      });
      wrongText.push({
        answer: numberToWords(Number(dec.text.replace(".", ""))),
        tag: "DECIMAL_PLACE_CONFUSION",
      });
      // a zero too many after the point, and a digit changed
      wrongText.push({
        answer: decimalWords(`${dec.whole}.0${digitsAfter}`),
        tag: "DECIMAL_PLACE_CONFUSION",
      });
      wrongText.push({
        answer: decimalWords(
          `${dec.whole}.${digitsAfter.slice(0, -1)}${(Number(digitsAfter.slice(-1)) % 9) + 1}`,
        ),
      });
      return q.mcq({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Which words show the decimal ${shown}?`,
        correct,
        wrongs: wrongText,
        explanation: `We read the whole part, then “point”, then each digit after the point one at a time: “${correct}”.`,
        hints: [
          "Read the whole-number part first, then say “point”.",
          "After the point, read each digit on its own, one after the other.",
          digitsAfter.includes("0")
            ? "A zero after the point is read as “zero”."
            : "Do not join the digits after the point into one big number.",
        ],
      });
    }
    // write
    const useFractionWords = dp >= 1 && rng.chance(0.5);
    const words = useFractionWords ? decimalAsFractionWords(dec) : decimalWords(dec.text);
    return q.numeric({
      skill: "KNOWLEDGE_COMPREHENSION",
      stem: `Write “${words}” as a decimal.`,
      answer: dec.text,
      requireForm: "digits",
      answerHint: "Type the decimal using digits and a decimal point.",
      wrongs: [
        { answer: `${dec.whole}.${fractionInt}`, tag: "DECIMAL_PLACE_CONFUSION" },
        { answer: String(dec.scaled), tag: "DECIMAL_PLACE_CONFUSION" },
        { answer: scaledText(dec.scaled, dp + 1), tag: "DECIMAL_PLACE_CONFUSION" },
        { answer: scaledText(dec.scaled, dp - 1), tag: "DECIMAL_PLACE_CONFUSION" },
      ],
      explanation: useFractionWords
        ? `“${words}”: the whole part is ${dec.whole} and the part after the point has ${dp} digit${dp === 1 ? "" : "s"} (${DECIMAL_PLACE_NAMES[dp]}), so it is ${dec.text}.`
        : `“${words}” is written ${dec.text}: the whole part, a decimal point, then the digits one by one.`,
      hints: useFractionWords
        ? [
            `The word “${DECIMAL_PLACE_NAMES[dp]}” tells how many digits come after the point.`,
            `There must be exactly ${dp} digit${dp === 1 ? "" : "s"} after the decimal point. If a digit is missing, fill it with 0.`,
          ]
        : [
            "Write the whole part first, then the decimal point.",
            "After the point, write each digit that is spoken, one after the other.",
          ],
    });
  },
});

// ── place value in decimals ─────────────────────────────────────────────────────────────────────

export const decimalPlaceValue = defineTemplate({
  id: "dec.place-value",
  description: "Place and value of a digit in a decimal.",
  covers: (o) => scoped(o, { topic: "NUM", strand: DEC, text: /place value|value of a digit/i }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const dp = Math.max(2, decimalPlacesFor(o.grade, d));
    let dec: Decimal;
    for (let tries = 0; ; tries++) {
      dec = makeDecimal(rng, dp, Math.max(1, decimalWholeDigitsFor(o.grade, d)));
      const digits = dec.text.replace(".", "");
      if (new Set(digits).size === digits.length || tries > 200) break;
    }
    const whole = String(dec.whole);
    const decimals = dec.text.split(".")[1]!;
    // every non-zero digit with its exponent: ones = 0, tens = 1, tenths = −1, hundredths = −2 …
    const digits: Array<{ digit: number; exponent: number }> = [
      ...[...whole].map((c, i) => ({ digit: Number(c), exponent: whole.length - 1 - i })),
      ...[...decimals].map((c, i) => ({ digit: Number(c), exponent: -(i + 1) })),
    ].filter((x) => x.digit > 0);
    const target = rng.pick(digits.filter((x) => x.exponent < 0));
    const shown = fmtDecimal(dec.text);
    const placeName =
      target.exponent < 0 ? DECIMAL_PLACE_NAMES[-target.exponent]! : PLACE_NAMES[target.exponent]!;
    const mode = d <= 2 ? "place" : rng.pick(["value", "value", "place"] as const);

    if (mode === "place") {
      const names = [
        "tenths",
        "hundredths",
        ...(o.grade >= 6 ? ["thousandths"] : []),
        "ones",
        "tens",
      ];
      const wrongs = names
        .filter((n) => n !== placeName)
        .slice(0, 4)
        .map((n) => ({ answer: n, tag: "DECIMAL_PLACE_CONFUSION" }));
      return q.mcq({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `In the decimal ${shown}, which place is the digit ${target.digit} in?`,
        correct: placeName,
        wrongs,
        explanation: `After the decimal point the places are tenths, hundredths, thousandths, in that order. The digit ${target.digit} in ${shown} is in the ${placeName} place.`,
        hints: [
          "Find the decimal point. The places to its right have special names that end in “ths”.",
          "Count the places from the decimal point to the digit: the first place, the second place …",
          "The first place after the point is the biggest of them.",
        ],
      });
    }
    const value = placeValueText(target.digit, target.exponent);
    return q.numeric({
      skill: "KNOWLEDGE_COMPREHENSION",
      stem: `What is the value of the digit ${target.digit} in ${shown}?`,
      answer: value,
      wrongs: [
        { answer: String(target.digit), tag: "DECIMAL_PLACE_CONFUSION" },
        {
          answer: placeValueText(target.digit, target.exponent + 1),
          tag: "DECIMAL_PLACE_CONFUSION",
        },
        {
          answer: placeValueText(target.digit, target.exponent - 1),
          tag: "DECIMAL_PLACE_CONFUSION",
        },
      ],
      explanation: `The digit ${target.digit} is in the ${placeName} place, so its value is ${target.digit} ${placeName}, which is ${value}.`,
      hints: [
        "Find the decimal point. The places to its right are tenths, hundredths, thousandths …",
        `The digit ${target.digit} is in the ${placeName} place. What is that many ${placeName}?`,
      ],
    });
  },
});

// ── expanded form ───────────────────────────────────────────────────────────────────────────────

export const decimalExpanded = defineTemplate({
  id: "dec.expanded",
  description: "Write decimals in expanded form.",
  covers: (o) => scoped(o, { topic: "NUM", strand: DEC, text: /expanded/i }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const places = Math.max(1, decimalPlacesFor(o.grade, d));
    const dec = makeDecimal(rng, places, Math.max(1, decimalWholeDigitsFor(o.grade, d)));
    const whole = String(dec.whole);
    const decimals = dec.text.split(".")[1]!;
    const terms = [
      ...[...whole].map((c, i) => ({ digit: Number(c), exponent: whole.length - 1 - i })),
      ...[...decimals].map((c, i) => ({ digit: Number(c), exponent: -(i + 1) })),
    ].filter((x) => x.digit > 0);
    const termTexts = terms.map((t) => placeValueText(t.digit, t.exponent));
    const expandedText = termTexts.map(fmtDecimal).join(" + ");
    const keyTerms = termTexts.map((t) => (t.includes(".") ? t : Number(t)));
    const digitSum = terms.map((t) => t.digit).join(" + ");
    const shiftDown = terms
      .map((t) => placeValueText(t.digit, t.exponent - 1))
      .map(fmtDecimal)
      .join(" + ");
    const shiftUp = terms
      .map((t) => placeValueText(t.digit, t.exponent + 1))
      .map(fmtDecimal)
      .join(" + ");
    const hints = [
      "Each digit is worth its value in its own place: ones, then tenths, hundredths, thousandths …",
      "Write one term for each digit that is not zero.",
    ];
    // a distractor must not use more decimal places than the grade works with
    const allowedPlaces = o.grade <= 4 ? 1 : o.grade === 5 ? 2 : 3;
    const shiftDownAllowed = terms.every((t) => -(t.exponent - 1) <= allowedPlaces);
    if (d <= 2 || terms.length < 2) {
      return q.mcq({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Which of these is ${fmtDecimal(dec.text)} in expanded form?`,
        correct: expandedText,
        wrongs: [
          { answer: digitSum, tag: "DECIMAL_PLACE_CONFUSION" },
          ...(shiftDownAllowed ? [{ answer: shiftDown, tag: "DECIMAL_PLACE_CONFUSION" }] : []),
          { answer: shiftUp, tag: "DECIMAL_PLACE_CONFUSION" },
        ],
        explanation: `${dec.text} is ${terms.map((t) => `${t.digit} ${t.exponent < 0 ? DECIMAL_PLACE_NAMES[-t.exponent] : PLACE_NAMES[t.exponent]}`).join(" + ")}, so in expanded form it is ${expandedText}.`,
        hints,
      });
    }
    return q.expression({
      skill: "KNOWLEDGE_COMPREHENSION",
      stem: `Write ${fmtDecimal(dec.text)} in expanded form.`,
      expression: dec.text,
      kind: "expanded",
      terms: keyTerms,
      answerText: expandedText,
      answerHint: "Write a sum with one term for each digit that is not zero.",
      wrongs: [
        { answer: digitSum, tag: "DECIMAL_PLACE_CONFUSION" },
        ...(shiftDownAllowed ? [{ answer: shiftDown, tag: "DECIMAL_PLACE_CONFUSION" }] : []),
        { answer: shiftUp, tag: "DECIMAL_PLACE_CONFUSION" },
      ],
      explanation: `${dec.text} in expanded form is ${expandedText}.`,
      solutionSteps: terms.map(
        (t) =>
          `${t.digit} ${t.exponent < 0 ? DECIMAL_PLACE_NAMES[-t.exponent] : PLACE_NAMES[t.exponent]} = ${placeValueText(t.digit, t.exponent)}`,
      ),
      hints,
    });
  },
});

// ── comparing and ordering decimals ─────────────────────────────────────────────────────────────

type Sign = "<" | "=" | ">";
const signOf = (value: number): Sign => (value < 0 ? "<" : value > 0 ? ">" : "=");

/** Compare two decimals exactly (as scaled integers at a common number of places). */
function compareDecimals(a: Decimal, b: Decimal): number {
  const dp = Math.max(a.dp, b.dp);
  return a.scaled * 10 ** (dp - a.dp) - b.scaled * 10 ** (dp - b.dp);
}

/** The digits after the point, read as a whole number (what a learner who ignores the place sees). */
const afterPointAsWhole = (x: Decimal): number => Number(x.text.split(".")[1]);

function decimalPair(
  rng: Rng,
  grade: number,
  difficulty: Difficulty,
): { a: Decimal; b: Decimal; kind: "whole" | "tenths" | "length" | "equal" } {
  const maxDp = grade <= 4 ? 1 : grade === 5 ? 2 : 3;
  const wholeDigits = Math.max(1, decimalWholeDigitsFor(grade, difficulty));
  const kind =
    difficulty === 1
      ? "whole"
      : difficulty === 2 || maxDp === 1
        ? "tenths"
        : difficulty >= 4 && rng.chance(0.3)
          ? "equal"
          : "length";
  for (let tries = 0; tries < 300; tries++) {
    const whole = rng.digits(wholeDigits);
    if (kind === "whole") {
      const a = makeDecimal(rng, 1, wholeDigits);
      const b = makeDecimal(rng, maxDp === 1 ? 1 : rng.int(1, maxDp), wholeDigits);
      if (compareDecimals(a, b) !== 0 && a.whole !== b.whole) return { a, b, kind };
    } else if (kind === "tenths") {
      const dp = maxDp === 1 ? 1 : rng.int(1, 2);
      const a = decimalFrom(
        whole * 10 ** dp + rng.int(1, 9) * 10 ** (dp - 1) + (dp > 1 ? rng.int(1, 9) : 0),
        dp,
      );
      const b = decimalFrom(
        whole * 10 ** dp + rng.int(1, 9) * 10 ** (dp - 1) + (dp > 1 ? rng.int(1, 9) : 0),
        dp,
      );
      if (compareDecimals(a, b) !== 0 && a.text.split(".")[1]![0] !== b.text.split(".")[1]![0])
        return { a, b, kind };
    } else if (kind === "length") {
      // the number with MORE digits after the point is not necessarily bigger
      const dpA = rng.int(1, maxDp - 1);
      const dpB = rng.int(dpA + 1, maxDp);
      const a = makeDecimal(rng, dpA, wholeDigits);
      const b = decimalFrom(a.whole * 10 ** dpB + rng.int(1, 10 ** dpB - 1), dpB);
      if (b.scaled % 10 !== 0 && compareDecimals(a, b) !== 0) {
        return rng.chance(0.5) ? { a, b, kind } : { a: b, b: a, kind };
      }
    } else {
      const dpA = rng.int(1, maxDp - 1);
      const a = makeDecimal(rng, dpA, wholeDigits);
      const dpB = rng.int(dpA + 1, maxDp);
      const b = decimalFrom(a.scaled * 10 ** (dpB - dpA), dpB);
      return rng.chance(0.5) ? { a, b, kind } : { a: b, b: a, kind };
    }
  }
  throw new Error("decimalPair: failed");
}

export const compareDecimalsTemplate = defineTemplate({
  id: "dec.compare",
  description: "Compare decimals, including the trap of the longer decimal that is smaller.",
  covers: (o) => scoped(o, { topic: "NUM", strand: DEC, text: /compare/i }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const { a, b, kind } = decimalPair(rng, o.grade, d);
    const answer = signOf(compareDecimals(a, b));
    // a learner who reads the digits after the point as whole numbers
    const naive: Sign =
      a.whole === b.whole ? signOf(afterPointAsWhole(a) - afterPointAsWhole(b)) : answer;
    // a learner who thinks more digits means a bigger number
    const longer: Sign = a.dp === b.dp ? answer : a.dp > b.dp ? ">" : "<";
    const left = fmtDecimal(a.text);
    const right = fmtDecimal(b.text);
    return q.mcq({
      skill: kind === "whole" || kind === "tenths" ? "KNOWLEDGE_COMPREHENSION" : "ANALYSIS",
      stem: `Which sign makes the statement true?  ${left}  ___  ${right}`,
      correct: answer,
      wrongs: (["<", "=", ">"] as const)
        .filter((s) => s !== answer)
        .map((s) => ({
          answer: s,
          ...(s === naive || s === longer ? { tag: "DECIMAL_PLACE_CONFUSION" } : {}),
        })),
      keepOrder: true,
      explanation:
        kind === "equal"
          ? `${left} and ${right} are equal: a zero at the end of a decimal does not change its value.`
          : kind === "length"
            ? `Write both with the same number of decimal places: ${scaledText(a.scaled * 10 ** (Math.max(a.dp, b.dp) - a.dp), Math.max(a.dp, b.dp))} and ${scaledText(b.scaled * 10 ** (Math.max(a.dp, b.dp) - b.dp), Math.max(a.dp, b.dp))}. Now compare place by place: ${left} ${answer} ${right}.`
            : `Compare the whole parts first, then the tenths, then the hundredths. ${left} ${answer} ${right}.`,
      hints:
        kind === "length" || kind === "equal"
          ? [
              "Do not count the digits to decide: 0.5 and 0.50 are the same size.",
              "Give both numbers the same number of decimal places by adding zeros at the end.",
              "Then compare them place by place, starting at the left.",
            ]
          : [
              "Compare the whole-number parts first.",
              "If they are the same, compare the tenths, then the hundredths.",
            ],
    });
  },
});

export const orderDecimals = defineTemplate({
  id: "dec.order",
  description: "Arrange decimals in ascending or descending order.",
  covers: (o) => scoped(o, { topic: "NUM", strand: DEC, text: /arrange/i }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const maxDp = o.grade <= 4 ? 1 : o.grade === 5 ? 2 : 3;
    const count = byLevel(d, [3, 3, 4, 4, 5]);
    const wholeDigits = Math.max(1, decimalWholeDigitsFor(o.grade, d));
    const whole = rng.digits(wholeDigits);
    let items: Decimal[] = [];
    for (let tries = 0; tries < 300; tries++) {
      items = Array.from({ length: count }, () => {
        const dp = maxDp === 1 ? 1 : rng.int(1, maxDp);
        const sameWhole = d >= 3;
        return decimalFrom(
          (sameWhole ? whole : rng.digits(wholeDigits)) * 10 ** dp +
            rng.int(10 ** (dp - 1), 10 ** dp - 1),
          dp,
        );
      }).filter((x) => x.scaled % 10 !== 0);
      const distinct = new Set(
        items.map((x) => new Rational(BigInt(x.scaled), 10n ** BigInt(x.dp)).toString()),
      );
      if (items.length === count && distinct.size === count) break;
      items = [];
    }
    if (items.length === 0) throw new Error("orderDecimals: no distinct set");
    const ascending = rng.chance(0.5);
    const sorted = [...items].sort(compareDecimals);
    const target = (ascending ? sorted : [...sorted].reverse()).map((x) => fmtDecimal(x.text));
    const naiveSorted = [...items]
      .sort((x, y) => x.whole - y.whole || afterPointAsWhole(x) - afterPointAsWhole(y))
      .map((x) => fmtDecimal(x.text));
    const naive = ascending ? naiveSorted : [...naiveSorted].reverse();
    return q.ordering({
      skill: "ANALYSIS",
      stem: `Arrange these decimals in ${ascending ? "ascending" : "descending"} order (from the ${ascending ? "smallest to the largest" : "largest to the smallest"}): ${items.map((x) => fmtDecimal(x.text)).join(", ")}.`,
      sequence: target,
      wrongOrders:
        naive.join("|") !== target.join("|")
          ? [{ order: naive, tag: "DECIMAL_PLACE_CONFUSION" }]
          : [],
      explanation: `Give every number the same number of decimal places, then compare. In ${ascending ? "ascending" : "descending"} order: ${target.join(", ")}.`,
      hints: [
        "Do not decide by the number of digits: 0.5 is bigger than 0.45.",
        "Write every decimal with the same number of decimal places (add zeros at the end).",
        `Compare whole parts, then tenths, then hundredths. Find the ${ascending ? "smallest" : "largest"} first.`,
      ],
    });
  },
});

// ── rounding decimals ───────────────────────────────────────────────────────────────────────────

export const roundDecimals = defineTemplate({
  id: "dec.round",
  description: "Round decimals to the nearest whole number, tenth or hundredth.",
  covers: (o) => scoped(o, { topic: "NUM", strand: DEC, text: /round/i }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const maxDp = o.grade <= 4 ? 1 : o.grade === 5 ? 2 : 3;
    const targets = o.grade <= 4 ? [0] : o.grade === 5 ? [0, 1] : [0, 1, 2];
    const target = targets[rng.int(0, Math.min(targets.length - 1, Math.max(0, d - 2)))]!;
    const dp = Math.min(maxDp, target + 1 + (d >= 4 ? 1 : 0));
    const wholeDigits = Math.max(1, decimalWholeDigitsFor(o.grade, d));
    // digits after the point: kept places, then the deciding digit, then the rest
    const decider = d >= 3 && rng.chance(0.35) ? 5 : rng.int(0, 9);
    const digits: number[] = [];
    for (let i = 0; i < target; i++) digits.push(rng.int(0, 9));
    digits.push(decider);
    for (let i = target + 1; i < dp; i++)
      digits.push(d >= 4 && rng.chance(0.3) ? 9 : rng.int(0, 9));
    if (digits[dp - 1] === 0) digits[dp - 1] = rng.int(1, 9); // the last digit is never 0
    const whole = rng.int(10 ** (wholeDigits - 1), 10 ** wholeDigits - 1);
    const scaled = whole * 10 ** dp + Number(digits.join(""));
    const dec = decimalFrom(scaled, dp);
    const decidingDigit = digits[target]!;
    const unit = 10 ** (dp - target);
    const toText = (value: number) => scaledText(value / unit, target);
    const answer = toText(roundToNearest(scaled, unit));
    const down = toText(truncateTo(scaled, unit));
    const up = toText(truncateTo(scaled, unit) + unit);
    const roundUp = decidingDigit >= 5;
    const placeText = target === 0 ? "whole number" : target === 1 ? "tenth" : "hundredth";
    const otherPlaces = (places: number): string => {
      const u = 10 ** (dp - places);
      return scaledText(roundToNearest(scaled, u) / u, places);
    };
    const wrongs: Wrong[] = [
      { answer: roundUp ? down : up, tag: "ROUNDING_DIRECTION_ERROR" },
      ...(target > 0 ? [{ answer: otherPlaces(target - 1), tag: "DECIMAL_PLACE_CONFUSION" }] : []),
      ...(target + 1 < dp
        ? [{ answer: otherPlaces(target + 1), tag: "DECIMAL_PLACE_CONFUSION" }]
        : []),
    ];
    return q.numeric({
      skill: "APPLICATION",
      stem: `Round ${fmtDecimal(dec.text)} to the nearest ${placeText}.`,
      answer,
      wrongs,
      explanation: `To round to the nearest ${placeText}, look at the digit just after that place. It is ${decidingDigit}, which is ${roundUp ? "5 or more, so round UP" : "less than 5, so round DOWN"}. The answer is ${answer}.`,
      hints: [
        target === 0
          ? "The whole-number place is the digit just before the decimal point."
          : `Find the ${placeText}s place: it is digit number ${target} after the decimal point.`,
        "Look at the digit just to the right of it. If it is 5 or more, round up. If it is less than 5, stay where you are.",
        `The digit to look at is ${decidingDigit}.`,
      ],
    });
  },
});

// ── fractions and decimals ──────────────────────────────────────────────────────────────────────

/** Denominators below 100 whose fractions give decimals with at most three places. */
const THREE_PLACE_DENOMS = [2, 4, 5, 8, 10, 20, 25, 40, 50, 100];

export const fractionDecimalLink = defineTemplate({
  id: "dec.fraction-link",
  description: "Change fractions with denominators 10 and 100, and other fractions, to decimals.",
  covers: (o) =>
    scoped(o, {
      topic: "NUM",
      text: /denominators 10 and 100 to decimals|proper fractions to decimals|mixed numbers as decimals/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    if (/denominators 10 and 100/i.test(o.text)) {
      const den = d >= 4 ? 100 : 10;
      const dp = den === 10 ? 1 : 2;
      const num = den === 10 ? rng.int(1, 9) : rng.pick([rng.int(1, 9), rng.int(10, 99)]);
      const text = scaledText(num, dp);
      if (rng.chance(0.5)) {
        return q.numeric({
          skill: "KNOWLEDGE_COMPREHENSION",
          stem: `Write ${frac(num, den)} as a decimal.`,
          answer: text,
          requireForm: "digits",
          wrongs: [
            { answer: scaledText(num, dp === 1 ? 2 : 1), tag: "DECIMAL_PLACE_CONFUSION" },
            { answer: String(num), tag: "DECIMAL_PLACE_CONFUSION" },
            { answer: scaledText(num, dp + 1), tag: "DECIMAL_PLACE_CONFUSION" },
          ],
          explanation: `${frac(num, den)} means ${num} out of ${den}. A denominator of ${den} means ${dp} digit${dp === 1 ? "" : "s"} after the decimal point: ${text}.`,
          hints: [
            den === 10
              ? "Tenths are the first place after the decimal point."
              : "Hundredths are the second place after the decimal point.",
            `The denominator ${den} tells how many digits go after the point.`,
          ],
        });
      }
      return q.fraction({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Write ${text} as a fraction.`,
        value: frac(num, den),
        lowestTerms: false,
        answerHint: "Write a fraction using a slash (/).",
        wrongs: [
          { answer: frac(num, den === 10 ? 100 : 10), tag: "DECIMAL_PLACE_CONFUSION" },
          { answer: frac(den, num), tag: "FRACTION_NOTATION_CONFUSION" },
        ],
        explanation: `${text} has ${dp} digit${dp === 1 ? "" : "s"} after the point, so the denominator is ${den}: ${text} = ${frac(num, den)}.`,
        hints: [
          "Count the digits after the decimal point.",
          "One digit after the point means tenths (denominator 10), two digits mean hundredths (denominator 100).",
        ],
      });
    }
    if (/mixed numbers as decimals/i.test(o.text)) {
      const den = rng.pick([2, 4, 5, 8, 10]);
      const [num] = properFraction(rng, den, { coprime: true });
      const whole = rng.int(1, byLevel(d, [2, 4, 6, 9, 12]));
      const value = new Rational(BigInt(whole * den + num), BigInt(den));
      const text = value.toDecimalString()!;
      const fractionDigits = text.split(".")[1]!;
      return q.numeric({
        skill: "APPLICATION",
        stem: `Write the mixed number ${whole} ${frac(num, den)} as a decimal.`,
        answer: text,
        requireForm: "digits",
        wrongs: [
          { answer: `${whole}.${num}${den}`, tag: "DECIMAL_PLACE_CONFUSION" },
          { answer: `${whole}.${num}`, tag: "DECIMAL_PLACE_CONFUSION" },
          { answer: `${whole}.0${fractionDigits}`, tag: "DECIMAL_PLACE_CONFUSION" },
        ],
        explanation: `Keep the whole number ${whole}. Change ${frac(num, den)} to a decimal by dividing ${num} by ${den}: ${num} ÷ ${den} = 0.${fractionDigits}. So ${whole} ${frac(num, den)} = ${text}.`,
        hints: [
          "The whole number stays as it is, in front of the decimal point.",
          `Change the fraction part into a decimal: divide the top number by the bottom number.`,
          `Or make the denominator 10, 100 or 1 000 by multiplying the top and the bottom by the same number.`,
        ],
      });
    }
    // proper fractions to decimals (Grade 7)
    const allowed = denomsFor(o.grade, d);
    const pool = THREE_PLACE_DENOMS.filter((x) => allowed.includes(x));
    const den = rng.pick(pool.length > 0 ? pool : [2, 4, 5, 10]);
    const [num] = properFraction(rng, den);
    const value = new Rational(BigInt(num), BigInt(den));
    const text = value.toDecimalString()!;
    const g = gcd(num, den);
    return q.numeric({
      skill: "APPLICATION",
      stem: `Write ${frac(num, den)} as a decimal.`,
      answer: text,
      requireForm: "digits",
      wrongs: [
        { answer: `0.${num}${den}`, tag: "DECIMAL_PLACE_CONFUSION" },
        { answer: `${num}.${den}`, tag: "DECIMAL_PLACE_CONFUSION" },
        { answer: `0.${den}`, tag: "DECIMAL_PLACE_CONFUSION" },
      ],
      explanation: `${frac(num, den)} means ${num} ÷ ${den}. ${num} ÷ ${den} = ${text}.${g > 1 ? ` (${frac(num / g, den / g)} in lowest terms.)` : ""}`,
      hints: [
        "A fraction is a division: the top number divided by the bottom number.",
        "Or write an equivalent fraction with a denominator of 10, 100 or 1 000 and read the decimal.",
      ],
    });
  },
});

// ── decimals in a 10 × 10 grid ──────────────────────────────────────────────────────────────────

export const decimalDiagram = defineTemplate({
  id: "dec.diagram",
  description: "Read a decimal from a 100-square grid.",
  covers: (o) => scoped(o, { topic: "NUM", strand: DEC, text: /diagram/i }),
  generate: ({ difficulty: d, rng, q }) => {
    const shaded = d <= 2 ? rng.int(1, 9) * 10 : rng.int(1, 99);
    const text = scaledText(shaded, 2);
    const trimmed = text.replace(/0$/, "");
    return q.numeric({
      skill: "KNOWLEDGE_COMPREHENSION",
      type: "VISUAL_DIAGRAM",
      stem: "The whole grid is 1. What decimal is shaded?",
      stemData: { kind: "grid", rows: 10, cols: 10, shaded },
      answer: trimmed,
      requireForm: "digits",
      wrongs: [
        { answer: String(shaded), tag: "DECIMAL_PLACE_CONFUSION" },
        { answer: scaledText(shaded, 3), tag: "DECIMAL_PLACE_CONFUSION" },
        { answer: scaledText(shaded, 1), tag: "DECIMAL_PLACE_CONFUSION" },
      ],
      explanation: `The grid has 100 squares and ${shaded} are shaded, so ${shaded} hundredths are shaded. As a decimal that is ${trimmed}.`,
      hints: [
        "Count the squares in the whole grid. That is the denominator.",
        "Count the shaded squares. That many hundredths are shaded.",
        "Hundredths are the second place after the decimal point.",
      ],
    });
  },
});

// ── percentages ─────────────────────────────────────────────────────────────────────────────────

export const percentNumeration = defineTemplate({
  id: "pct.numeration",
  description: "Read and write fractions with denominator 100 and percentages.",
  covers: (o) =>
    scoped(o, {
      topic: "NUM",
      strand: PCT,
      text: /(?:read|write) fractions with a denominator|identify percentages|read percentages|write percentages/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const t = o.text.toLowerCase();
    const n = d <= 2 ? rng.int(1, 9) * 10 + rng.pick([0, 5]) : rng.int(1, 99);
    const words = numberToWords(n);
    if (/fractions with a denominator/.test(t) && /read/.test(t)) {
      return q.mcq({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Which words show the fraction ${frac(n, 100)}?`,
        correct: `${words} hundredths`.replace("one hundredths", "one hundredth"),
        wrongs: [
          { answer: `${words} tenths`, tag: "FRACTION_NOTATION_CONFUSION" },
          { answer: `one hundred and ${words}` },
          { answer: `${numberToWords(Math.max(1, n - 1))} hundredths` },
        ],
        explanation: `The denominator 100 means hundredths, so ${frac(n, 100)} is read “${words} hundredths”.`,
        hints: [
          "The bottom number names the kind of part.",
          "A whole cut into 100 equal parts gives hundredths.",
        ],
      });
    }
    if (/fractions with a denominator/.test(t)) {
      if (rng.chance(0.5))
        return q.fraction({
          skill: "KNOWLEDGE_COMPREHENSION",
          stem: `Write “${words} hundredths” as a fraction.`,
          value: frac(n, 100),
          lowestTerms: false,
          answerHint: "Write a fraction using a slash (/).",
          wrongs: [
            { answer: frac(100, n), tag: "FRACTION_NOTATION_CONFUSION" },
            { answer: frac(n, 10) },
          ],
          explanation: `“${words} hundredths” is ${n} out of 100 equal parts: ${frac(n, 100)}.`,
          hints: [
            "The word “hundredths” tells you the bottom number.",
            "The number in front of it tells you the top number.",
          ],
        });
      return q.text({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Write ${n}% as a fraction with a denominator of 100.`,
        accepted: [frac(n, 100)],
        answerHint: "Write a fraction using a slash (/), with 100 at the bottom.",
        wrongs: [
          { answer: frac(100, n), tag: "FRACTION_NOTATION_CONFUSION" },
          { answer: frac(n, 10), tag: "PERCENT_CONVERSION_ERROR" },
        ],
        explanation: `Percent means “out of 100”, so ${n}% is ${frac(n, 100)}.`,
        hints: [
          "The word percent means “out of 100”.",
          "Put the percentage number on top and 100 at the bottom.",
        ],
      });
    }
    if (/identify/.test(t)) {
      return q.mcq({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: "Which of these is written as a percentage?",
        keepEqualValues: true,
        correct: `${n}%`,
        wrongs: [{ answer: scaledText(n, 2) }, { answer: frac(n, 100) }, { answer: String(n) }],
        explanation: `A percentage is written with the percent sign %. ${n}% means ${n} out of every 100.`,
        hints: [
          "A percentage is written with a special sign after the number.",
          "Look for the % sign.",
        ],
      });
    }
    if (/read/.test(t)) {
      return q.mcq({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Which words show ${n}%?`,
        correct: `${words} percent`,
        wrongs: [
          { answer: `${words} tenths`, tag: "PERCENT_CONVERSION_ERROR" },
          { answer: `${numberToWords(n * 10)} percent` },
          { answer: `${numberToWords(Math.max(1, n - 1))} percent` },
        ],
        explanation: `The sign % is read “percent”, so ${n}% is “${words} percent”.`,
        hints: ["The sign % is read “percent”.", "Say the number first, then the word percent."],
      });
    }
    return q.numeric({
      skill: "KNOWLEDGE_COMPREHENSION",
      stem: `Write “${words} percent” using numerals and the percent sign.`,
      answer: `${n}%`,
      requireForm: "percent",
      answerHint: "Type the number and the % sign.",
      wrongs: [
        { answer: scaledText(n, 2), tag: "PERCENT_CONVERSION_ERROR" },
        { answer: scaledText(n, 1), tag: "PERCENT_CONVERSION_ERROR" },
      ],
      explanation: `“${words} percent” is written ${n}%.`,
      hints: ["Write the number in digits.", "Then write the percent sign % after it."],
    });
  },
});

/** Denominators whose fractions can be written as a whole-number percentage, per grade. */
const PERCENT_DENOMS: Record<number, readonly number[]> = {
  4: [2, 4, 5, 10],
  5: [2, 4, 5, 10, 20],
  6: [2, 4, 5, 10, 20, 25, 50],
  7: [2, 4, 5, 10, 20, 25, 50, 100],
};

export const percentConversion = defineTemplate({
  id: "pct.convert",
  description: "Change fractions to percentages and percentages to fractions.",
  covers: (o) =>
    scoped(o, {
      topic: "NUM",
      strand: PCT,
      text: /express halves|fractions as percentages|relationships between percentages/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const dens = PERCENT_DENOMS[o.grade] ?? PERCENT_DENOMS[5]!;
    const pool = d <= 2 ? dens.filter((x) => x <= 10) : dens;
    const den = rng.pick(pool.length > 0 ? pool : dens);
    const [num] = properFraction(rng, den);
    const percent = (num * 100) / den;
    const matching = /relationships/i.test(o.text);
    if (matching) {
      const items = new Map<string, string>();
      for (let tries = 0; tries < 100 && items.size < 4; tries++) {
        const dn = rng.pick(dens);
        const [nm] = properFraction(rng, dn, { coprime: true });
        items.set(frac(nm, dn), `${(nm * 100) / dn}%`);
      }
      if (new Set(items.values()).size < 4) throw new Error("pct.convert: matching set too small");
      return q.matching({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: "Match each fraction to the same amount written as a percentage.",
        pairs: Object.fromEntries(items),
        explanation: `Percent means out of 100. ${[...items].map(([k, v]) => `${k} = ${v}`).join(", ")}.`,
        hints: [
          "Make the denominator 100: what do you multiply the bottom number by to get 100?",
          "Multiply the top number by the same number. That is the percentage.",
        ],
      });
    }
    const toFraction = /vice versa/i.test(o.text) && rng.chance(0.4);
    if (toFraction) {
      const g = gcd(percent, 100);
      return q.fraction({
        skill: "APPLICATION",
        stem: `Write ${percent}% as a fraction in its lowest terms.`,
        value: frac(percent / g, 100 / g),
        lowestTerms: true,
        answerHint: "Write a fraction using a slash (/).",
        wrongs: [
          { answer: frac(percent, 10), tag: "PERCENT_CONVERSION_ERROR" },
          { answer: frac(100, percent), tag: "PERCENT_CONVERSION_ERROR" },
        ],
        explanation: `${percent}% = ${frac(percent, 100)}. Divide the top and the bottom by ${g}: ${frac(percent / g, 100 / g)}.`,
        hints: [
          "Percent means “out of 100”. Write the percentage over 100.",
          "Then reduce the fraction to its lowest terms.",
        ],
      });
    }
    const factor = 100 / den;
    return q.numeric({
      skill: "APPLICATION",
      stem: `Write ${frac(num, den)} as a percentage.`,
      answer: `${percent}%`,
      requireForm: "percent",
      answerHint: "Type the number and the % sign.",
      wrongs: [
        { answer: String(Number(`${num}${den}`)), tag: "PERCENT_CONVERSION_ERROR" },
        { answer: String(den), tag: "PERCENT_CONVERSION_ERROR" },
        { answer: String(num * 10), tag: "PERCENT_CONVERSION_ERROR" },
        { answer: String(percent / 10), tag: "PERCENT_CONVERSION_ERROR" },
      ],
      explanation: `Make the denominator 100: ${den} × ${factor} = 100, so multiply the top number by ${factor} too: ${num} × ${factor} = ${percent}. So ${frac(num, den)} = ${percent}%.`,
      hints: [
        "Percent means out of 100. We need a denominator of 100.",
        `What do you multiply ${den} by to get 100?`,
        "Multiply the top number by the same number.",
      ],
    });
  },
});

export const percentGrid = defineTemplate({
  id: "pct.grid",
  description: "Read and show percentages on a 100-square grid.",
  covers: (o) => scoped(o, { topic: "NUM", strand: PCT, text: /grid|diagram/i }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const shaded = d <= 2 ? rng.int(1, 9) * 10 : rng.pick([rng.int(1, 99), rng.int(1, 9) * 5 * 2]);
    const represent = o.grade >= 6 && rng.chance(0.5);
    if (represent) {
      return q.numeric({
        skill: "APPLICATION",
        type: "VISUAL_DIAGRAM",
        stem: `A grid has 100 equal squares. How many squares must be shaded to show ${shaded}%?`,
        stemData: { kind: "grid", rows: 10, cols: 10, shaded: 0 },
        answer: String(shaded),
        wrongs: [
          { answer: String(100 - shaded), tag: "PART_WHOLE_CONFUSION" },
          { answer: String(shaded * 10), tag: "PERCENT_CONVERSION_ERROR" },
        ],
        explanation: `Percent means out of 100. ${shaded}% of 100 squares is ${shaded} squares.`,
        hints: [
          "Percent means “out of 100”.",
          "The grid has exactly 100 squares, so each square is 1%.",
        ],
      });
    }
    return q.numeric({
      skill: "KNOWLEDGE_COMPREHENSION",
      type: "VISUAL_DIAGRAM",
      stem: "The grid has 100 equal squares. What percentage of the grid is shaded?",
      stemData: { kind: "grid", rows: 10, cols: 10, shaded },
      answer: `${shaded}%`,
      requireForm: "percent",
      answerHint: "Type the number and the % sign.",
      wrongs: [
        { answer: String(100 - shaded), tag: "PART_WHOLE_CONFUSION" },
        { answer: String(shaded / 10), tag: "PERCENT_CONVERSION_ERROR" },
      ],
      explanation: `${shaded} out of the 100 squares are shaded, so ${shaded}% of the grid is shaded.`,
      hints: [
        "Count the shaded squares.",
        "The whole grid has 100 squares, so the number of shaded squares is the percentage.",
      ],
    });
  },
});

const PERCENT_CONTEXTS = [
  {
    local: false,
    text: (name: string, p: number, t: number) =>
      `${name} got ${p} out of ${t} marks in a Mathematics test. What percentage did ${name} get?`,
  },
  {
    local: false,
    text: (_: string, p: number, t: number) =>
      `In a class of ${t} learners, ${p} walk to school. What percentage of the learners walk to school?`,
  },
  {
    local: true,
    text: (_: string, p: number, t: number) =>
      `A farmer has ${t} chickens. ${p} of them are hens. What percentage of the chickens are hens?`,
  },
  {
    local: true,
    text: (_: string, p: number, t: number) =>
      `A tuck shop had ${t} loaves of bread. ${p} were sold before break. What percentage of the loaves were sold?`,
  },
] as const;

export const percentOfAnother = defineTemplate({
  id: "pct.of-another",
  description: "Write one quantity as a percentage of another.",
  covers: (o) => scoped(o, { topic: "NUM", strand: PCT, text: /percentage of another/i }),
  generate: ({ difficulty: d, rng, q, local }) => {
    const totals = byLevel(d, [
      [10, 20, 50, 100],
      [20, 25, 40, 50, 100],
      [20, 25, 40, 50, 80, 100, 200],
      [25, 40, 80, 120, 200, 250, 400],
      [60, 75, 120, 150, 250, 300, 400, 500],
    ]);
    let total = 0;
    let part = 0;
    for (let tries = 0; tries < 500; tries++) {
      total = rng.pick(totals);
      part = rng.int(1, total - 1);
      if ((part * 100) % total === 0 && (d >= 3 || ((part * 100) / total) % 5 === 0)) break;
    }
    const percent = (part * 100) / total;
    if ((part * 100) % total !== 0) throw new Error("pct.of-another: no whole percentage found");
    const name = rng.pick(["Tendai", "Rudo", "Farai", "Chipo", "Nyasha"]);
    const ctx = rng.pick(PERCENT_CONTEXTS.filter((c) => local || !c.local));
    return q.numeric({
      skill: "APPLICATION",
      type: "WORD_PROBLEM",
      stem: ctx.text(name, part, total),
      answer: `${percent}%`,
      requireForm: "percent",
      answerHint: "Type the number and the % sign.",
      wrongs: [
        {
          answer:
            String(Math.round((total * 100) / part)) === String(percent)
              ? String(percent + 10)
              : String(Math.round((total * 100) / part)),
          tag: "PERCENT_CONVERSION_ERROR",
        },
        {
          answer: scaledText(percent, 2).replace(/0+$/, "").replace(/\.$/, ""),
          tag: "PERCENT_CONVERSION_ERROR",
        },
        { answer: String(100 - percent) },
      ],
      usesLocalContext: local && ctx.local,
      explanation: `Write the amount as a fraction of the whole: ${frac(part, total)}. Then change it to a percentage: ${frac(part, total)} = ${percent}/100 = ${percent}%.`,
      hints: [
        "Write the part over the whole as a fraction.",
        "Change the fraction to one with the denominator 100.",
        100 % total === 0
          ? `What do you multiply ${total} by to get 100? Multiply the part by the same number.`
          : `Divide ${part} by ${total}, then multiply the answer by 100.`,
      ],
    });
  },
});

export const percentCompare = defineTemplate({
  id: "pct.compare",
  description: "Compare percentages with each other and with fractions.",
  covers: (o) => scoped(o, { topic: "NUM", strand: PCT, text: /compare percentages/i }),
  generate: ({ difficulty: d, rng, q }) => {
    const mode = d <= 2 ? "percents" : rng.pick(["percents", "fraction", "fraction"] as const);
    if (mode === "percents") {
      const a = rng.int(5, 95);
      let b = rng.int(5, 95);
      while (b === a) b = rng.int(5, 95);
      const answer: Sign = a < b ? "<" : ">";
      return q.mcq({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Which sign makes the statement true?  ${a}%  ___  ${b}%`,
        correct: answer,
        wrongs: (["<", "=", ">"] as const).filter((s) => s !== answer).map((s) => ({ answer: s })),
        keepOrder: true,
        explanation: `Both are out of 100, so the bigger number is the bigger percentage: ${a}% ${answer} ${b}%.`,
        hints: ["Both percentages are out of 100.", "Compare the two numbers."],
      });
    }
    const den = rng.pick([2, 4, 5, 10, 20]);
    const [num] = properFraction(rng, den);
    const fracPercent = (num * 100) / den;
    let p = rng.int(5, 95);
    while (p === fracPercent) p = rng.int(5, 95);
    const answer: Sign = fracPercent < p ? "<" : ">";
    return q.mcq({
      skill: "ANALYSIS",
      stem: `Which sign makes the statement true?  ${frac(num, den)}  ___  ${p}%`,
      correct: answer,
      wrongs: (["<", "=", ">"] as const)
        .filter((s) => s !== answer)
        .map((s) => ({ answer: s, ...(s === "=" ? {} : { tag: "PERCENT_CONVERSION_ERROR" }) })),
      keepOrder: true,
      explanation: `${frac(num, den)} = ${fracPercent}%. Now compare ${fracPercent}% and ${p}%: ${fracPercent}% ${answer} ${p}%.`,
      hints: [
        "To compare, write both amounts the same way. Change the fraction to a percentage.",
        `Make the denominator 100: what do you multiply ${den} by?`,
      ],
    });
  },
});

export const decimalTemplates = [
  decimalNumeration,
  decimalPlaceValue,
  decimalExpanded,
  compareDecimalsTemplate,
  orderDecimals,
  roundDecimals,
  fractionDecimalLink,
  decimalDiagram,
  percentNumeration,
  percentConversion,
  percentGrid,
  percentOfAnother,
  percentCompare,
];

// Used by the operations templates.
export { asWrongs, compareDecimals, fractionWords, fmtInt };
