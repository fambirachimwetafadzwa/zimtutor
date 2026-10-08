import { byLevel, defineTemplate, fmtDecimal, fmtInt, PLACE_NAMES } from "../kit";
import { GRADE_MAX } from "../types";
import { makeWhole, placeParts, wholeDigitsFor } from "./common";
import { equivalentFractions } from "./fractions";
import { capacityConversion, massConversion } from "./measurement";
import { frac, FRACTION_DENOMS, properFraction } from "./rational-common";
import { CONVERSIONS, singular, timeConversion } from "./time";
import { closePair, compareWhole, placeValue } from "./whole-numbers";
import {
  addWhole,
  addendsWithCarries,
  differenceSmallerFromLarger,
  multiplicationFacts,
  subtractWhole,
  subtractionWithBorrows,
  sumWithoutCarrying,
} from "./whole-operations";

/**
 * TRUE OR FALSE. A statement is made about the maths of an objective that already has practice
 * questions, and it is true half of the time. A false statement is built from a slip that children
 * really make (forgetting to carry, mixing up places, adding the same number to top and bottom), and
 * that slip is the misconception recorded when a child calls the statement true.
 *
 * The hints help the child work the statement out; none says whether it is true.
 */

type Slip = { value: number; tag?: string };

const pickSlip = <T extends { value: number }>(
  rng: { pick: <U>(items: readonly U[]) => U },
  result: number,
  slips: readonly T[],
): T => rng.pick(slips.filter((s) => s.value !== result && s.value >= 0));

const columnsOf = (n: number): number[] => [...String(n)].reverse().map(Number);

// ── sums and differences ────────────────────────────────────────────────────────────────────────

export const trueFalseSums = defineTemplate({
  id: "ops.tf-sums",
  description:
    "True or false: a sum or a difference of whole numbers, right or with a typical slip.",
  covers: (o) => addWhole.covers(o) || subtractWhole.covers(o),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const subtract = subtractWhole.covers(o);
    let a: number;
    let b: number;
    let result: number;
    let slips: Slip[];
    if (subtract) {
      const digits = Math.max(
        2,
        Math.min(wholeDigitsFor(o.grade, d), String(GRADE_MAX[o.grade]!).length - 1),
      );
      const borrows = Math.min(digits - 1, byLevel(d, [0, 1, 1, 2, 3]));
      const borrowColumns = rng.sample(
        Array.from({ length: digits - 1 }, (_, i) => i),
        borrows,
      );
      [a, b] = subtractionWithBorrows(rng, digits, borrowColumns);
      result = a - b;
      slips = [
        { value: differenceSmallerFromLarger(a, b), tag: "BORROWING_ERROR" },
        ...borrowColumns.slice(0, 1).map((c) => ({
          value: result + 10 ** (c + 1),
          tag: "BORROWING_ERROR",
        })),
        { value: result + 1, tag: "BASIC_FACT_ERROR" },
        { value: result - 1, tag: "BASIC_FACT_ERROR" },
      ];
    } else if (/basic addition facts/i.test(o.text)) {
      const tens = d >= 3;
      a = rng.int(tens ? 3 : 6, 9) * (tens ? 10 : 1);
      b = rng.int(tens ? 3 : 6, 9) * (tens ? 10 : 1);
      result = a + b;
      slips = [
        { value: result + 1, tag: "BASIC_FACT_ERROR" },
        { value: result - 1, tag: "BASIC_FACT_ERROR" },
        { value: result + (tens ? 10 : 2), tag: "BASIC_FACT_ERROR" },
      ];
    } else {
      const digits = Math.max(
        2,
        Math.min(wholeDigitsFor(o.grade, d), String(GRADE_MAX[o.grade]!).length - 1),
      );
      const carries = Math.min(digits - 1, byLevel(d, [0, 1, 2, 3, 4]));
      [a, b] = addendsWithCarries(rng, digits, carries);
      result = a + b;
      slips = [
        { value: sumWithoutCarrying(a, b), tag: "CARRYING_ERROR" },
        { value: result + 10, tag: "CARRYING_ERROR" },
        { value: result + 1, tag: "BASIC_FACT_ERROR" },
        { value: result - 1, tag: "BASIC_FACT_ERROR" },
      ];
    }
    const sign = subtract ? "−" : "+";
    const truth = rng.chance(0.5);
    const slip = pickSlip(rng, result, slips);
    const claimed = truth ? result : slip.value;
    const falseTag = !truth ? slip.tag : undefined;
    return q.trueFalse({
      skill: "APPLICATION",
      stem: `True or false? ${fmtInt(a)} ${sign} ${fmtInt(b)} = ${fmtInt(claimed)}`,
      value: truth,
      ...(falseTag ? { falseTag } : {}),
      explanation: truth
        ? `${fmtInt(a)} ${sign} ${fmtInt(b)} = ${fmtInt(result)}, so the statement is true.`
        : `${fmtInt(a)} ${sign} ${fmtInt(b)} = ${fmtInt(result)}, not ${fmtInt(claimed)}, so the statement is false.`,
      hints: [
        "Work out the answer yourself first. Then compare it with the answer in the statement.",
        subtract
          ? "Subtract column by column from the right. Borrow from the next column when the top digit is too small."
          : "Add column by column from the right. Carry to the next column when a column makes 10 or more.",
      ],
    });
  },
});

