import { Rational } from "../../marking/rational";
import { byLevel, defineTemplate, fmtDecimal, fmtInt, scoped, type Wrong } from "../kit";
import { gcd, lcm, scaledText, trimmedDecimal } from "../maths";
import type { Rng } from "../rng";
import type { Difficulty } from "../types";
import {
  denomsFor,
  frac,
  FRACTION_DENOMS,
  G3_OPERATION_DENOMS,
  MIXED_DENOMS,
  mixed,
  properFraction,
} from "./rational-common";

/**
 * Operations on fractions, mixed numbers and decimals. Denominators and decimal places follow the
 * printed Content for each grade: G3 same denominators 2, 4, 5, 10 · G4 same denominators 2, 4, 5,
 * 10, 20 · G5 same or different, 2 to 10 and 20 · G6/G7 2 to 10 and multiples of 5 up to 50/100.
 */

const OPS = "OPS" as const;

/** Exact value of a fraction as text in the form a learner would write it: "3/4", "1 2/5" or "2". */
export function fractionText(value: Rational, asMixed: boolean): string {
  if (value.isInteger()) return value.toString();
  const text = value.toFractionString();
  const [n, d] = text.split("/").map(Number) as [number, number];
  if (!asMixed || n < d) return text;
  const whole = Math.floor(n / d);
  return `${whole} ${n - whole * d}/${d}`;
}

const rational = (n: number, d: number) => new Rational(BigInt(n), BigInt(d));
const lcmOf = (values: number[]) => values.reduce((a, b) => lcm(a, b), 1);

// ── adding and subtracting fractions ────────────────────────────────────────────────────────────

function operationDenominators(grade: number, difficulty: Difficulty): number[] {
  if (grade === 3) return [...G3_OPERATION_DENOMS];
  return denomsFor(grade, difficulty);
}