// ── multiplication facts ────────────────────────────────────────────────────────────────────────

export const trueFalseTimes = defineTemplate({
  id: "ops.tf-times",
  description: "True or false: a multiplication fact, right or one step out.",
  covers: (o) => multiplicationFacts.covers(o),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const top = o.grade === 4 ? 9 : 12;
    const low = byLevel(d, [2, 2, 3, 6, 7]);
    const a = rng.int(low, top);
    const b = rng.int(low, top);
    const product = a * b;
    const slips: Slip[] = [
      { value: product + a, tag: "BASIC_FACT_ERROR" },
      { value: product - a, tag: "BASIC_FACT_ERROR" },
      { value: product + b, tag: "BASIC_FACT_ERROR" },
      { value: product - b, tag: "BASIC_FACT_ERROR" },
      { value: a + b, tag: "OPERATION_CHOICE_ERROR" },
    ];
    const truth = rng.chance(0.5);
    const slip = pickSlip(rng, product, slips);
    const claimed = truth ? product : slip.value;
    return q.trueFalse({
      skill: "KNOWLEDGE_COMPREHENSION",
      stem: `True or false? ${a} × ${b} = ${claimed}`,
      value: truth,
      ...(!truth && slip.tag ? { falseTag: slip.tag } : {}),
      explanation: truth
        ? `${a} × ${b} = ${product}, so the statement is true.`
        : `${a} × ${b} = ${product}, not ${claimed}, so the statement is false.`,
      hints: [
        "Work out the product yourself first. Then compare it with the one in the statement.",
        `Think of ${b} groups of ${a}, or ${a} groups of ${b}.`,
      ],
    });
  },
});

// ── place value ─────────────────────────────────────────────────────────────────────────────────

export const trueFalsePlaceValue = defineTemplate({
  id: "num.tf-place-value",
  description: "True or false: the place or the value of a digit in a whole number.",
  covers: (o) => placeValue.covers(o),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const digits = Math.max(2, wholeDigitsFor(o.grade, d));
    // one digit that appears once, so that "the digit 3" cannot mean two different places
    let n = makeWhole(rng, digits, { zero: d >= 3 });
    let chosen = placeParts(n).filter(
      (p) => p.digit > 0 && columnsOf(n).filter((x) => x === p.digit).length === 1,
    );
    for (let tries = 0; chosen.length === 0 && tries < 100; tries++) {
      n = makeWhole(rng, digits, { zero: d >= 3 });
      chosen = placeParts(n).filter(
        (p) => p.digit > 0 && columnsOf(n).filter((x) => x === p.digit).length === 1,
      );
    }
    if (chosen.length === 0) throw new Error("no digit that appears once");
    const part = rng.pick(chosen);
    const truth = rng.chance(0.5);
    const hints = [
      "Find which place the digit is in: ones, tens, hundreds … counting from the right.",
      "Each place is worth ten times the place on its right.",
    ];
    if (rng.chance(0.5)) {
      const values = [
        part.digit * 10 ** (part.place + 1),
        ...(part.place > 0 ? [part.digit * 10 ** (part.place - 1), part.digit] : []),
      ].filter((v) => v !== part.value);
      const claimed = truth ? part.value : rng.pick(values);
      return q.trueFalse({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `True or false? In ${fmtInt(n)}, the digit ${part.digit} is worth ${fmtInt(claimed)}.`,
        value: truth,
        ...(!truth ? { falseTag: "PLACE_VALUE_CONFUSION" } : {}),
        explanation: truth
          ? `The ${part.digit} is in the ${PLACE_NAMES[part.place]} place, so it is worth ${fmtInt(part.value)}. The statement is true.`
          : `The ${part.digit} is in the ${PLACE_NAMES[part.place]} place, so it is worth ${fmtInt(part.value)}, not ${fmtInt(claimed)}. The statement is false.`,
        hints,
      });
    }
    const others = Array.from({ length: digits }, (_, i) => i).filter((p) => p !== part.place);
    const place = truth ? part.place : rng.pick(others);
    return q.trueFalse({
      skill: "KNOWLEDGE_COMPREHENSION",
      stem: `True or false? In ${fmtInt(n)}, the digit ${part.digit} is in the ${PLACE_NAMES[place]} place.`,
      value: truth,
      ...(!truth ? { falseTag: "PLACE_VALUE_CONFUSION" } : {}),
      explanation: truth
        ? `The ${part.digit} is in the ${PLACE_NAMES[part.place]} place. The statement is true.`
        : `The ${part.digit} is in the ${PLACE_NAMES[part.place]} place, not the ${PLACE_NAMES[place]} place. The statement is false.`,
      hints,
    });
  },
});