export const fractionAddSub = defineTemplate({
  id: "ops.fraction-add-sub",
  description: "Add and subtract proper fractions with the same or different denominators.",
  covers: (o) =>
    scoped(o, {
      topic: OPS,
      strand: /^(?:addition|subtraction)-of-proper-fractions/,
      text: /proper fractions/i,
      not: /mixed|law|associative/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const t = o.text.toLowerCase();
    const subtract = /^subtract/.test(t);
    const different = /different denominators/.test(t);
    const maxTerms = /three/.test(t) ? 3 : /up to 3/.test(t) ? 3 : 2;
    const terms = !subtract && !different && maxTerms === 3 && d >= 3 ? 3 : 2;
    const pool = operationDenominators(o.grade, d);
    const mayEqualOne = o.grade >= 4 || d >= 3;
    const allowImproper = o.grade >= 4 && d >= 2;

    let items: Array<[number, number]> = [];
    let result: Rational | null = null;
    for (let tries = 0; tries < 400; tries++) {
      if (different) {
        const smallLcm = byLevel(d, [12, 20, 24, 40, 100]);
        const d1 = rng.pick(pool.filter((x) => x >= 2));
        // easy levels: one denominator is a multiple of the other; later levels: they are not
        const related = (a: number, b: number) => a % b === 0 || b % a === 0;
        const near = pool.filter((x) => x !== d1 && lcm(d1, x) <= smallLcm);
        const preferred = near.filter((x) => (d <= 2 ? related(d1, x) : !related(d1, x)));
        const candidates = preferred.length > 0 ? preferred : near;
        const d2 =
          candidates.length > 0 ? rng.pick(candidates) : rng.pick(pool.filter((x) => x !== d1));
        items = [
          [rng.int(1, d1 - 1), d1],
          [rng.int(1, d2 - 1), d2],
        ];
      } else {
        const den = rng.pick(pool.filter((x) => x >= 3));
        items = Array.from({ length: terms }, () => [rng.int(1, den - 1), den] as [number, number]);
      }
      const values = items.map(([n, dn]) => rational(n, dn));
      if (subtract) {
        if (values[0]!.compare(values[1]!) <= 0) continue;
        result = values[0]!.sub(values[1]!);
      } else {
        result = values.reduce((a, b) => a.add(b));
        if (!allowImproper && result.compare(Rational.ONE) > 0) continue;
        if (!mayEqualOne && result.compare(Rational.ONE) >= 0) continue;
      }
      if (result.isZero()) continue;
      break;
    }
    if (!result) throw new Error("fractionAddSub: no case found");
    const symbol = subtract ? "−" : "+";
    const expression = items.map(([n, dn]) => frac(n, dn)).join(` ${symbol} `);
    const answer = fractionText(result, true);
    const asMixed = result.compare(Rational.ONE) > 0 && !result.isInteger();
    const common = lcmOf(items.map(([, dn]) => dn));
    const converted = items.map(([n, dn]) => frac((n * common) / dn, common));
    // adding the denominators as well as the numerators
    const nums = items.map(([n]) => n);
    const dens = items.map(([, dn]) => dn);
    const denominatorSum = frac(
      subtract ? nums[0]! - nums[1]! : nums.reduce((a, b) => a + b, 0),
      dens.reduce((a, b) => a + b, 0),
    );
    const wrongs: Wrong[] = [
      ...(subtract && nums[0]! - nums[1]! <= 0
        ? []
        : [{ answer: denominatorSum, tag: "FRACTION_DENOMINATOR_CONFUSION" }]),
      ...(different
        ? [
            {
              answer: frac(
                subtract ? Math.abs(nums[0]! - nums[1]!) : nums[0]! + nums[1]!,
                dens[0]!,
              ),
            },
          ]
        : []),
    ];
    const stem = `Work out ${expression}.${o.grade >= 4 ? " Give your answer in its simplest form." : ""}`;
    const hints = different
      ? [
          "The denominators are different, so we cannot add or subtract the numerators yet.",
          `Find a number that both denominators go into, and rewrite both fractions with it: ${common}.`,
          `${items.map(([n, dn]) => `${frac(n, dn)} = ${frac((n * common) / dn, common)}`).join(" and ")}. Now ${subtract ? "subtract" : "add"} the numerators.`,
        ]
      : [
          "The denominators are the same, so the parts are the same size.",
          `${subtract ? "Subtract" : "Add"} the numerators. The denominator stays the same.`,
          "Do not add the denominators: they only name the size of the parts.",
        ];
    const rawNumerator = subtract
      ? items.reduce(
          (acc, [n, dn], i) => (i === 0 ? (n * common) / dn : acc - (n * common) / dn),
          0,
        )
      : items.reduce((acc, [n, dn]) => acc + (n * common) / dn, 0);
    const raw = different ? frac(rawNumerator, common) : frac(rawNumerator, dens[0]!);
    const explanation = different
      ? `Use the common denominator ${common}: ${converted.join(` ${symbol} `)} = ${raw}${raw !== answer ? ` = ${answer} in its simplest form` : ""}.`
      : `The denominators are the same, so ${subtract ? "subtract" : "add"} the numerators and keep the denominator: ${expression} = ${raw}${raw !== answer ? ` = ${answer} in its simplest form` : ""}.`;
    if (o.grade === 3)
      return q.fraction({
        skill: "APPLICATION",
        stem,
        value: answer,
        lowestTerms: false,
        answerHint: "Write a fraction using a slash (/).",
        wrongs,
        explanation,
        hints,
      });
    return q.fraction({
      skill: "APPLICATION",
      stem,
      value: answer,
      lowestTerms: true,
      answerHint: asMixed
        ? "Write a mixed number or a fraction."
        : "Write a fraction using a slash (/).",
      wrongs,
      explanation,
      hints,
    });
  },
});

// ── fractions of quantities and fraction × whole number ─────────────────────────────────────────

export const fractionOfQuantity = defineTemplate({
  id: "ops.fraction-of-quantity",
  description: "Find a fraction of a whole number.",
  covers: (o) =>
    scoped(o, {
      topic: OPS,
      text: /multiply a whole number by a proper fraction|fractions of whole numbers/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q, local }) => {
    const den = rng.pick([2, 4, 5, 10].filter((x) => (d <= 1 ? x <= 5 : true)));
    const num = d <= 1 ? 1 : rng.int(1, den - 1);
    const groups = rng.int(2, byLevel(d, [5, 8, 10, 12, 20]));
    const whole = den * groups;
    const answer = (whole / den) * num;
    const wrongs: Wrong[] = [
      ...(num > 1 ? [{ answer: String(whole / den), tag: "FRACTION_OF_QUANTITY_ERROR" }] : []),
      { answer: String(whole * num), tag: "FRACTION_OF_QUANTITY_ERROR" },
      { answer: String(answer + num), tag: "BASIC_FACT_ERROR" },
      { answer: String(whole - answer), tag: "FRACTION_OF_QUANTITY_ERROR" },
    ].filter((w) => Number(w.answer) !== answer);
    const hints = [
      `The denominator ${den} tells us to share ${whole} into ${den} equal groups. How many are in each group?`,
      `The numerator ${num} tells us how many of those groups to take.`,
    ];
    const explanation = `${frac(num, den)} of ${whole}: divide ${whole} by ${den} to get ${whole / den}, then multiply by ${num}: ${whole / den} × ${num} = ${answer}.`;
    if (d >= 3 && rng.chance(0.6)) {
      const name = rng.pick(["Tendai", "Rudo", "Farai", "Chipo", "Nyasha"]);
      const thing = local
        ? rng.pick(["mangoes", "maize cobs", "goats", "eggs"])
        : rng.pick(["sweets", "stickers", "pencils", "counters"]);
      return q.numeric({
        skill: "PROBLEM_SOLVING",
        type: "WORD_PROBLEM",
        stem: `${name} has ${whole} ${thing}. ${name} gives ${frac(num, den)} of them to a friend. How many ${thing} does ${name} give away?`,
        answer: String(answer),
        wrongs,
        usesLocalContext: local,
        explanation,
        hints,
      });
    }
    return q.numeric({
      skill: "APPLICATION",
      stem:
        o.grade === 3
          ? `Work out ${frac(num, den)} × ${whole}.`
          : `Find ${frac(num, den)} of ${whole}.`,
      answer: String(answer),
      wrongs,
      explanation,
      hints,
    });
  },
});

export const fractionMultiply = defineTemplate({
  id: "ops.fraction-multiply",
  description:
    "Multiply proper fractions by whole numbers, by proper fractions, and mixed numbers.",
  covers: (o) =>
    scoped(o, {
      topic: OPS,
      strand: /^multiplication-of-proper-fractions/,
      text: /multiply|multiplication/i,
      not: /fractions of whole numbers/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const t = o.text.toLowerCase();
    const mixedMode = /mixed numbers/.test(t);
    const byWhole = /by (?:up to 4-digit )?whole numbers/.test(t);
    const pool = o.grade === 4 ? [2, 4, 5, 10] : [2, 3, 4, 5, 6, 7, 8, 9, 10];
    const easy = d <= 2 ? pool.filter((x) => x <= 5 || x === 10) : pool;

    if (byWhole) {
      const den = rng.pick(easy);
      const [num] = properFraction(rng, den, { coprime: d <= 3 });
      const wholeMax =
        o.grade === 6
          ? byLevel(d, [30, 100, 500, 2000, 9999])
          : byLevel(d, [20, 40, 100, 200, 300]);
      const groups = rng.int(2, Math.max(2, Math.floor(wholeMax / den)));
      const whole = den * groups;
      const answer = (whole / den) * num;
      return q.fraction({
        skill: "APPLICATION",
        stem: `Work out ${frac(num, den)} × ${fmtInt(whole)}.`,
        value: String(answer),
        lowestTerms: true,
        answerHint: "Write a whole number or a fraction.",
        wrongs: [
          { answer: frac(num * whole, den * whole), tag: "FRACTION_MULTIPLICATION_ERROR" },
          { answer: String(whole * num), tag: "FRACTION_MULTIPLICATION_ERROR" },
          { answer: String(whole / den), tag: "FRACTION_OF_QUANTITY_ERROR" },
        ].filter(
          (w) => w.answer !== String(answer) && !(num === 1 && w.answer === String(whole / den)),
        ),
        explanation: `${fmtInt(whole)} ÷ ${den} = ${fmtInt(whole / den)}, and ${fmtInt(whole / den)} × ${num} = ${fmtInt(answer)}. So ${frac(num, den)} × ${fmtInt(whole)} = ${fmtInt(answer)}.`,
        hints: [
          `Write ${fmtInt(whole)} as ${fmtInt(whole)}/1 and multiply the numerators and the denominators, or share ${fmtInt(whole)} into ${den} equal groups first.`,
          `Divide ${fmtInt(whole)} by the denominator ${den}.`,
          `Then multiply by the numerator ${num}.`,
        ],
      });
    }

    if (mixedMode) {
      const dens = MIXED_DENOMS[o.grade] ?? MIXED_DENOMS[7]!;
      let a = { whole: 1, num: 1, den: 2 };
      let b = { whole: 1, num: 1, den: 2 };
      for (let tries = 0; tries < 200; tries++) {
        const make = () => {
          const den = rng.pick(dens.filter((x) => (d <= 3 ? x <= 5 || x === 10 : true)));
          return { whole: rng.int(1, byLevel(d, [2, 3, 4, 5, 6])), num: rng.int(1, den - 1), den };
        };
        a = make();
        b = make();
        if (a.den !== b.den || d >= 3) break;
      }
      const va = rational(a.whole * a.den + a.num, a.den);
      const vb = rational(b.whole * b.den + b.num, b.den);
      const product = va.mul(vb);
      const answer = fractionText(product, true);
      const separately = rational(a.whole * b.whole, 1).add(rational(a.num * b.num, a.den * b.den));
      const wrongs: Wrong[] = [
        ...(separately.equals(product)
          ? []
          : [{ answer: fractionText(separately, true), tag: "FRACTION_MULTIPLICATION_ERROR" }]),
        { answer: fractionText(va.add(vb), true), tag: "OPERATION_CHOICE_ERROR" },
      ];
      return q.fraction({
        skill: "APPLICATION",
        stem: `Work out ${mixed(a.whole, a.num, a.den)} × ${mixed(b.whole, b.num, b.den)}. Give your answer as a mixed number in its simplest form.`,
        value: answer,
        lowestTerms: true,
        answerHint: "Write a mixed number or a fraction.",
        wrongs,
        explanation: `Change each mixed number to an improper fraction: ${mixed(a.whole, a.num, a.den)} = ${frac(a.whole * a.den + a.num, a.den)} and ${mixed(b.whole, b.num, b.den)} = ${frac(b.whole * b.den + b.num, b.den)}. Multiply the numerators and the denominators: ${frac((a.whole * a.den + a.num) * (b.whole * b.den + b.num), a.den * b.den)} = ${answer}.`,
        hints: [
          "Do not multiply the whole numbers and the fractions separately.",
          "Change each mixed number into an improper fraction first.",
          "Multiply the numerators, multiply the denominators, then change the answer back to a mixed number in its simplest form.",
        ],
      });
    }

    // fraction × fraction
    let a: [number, number] = [1, 2];
    let b: [number, number] = [1, 2];
    for (let tries = 0; tries < 200; tries++) {
      const d1 = rng.pick(easy);
      const d2 = rng.pick(easy);
      a = [rng.int(1, d1 - 1), d1];
      b = [rng.int(1, d2 - 1), d2];
      if (a[0] !== a[1] && b[0] !== b[1]) break;
    }
    const product = rational(a[0] * b[0], a[1] * b[1]);
    const answer = fractionText(product, false);
    const commonDen = lcm(a[1], b[1]);
    return q.fraction({
      skill: "APPLICATION",
      stem: `Work out ${frac(...a)} × ${frac(...b)}. Give your answer in its simplest form.`,
      value: answer,
      lowestTerms: true,
      answerHint: "Write a fraction using a slash (/).",
      wrongs: [
        {
          answer: frac(a[0] * b[0], commonDen),
          tag: "FRACTION_MULTIPLICATION_ERROR",
        },
        { answer: frac(a[0] + b[0], a[1] * b[1]), tag: "FRACTION_MULTIPLICATION_ERROR" },
        { answer: frac(a[0] * b[0], a[1]), tag: "FRACTION_MULTIPLICATION_ERROR" },
      ].filter(
        (w) => !rational(...(w.answer.split("/").map(Number) as [number, number])).equals(product),
      ),
      explanation: `Multiply the numerators: ${a[0]} × ${b[0]} = ${a[0] * b[0]}. Multiply the denominators: ${a[1]} × ${b[1]} = ${a[1] * b[1]}. So ${frac(...a)} × ${frac(...b)} = ${frac(a[0] * b[0], a[1] * b[1])}${gcd(a[0] * b[0], a[1] * b[1]) > 1 ? ` = ${answer}` : ""}.`,
      hints: [
        "To multiply fractions you do NOT need a common denominator.",
        "Multiply the two numerators together, and multiply the two denominators together.",
        "Then write the answer in its simplest form.",
      ],
    });
  },
});

export const mixedAddSub = defineTemplate({
  id: "ops.mixed-add-sub",
  description: "Add and subtract mixed numbers.",
  covers: (o) =>
    scoped(o, {
      topic: OPS,
      text: /(?:addition|subtraction) of mixed numbers|(?:add|subtract).*mixed numbers/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const subtract = /subtract/i.test(o.text);
    const dens = (MIXED_DENOMS[o.grade] ?? MIXED_DENOMS[7]!).filter((x) =>
      d <= 2 ? [2, 4, 5, 10].includes(x) : true,
    );
    let a = { whole: 2, num: 1, den: 2 };
    let b = { whole: 1, num: 1, den: 2 };
    let value: Rational | null = null;
    for (let tries = 0; tries < 400; tries++) {
      const den1 = rng.pick(dens);
      const den2 = d <= 2 ? den1 : rng.pick(dens);
      if (d >= 3 && den1 !== den2 && lcm(den1, den2) > 40) continue;
      a = {
        whole: rng.int(2, byLevel(d, [4, 6, 9, 12, 20])),
        num: rng.int(1, den1 - 1),
        den: den1,
      };
      b = {
        whole: rng.int(1, byLevel(d, [3, 5, 8, 11, 19])),
        num: rng.int(1, den2 - 1),
        den: den2,
      };
      const va = rational(a.whole * a.den + a.num, a.den);
      const vb = rational(b.whole * b.den + b.num, b.den);
      if (subtract) {
        if (va.compare(vb) <= 0) continue;
        // at higher levels the fraction part of the first number is smaller (regrouping needed)
        const needsRegroup = rational(a.num, a.den).compare(rational(b.num, b.den)) < 0;
        if (d >= 3 && !needsRegroup && rng.chance(0.7)) continue;
        value = va.sub(vb);
      } else {
        value = va.add(vb);
        const overflow =
          rational(a.num, a.den).add(rational(b.num, b.den)).compare(Rational.ONE) >= 0;
        if (d >= 3 && !overflow && rng.chance(0.7)) continue;
      }
      if (value.isZero()) continue;
      break;
    }
    if (!value) throw new Error("mixedAddSub: no case found");
    const answer = fractionText(value, true);
    const symbol = subtract ? "−" : "+";
    const fa = rational(a.num, a.den);
    const fb = rational(b.num, b.den);
    // typical errors
    const wholeParts = subtract ? a.whole - b.whole : a.whole + b.whole;
    const fractionParts = subtract ? (fa.compare(fb) >= 0 ? fa.sub(fb) : fb.sub(fa)) : fa.add(fb);
    const separately = rational(wholeParts, 1).add(fractionParts);
    return q.fraction({
      skill: "APPLICATION",
      stem: `Work out ${mixed(a.whole, a.num, a.den)} ${symbol} ${mixed(b.whole, b.num, b.den)}. Give your answer in its simplest form.`,
      value: answer,
      lowestTerms: true,
      answerHint: "Write a mixed number or a fraction.",
      wrongs: separately.equals(value)
        ? []
        : [
            {
              answer: fractionText(separately, true),
              tag: subtract ? "BORROWING_ERROR" : "CARRYING_ERROR",
            },
          ],
      explanation: `Change both to improper fractions (or work with wholes and fractions separately, regrouping when needed): ${mixed(a.whole, a.num, a.den)} ${symbol} ${mixed(b.whole, b.num, b.den)} = ${answer}.`,
      hints: subtract
        ? [
            "Subtract the whole numbers and the fractions separately, or change both to improper fractions.",
            "If the fraction you are taking away is bigger, borrow 1 whole from the whole-number part and turn it into parts.",
            "Give both fractions the same denominator first.",
          ]
        : [
            "Add the whole numbers and the fractions separately, or change both to improper fractions.",
            "Give both fractions the same denominator before you add them.",
            "If the fractions add up to 1 or more, carry the whole into the whole-number part.",
          ],
    });
  },
});

export const fractionLaws = defineTemplate({
  id: "ops.fraction-laws",
  description: "Use the associative and commutative laws to add fractions.",
  covers: (o) =>
    scoped(o, { topic: OPS, text: /associative and commutative laws to add proper fractions/i }),
  generate: ({ difficulty: d, rng, q }) => {
    const den = rng.pick([5, 6, 7, 8, 9, 10, 12]);
    const x = rng.int(1, den - 2);
    const y = den - x; // x/den + y/den = 1
    const other: [number, number] = [
      rng.int(1, 4),
      rng.pick([3, 4, 5, 7].filter((v) => v !== den)),
    ];
    const total = rational(1, 1).add(rational(other[0], other[1]));
    if (d <= 3) {
      return q.fraction({
        skill: "APPLICATION",
        type: "FILL_IN_THE_BLANK",
        stem: `Fill in the missing fraction:  ${frac(x, den)} + ${frac(...other)} + ${frac(y, den)} = (${frac(x, den)} + ___) + ${frac(...other)}`,
        value: frac(y, den),
        lowestTerms: false,
        answerHint: "Write a fraction using a slash (/).",
        wrongs: [{ answer: frac(...other) }, { answer: frac(x, den) }],
        explanation: `Addition can be done in any order. Moving ${frac(y, den)} next to ${frac(x, den)} gives (${frac(x, den)} + ${frac(y, den)}) + ${frac(...other)}.`,
        hints: [
          "The commutative law lets us change the order of the fractions.",
          "Which fraction has not yet been put inside the bracket?",
        ],
      });
    }
    return q.fraction({
      skill: "APPLICATION",
      stem: `Use the laws of addition to work out ${frac(x, den)} + ${frac(...other)} + ${frac(y, den)} in an easy way. Give your answer in its simplest form.`,
      value: fractionText(total, true),
      lowestTerms: true,
      answerHint: "Write a mixed number or a fraction.",
      wrongs: [],
      explanation: `Put the two fractions with denominator ${den} together: (${frac(x, den)} + ${frac(y, den)}) + ${frac(...other)} = 1 + ${frac(...other)} = ${fractionText(total, true)}.`,
      hints: [
        "You can add the fractions in any order and group them any way you like.",
        `Two of the fractions have the same denominator. Add those two first.`,
      ],
    });
  },
});

// ── decimals ────────────────────────────────────────────────────────────────────────────────────

interface Scaled {
  value: number;
  dp: number;
}

function randomScaled(rng: Rng, dp: number, wholeDigits: number): Scaled {
  const whole = rng.int(10 ** (wholeDigits - 1), 10 ** wholeDigits - 1);
  let fraction = rng.int(10 ** (dp - 1), 10 ** dp - 1);
  if (fraction % 10 === 0) fraction += rng.int(1, 9);
  return { value: whole * 10 ** dp + fraction, dp };
}

const toText = (x: Scaled): string => scaledText(x.value, x.dp);
const align = (x: Scaled, dp: number): number => x.value * 10 ** (dp - x.dp);

function maxDecimalPlaces(grade: number): number {
  return grade <= 4 ? 1 : grade === 5 ? 2 : 3;
}

export const decimalAddSub = defineTemplate({
  id: "ops.decimal-add-sub",
  description: "Add and subtract decimals (aligning the decimal points).",
  covers: (o) => scoped(o, { topic: OPS, strand: /^(?:addition|subtraction)-of-decimals/ }),
  generate: ({ objective: o, difficulty: d, rng, q, local }) => {
    const subtract = /^subtract/i.test(o.text);
    const maxDp = maxDecimalPlaces(o.grade);
    const wholeDigits = byLevel(d, [1, 1, 2, 2, o.grade >= 6 ? 3 : 2]);
    const dpA = Math.min(maxDp, byLevel(d, [1, 1, 2, 2, 3]));
    const dpB =
      maxDp === 1 ? 1 : d <= 2 ? dpA : rng.int(1, Math.min(maxDp, byLevel(d, [1, 1, 2, 3, 3])));
    let a = randomScaled(rng, dpA, wholeDigits);
    let b = randomScaled(
      rng,
      dpB,
      subtract ? Math.max(1, wholeDigits - (rng.chance(0.4) ? 1 : 0)) : wholeDigits,
    );
    const dp = Math.max(a.dp, b.dp);
    if (subtract && align(a, dp) <= align(b, dp)) [a, b] = [b, a];
    if (subtract && align(a, dp) === align(b, dp)) b = randomScaled(rng, dpB, 1);
    const result = subtract ? align(a, dp) - align(b, dp) : align(a, dp) + align(b, dp);
    const answerText = trimmedDecimal(result, dp);
    // errors
    const misaligned = subtract ? a.value - b.value : a.value + b.value; // digits lined up on the right
    const noRegroup = (() => {
      const x = [...String(align(a, dp))].reverse().map(Number);
      const y = [...String(align(b, dp))].reverse().map(Number);
      const out = x.map((digit, i) =>
        subtract ? Math.abs(digit - (y[i] ?? 0)) : (digit + (y[i] ?? 0)) % 10,
      );
      return Number([...out].reverse().join(""));
    })();
    const wrongs: Wrong[] = [
      ...(a.dp !== b.dp && misaligned > 0
        ? [{ answer: trimmedDecimal(misaligned, dp), tag: "DECIMAL_PLACE_CONFUSION" }]
        : []),
      ...(noRegroup !== result && noRegroup > 0
        ? [
            {
              answer: trimmedDecimal(noRegroup, dp),
              tag: subtract ? "BORROWING_ERROR" : "CARRYING_ERROR",
            },
          ]
        : []),
      { answer: trimmedDecimal(result, dp + 1), tag: "DECIMAL_PLACE_CONFUSION" },
      ...(dp > 1
        ? [{ answer: trimmedDecimal(result, dp - 1), tag: "DECIMAL_PLACE_CONFUSION" }]
        : []),
    ].filter((w) => Number(w.answer) !== Number(answerText));
    const symbol = subtract ? "−" : "+";
    const hints = [
      "Write the numbers under each other so that the decimal points are in a straight line.",
      a.dp !== b.dp
        ? "Fill the empty places with zeros so that both numbers have the same number of decimal places."
        : "Start at the right-hand column, as you would with whole numbers.",
      `${subtract ? "Subtract" : "Add"} each column, ${subtract ? "borrowing" : "carrying"} when you need to, and put the decimal point straight down in the answer.`,
    ];
    if (d >= 4 && rng.chance(0.5)) {
      const unit = rng.pick(["kg", "m", "l"] as const);
      const thing = {
        kg: local ? "maize meal" : "flour",
        m: local ? "cloth" : "ribbon",
        l: local ? "water" : "juice",
      }[unit];
      return q.unit({
        skill: "PROBLEM_SOLVING",
        type: "WORD_PROBLEM",
        stem: subtract
          ? `A ${thing === "cloth" || thing === "ribbon" ? "piece of" : "container of"} ${thing} measures ${fmtDecimal(toText(a))} ${unit}. ${fmtDecimal(toText(b))} ${unit} is used. How much is left?`
          : `Chipo has ${fmtDecimal(toText(a))} ${unit} of ${thing} and Simba has ${fmtDecimal(toText(b))} ${unit}. How much do they have altogether?`,
        value: answerText,
        unit,
        unitOptional: true,
        wrongs,
        usesLocalContext: local,
        explanation: `${fmtDecimal(toText(a))} ${symbol} ${fmtDecimal(toText(b))} = ${answerText} ${unit}.`,
        hints,
      });
    }
    return q.numeric({
      skill: "APPLICATION",
      stem: `Work out ${fmtDecimal(toText(a))} ${symbol} ${fmtDecimal(toText(b))}.`,
      answer: answerText,
      wrongs,
      explanation: `Line up the decimal points and ${subtract ? "subtract" : "add"} column by column: ${fmtDecimal(toText(a))} ${symbol} ${fmtDecimal(toText(b))} = ${answerText}.`,
      hints,
    });
  },
});

export const decimalMultiply = defineTemplate({
  id: "ops.decimal-multiply",
  description: "Multiply decimals by whole numbers and by decimals.",
  covers: (o) => scoped(o, { topic: OPS, strand: /^multiplication-of-decimal/ }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const byWhole = o.grade === 5;
    let a: Scaled;
    let b: Scaled;
    if (byWhole) {
      a = randomScaled(rng, byLevel(d, [1, 1, 2, 2, 2]), byLevel(d, [1, 1, 1, 2, 2]));
      b = { value: rng.int(2, byLevel(d, [4, 6, 9, 9, 9])), dp: 0 };
    } else {
      // multiplicand: a 3-digit number with up to 2 decimal places; multiplier: a 2-digit number with up to 1
      const dpA = byLevel(d, [1, 1, 2, 2, 2]);
      a = { value: rng.int(100, 999), dp: dpA };
      if (d <= 2) a = { value: rng.int(10, 99), dp: 1 };
      b =
        d <= 2
          ? { value: rng.int(2, 9), dp: 0 }
          : { value: rng.int(11, 99), dp: rng.pick([0, 1, 1]) };
    }
    const product = a.value * b.value;
    const dp = a.dp + b.dp;
    const answerText = trimmedDecimal(product, dp);
    return q.numeric({
      skill: "APPLICATION",
      stem: `Work out ${fmtDecimal(toText(a))} × ${fmtDecimal(toText(b))}.`,
      answer: answerText,
      wrongs: [
        ...(b.dp > 0
          ? [{ answer: trimmedDecimal(product, a.dp), tag: "DECIMAL_PLACE_CONFUSION" }]
          : []),
        { answer: trimmedDecimal(product, dp + 1), tag: "DECIMAL_PLACE_CONFUSION" },
        ...(dp > 0
          ? [{ answer: trimmedDecimal(product, dp - 1), tag: "DECIMAL_PLACE_CONFUSION" }]
          : []),
        { answer: String(product), tag: "DECIMAL_PLACE_CONFUSION" },
      ].filter((w) => Number(w.answer) !== Number(answerText)),
      explanation: `Ignore the decimal points and multiply: ${a.value} × ${b.value} = ${fmtInt(product)}. Together the numbers have ${dp} decimal place${dp === 1 ? "" : "s"}, so the answer has ${dp}: ${answerText}.`,
      hints: [
        "First multiply as if there were no decimal points.",
        "Count the decimal places in BOTH numbers added together.",
        "Put the decimal point in the answer so that it has that many decimal places.",
      ],
    });
  },
});

export const decimalDivide = defineTemplate({
  id: "ops.decimal-divide",
  description: "Divide decimals by whole numbers and by decimals.",
  covers: (o) => scoped(o, { topic: OPS, strand: /^division-of-decimal/ }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    let divisor: Scaled;
    let quotient: Scaled;
    if (o.grade === 5) {
      divisor = { value: rng.int(2, byLevel(d, [4, 6, 9, 9, 9])), dp: 0 };
      quotient = randomScaled(rng, byLevel(d, [1, 1, 2, 2, 2]), byLevel(d, [1, 1, 1, 2, 2]));
    } else {
      const maxDividendDp = o.grade === 6 ? 2 : 3;
      divisor = {
        value: rng.int(2, byLevel(d, [9, 12, 25, 45, 99])),
        dp: d <= 2 ? 1 : rng.pick([1, 1, 2]),
      };
      if (divisor.value % 10 === 0) divisor.value += 1;
      const quotientDp = Math.max(0, Math.min(rng.int(0, 1), maxDividendDp - divisor.dp));
      quotient =
        quotientDp === 0
          ? { value: rng.int(2, byLevel(d, [9, 20, 50, 99, 150])), dp: 0 }
          : randomScaled(rng, quotientDp, 1);
    }
    const dividendValue = divisor.value * quotient.value;
    const dividend: Scaled = { value: dividendValue, dp: divisor.dp + quotient.dp };
    const answerText = trimmedDecimal(quotient.value, quotient.dp);
    const dividendText = trimmedDecimal(dividend.value, dividend.dp);
    const shift = divisor.dp;
    return q.numeric({
      skill: "APPLICATION",
      stem: `Work out ${fmtDecimal(dividendText)} ÷ ${fmtDecimal(toText(divisor))}.`,
      answer: answerText,
      wrongs: [
        { answer: trimmedDecimal(quotient.value, quotient.dp + 1), tag: "DECIMAL_PLACE_CONFUSION" },
        ...(quotient.dp > 0
          ? [
              {
                answer: trimmedDecimal(quotient.value, quotient.dp - 1),
                tag: "DECIMAL_PLACE_CONFUSION",
              },
            ]
          : [{ answer: String(quotient.value * 10), tag: "DECIMAL_PLACE_CONFUSION" }]),
        { answer: trimmedDecimal(quotient.value + 1, quotient.dp), tag: "BASIC_FACT_ERROR" },
      ].filter((w) => Number(w.answer) !== Number(answerText)),
      explanation:
        shift > 0
          ? `Make the divisor a whole number by multiplying both numbers by ${10 ** shift}: ${fmtDecimal(dividendText)} × ${10 ** shift} = ${fmtDecimal(scaledText(dividend.value, dividend.dp - shift))} and ${fmtDecimal(toText(divisor))} × ${10 ** shift} = ${divisor.value}. Now ${fmtDecimal(scaledText(dividend.value, dividend.dp - shift))} ÷ ${divisor.value} = ${answerText}.`
          : `Divide as with whole numbers and keep the decimal point in line: ${fmtDecimal(dividendText)} ÷ ${divisor.value} = ${answerText}.`,
      hints:
        shift > 0
          ? [
              "It is easier to divide by a whole number. Multiply BOTH numbers by 10 (or 100) until the divisor is whole.",
              "Multiplying both numbers by the same amount does not change the answer.",
              "Now divide, keeping the decimal point in line.",
            ]
          : [
              "Divide as you would with whole numbers.",
              "Put the decimal point in the answer straight above the decimal point in the dividend.",
            ],
    });
  },
});

export const rationalOperationTemplates = [
  fractionAddSub,
  fractionOfQuantity,
  fractionMultiply,
  mixedAddSub,
  fractionLaws,
  decimalAddSub,
  decimalMultiply,
  decimalDivide,
];

// For other template files.
export { FRACTION_DENOMS };