// ── comparing ───────────────────────────────────────────────────────────────────────────────────

export const trueFalseCompare = defineTemplate({
  id: "num.tf-compare",
  description: "True or false: two whole numbers compared with < or >.",
  covers: (o) => compareWhole.covers(o),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const digits = wholeDigitsFor(o.grade, d);
    const [a, b] = closePair(rng, digits, d);
    const right = a < b ? "<" : ">";
    const wrong = right === "<" ? ">" : "<";
    const truth = rng.chance(0.5);
    const sign = truth ? right : wrong;
    return q.trueFalse({
      skill: "KNOWLEDGE_COMPREHENSION",
      stem: `True or false? ${fmtInt(a)} ${sign} ${fmtInt(b)}`,
      value: truth,
      ...(!truth ? { falseTag: "PLACE_VALUE_CONFUSION" } : {}),
      explanation: truth
        ? `Comparing place by place from the left, ${fmtInt(a)} ${right === "<" ? "is smaller than" : "is bigger than"} ${fmtInt(b)}, so the statement is true.`
        : `Comparing place by place from the left, ${fmtInt(a)} ${right === "<" ? "is smaller than" : "is bigger than"} ${fmtInt(b)}, so the sign should be ${right}. The statement is false.`,
      hints: [
        "Count the digits first. A number with more digits is bigger.",
        "If both numbers have the same number of digits, compare them place by place, starting on the left.",
        "Remember: the sign opens towards the bigger number.",
      ],
    });
  },
});

// ── equivalent fractions ────────────────────────────────────────────────────────────────────────

export const trueFalseEquivalent = defineTemplate({
  id: "frac.tf-equivalent",
  description:
    "True or false: two fractions are equivalent (the top and bottom changed alike or not).",
  covers: (o) => equivalentFractions.covers(o),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const pool = [...(FRACTION_DENOMS[o.grade] ?? FRACTION_DENOMS[5]!)];
    const options: Array<{ b: number; k: number }> = [];
    for (const b of pool)
      for (const k of d <= 2 ? [2, 3] : [2, 3, 4, 5, 10])
        if (pool.includes(b * k)) options.push({ b, k });
    const pickFrom = options.length > 0 ? options : [{ b: pool[0]!, k: 1 }];
    const { b, k } = rng.pick(pickFrom);
    const [a] = properFraction(rng, b);
    const A = a * k;
    const B = b * k;
    const truth = rng.chance(0.5);
    // never an accidental equal pair: the slips below are all unequal for k > 1
    const additive = { top: a + (B - b), bottom: B, tag: "EQUIVALENT_FRACTION_ADDITIVE_ERROR" };
    const sameTop = { top: a, bottom: B };
    const nearMiss = { top: A + 1, bottom: B };
    const slips = k > 1 ? [additive, additive, sameTop, nearMiss] : [];
    const slip = slips.length > 0 ? rng.pick(slips) : { top: A, bottom: B, tag: undefined };
    const claimed = truth || slips.length === 0 ? { top: A, bottom: B } : slip;
    const isTrue = truth || slips.length === 0;
    const tag = "tag" in slip ? slip.tag : undefined;
    return q.trueFalse({
      skill: "KNOWLEDGE_COMPREHENSION",
      stem: `True or false? ${frac(a, b)} = ${frac(claimed.top, claimed.bottom)}`,
      value: isTrue,
      ...(!isTrue && tag ? { falseTag: tag } : {}),
      explanation: isTrue
        ? `The top and the bottom of ${frac(a, b)} were both multiplied by ${k}: ${frac(a, b)} = ${frac(A, B)}. The statement is true.`
        : `Equivalent fractions come from multiplying the top and the bottom by the SAME number: ${frac(a, b)} = ${frac(A, B)}, not ${frac(claimed.top, claimed.bottom)}. The statement is false.`,
      hints: [
        "Equivalent fractions name the same amount. They come from multiplying the top and the bottom by the SAME number.",
        "Look at what happened to the top and what happened to the bottom. Was it the same thing?",
      ],
    });
  },
});

// ── units of mass and capacity ──────────────────────────────────────────────────────────────────

export const trueFalseMassCapacity = defineTemplate({
  id: "mea.tf-mass-capacity",
  description:
    "True or false: a conversion between kilograms and grams, or litres and millilitres.",
  covers: (o) => massConversion.covers(o) || capacityConversion.covers(o),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const mass = massConversion.covers(o);
    const [big, small] = mass ? (["kg", "g"] as const) : (["l", "ml"] as const);
    const whole = rng.int(1, byLevel(d, [5, 9, 20, 50, 99]));
    const half = d >= 3 && rng.chance(0.5);
    const bigText = half ? `${whole}.5` : String(whole);
    const smallValue = whole * 1000 + (half ? 500 : 0);
    const truth = rng.chance(0.5);
    const claimed = truth
      ? smallValue
      : rng.pick([smallValue * 10, smallValue / 10, smallValue / 100]);
    const statement = rng.chance(0.5)
      ? `${fmtDecimal(bigText)} ${big} = ${fmtInt(claimed)} ${small}`
      : `${fmtInt(claimed)} ${small} = ${fmtDecimal(bigText)} ${big}`;
    const unitName = mass ? ["kilogram", "gram"] : ["litre", "millilitre"];
    return q.trueFalse({
      skill: "APPLICATION",
      stem: `True or false? ${statement}`,
      value: truth,
      ...(!truth ? { falseTag: "UNIT_CONVERSION_ERROR" } : {}),
      explanation: truth
        ? `1 ${big} = 1 000 ${small}, so ${fmtDecimal(bigText)} ${big} = ${fmtInt(smallValue)} ${small}. The statement is true.`
        : `1 ${big} = 1 000 ${small}, so ${fmtDecimal(bigText)} ${big} = ${fmtInt(smallValue)} ${small}, not ${fmtInt(claimed)} ${small}. The statement is false.`,
      hints: [
        `Think about how many ${small === "g" ? "grams" : "millilitres"} fit into one ${unitName[0]}.`,
        `There are 1 000 ${small === "g" ? "grams" : "millilitres"} in 1 ${unitName[0]}. Changing to the smaller unit gives a bigger number.`,
      ],
    });
  },
});

// ── units of time ───────────────────────────────────────────────────────────────────────────────

export const trueFalseTime = defineTemplate({
  id: "mea.tf-time",
  description: "True or false: a conversion between units of time.",
  covers: (o) => timeConversion.covers(o),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const exact = /^convert (hours|days|weeks) to (hours|days|weeks)$/i.exec(o.text.trim());
    const options = CONVERSIONS.filter((c) =>
      exact
        ? c.from === exact[1]!.toLowerCase() && c.to === exact[2]!.toLowerCase()
        : c.grades.includes(o.grade),
    );
    const c = rng.pick(options);
    const count = rng.int(2, byLevel(d, [4, 8, 12, 20, 30]));
    // the same fact stated with the bigger unit first: "3 weeks = 21 days"
    const bigger = c.op === "multiply" ? c.from : c.to;
    const smaller = c.op === "multiply" ? c.to : c.from;
    const smallCount = count * c.per;
    const truth = rng.chance(0.5);
    const claimed = truth
      ? smallCount
      : rng.pick([
          count * (c.per + (c.per > 10 ? 10 : 3)),
          count * Math.max(2, c.per - (c.per > 10 ? 10 : 2)),
          count + c.per,
        ]);
    const bigName = count === 1 ? singular(bigger) : bigger;
    const statement = rng.chance(0.5)
      ? `${count} ${bigName} = ${fmtInt(claimed)} ${smaller}`
      : `${fmtInt(claimed)} ${smaller} = ${count} ${bigName}`;
    return q.trueFalse({
      skill: "APPLICATION",
      stem: `True or false? ${statement}`,
      value: truth,
      ...(!truth ? { falseTag: "TIME_CONVERSION_ERROR" } : {}),
      explanation: truth
        ? `1 ${singular(bigger)} = ${c.per} ${smaller}, so ${count} ${bigName} = ${count} × ${c.per} = ${fmtInt(smallCount)} ${smaller}. The statement is true.`
        : `1 ${singular(bigger)} = ${c.per} ${smaller}, so ${count} ${bigName} = ${count} × ${c.per} = ${fmtInt(smallCount)} ${smaller}, not ${fmtInt(claimed)} ${smaller}. The statement is false.`,
      hints: [
        `How many ${smaller} are in one ${singular(bigger)}?`,
        "Changing to the smaller unit gives a bigger number: multiply by the number in one bigger unit.",
      ],
    });
  },
});

export const trueFalseTemplates = [
  trueFalseSums,
  trueFalseTimes,
  trueFalsePlaceValue,
  trueFalseCompare,
  trueFalseEquivalent,
  trueFalseMassCapacity,
  trueFalseTime,
];
