import { byLevel, defineTemplate, fmtInt, joinWords, scoped, type Wrong } from "../kit";
import { divisors, gcd, lcm } from "../maths";
import type { Rng } from "../rng";
import { GRADE_MAX, type Difficulty } from "../types";
import { wholeDigitsFor } from "./common";

/**
 * The four operations on whole numbers: addition and subtraction with controlled carrying and
 * borrowing, the laws of addition, equal additions, multiplication facts and methods, division with
 * and without remainders, factors, multiples, HCF and LCM, combined operations, and word problems.
 * Number sizes follow the printed Content of each grade (sum ≤ 1 000 … 10 000 000; products < 500,
 * 1 000, 5 000, 10 000, 100 000; dividends ≤ 100, 1 000, 10 000, 100 000).
 */

const OPS = "OPS" as const;
const ADD = /^addition-of-whole-numbers$/;
const SUB = /^subtraction-of-whole-numbers$/;
const MUL = /^multiplication-of-whole-numbers$/;
const DIV = /^division-of-whole-numbers/;

/** Digits of a number from the ones column upwards. */
const columns = (n: number): number[] => [...String(n)].reverse().map(Number);
const fromColumns = (cols: number[]): number => Number([...cols].reverse().join(""));

// ── controlled carrying and borrowing ───────────────────────────────────────────────────────────

/** Two `digits`-digit numbers whose sum has exactly `carries` carries and no extra digit. */
export function addendsWithCarries(rng: Rng, digits: number, carries: number): [number, number] {
  const carryColumns = new Set(
    rng.sample(
      Array.from({ length: digits - 1 }, (_, i) => i),
      Math.min(carries, digits - 1),
    ),
  );
  const a: number[] = [];
  const b: number[] = [];
  let carryIn = 0;
  for (let i = 0; i < digits; i++) {
    const carryOut = carryColumns.has(i);
    const lowest = i === digits - 1 ? 1 : 0;
    let placed = false;
    for (let tries = 0; tries < 200 && !placed; tries++) {
      const x = rng.int(lowest, 9);
      const y = rng.int(lowest, 9);
      const total = x + y + carryIn;
      if (carryOut ? total >= 10 : total <= 9) {
        a[i] = x;
        b[i] = y;
        placed = true;
      }
    }
    if (!placed) throw new Error("addendsWithCarries: no digits fit");
    carryIn = carryOut ? 1 : 0;
  }
  return [fromColumns(a), fromColumns(b)];
}

/** Subtraction `top − bottom` with `digits` digits that borrows in exactly the given columns. */
export function subtractionWithBorrows(
  rng: Rng,
  digits: number,
  borrowColumns: readonly number[],
): [number, number] {
  const borrowing = new Set(borrowColumns);
  const top: number[] = [];
  const bottom: number[] = [];
  let borrowIn = 0;
  for (let i = 0; i < digits; i++) {
    const borrowOut = borrowing.has(i) && i < digits - 1;
    const lowest = i === digits - 1 ? 1 : 0;
    let placed = false;
    for (let tries = 0; tries < 300 && !placed; tries++) {
      const t = rng.int(lowest, 9);
      const s = rng.int(i === digits - 1 ? 1 : 0, 9);
      const effective = t - borrowIn;
      if (borrowOut ? effective < s : effective >= s) {
        top[i] = t;
        bottom[i] = s;
        placed = true;
      }
    }
    if (!placed) throw new Error("subtractionWithBorrows: no digits fit");
    borrowIn = borrowOut ? 1 : 0;
  }
  return [fromColumns(top), fromColumns(bottom)];
}

const pickColumns = (rng: Rng, digits: number, count: number): number[] =>
  rng.sample(
    Array.from({ length: digits - 1 }, (_, i) => i),
    Math.min(count, digits - 1),
  );

/** Digit-by-digit sum with no carrying: what a learner gets who forgets to carry. */
export function sumWithoutCarrying(a: number, b: number): number {
  const x = columns(a);
  const y = columns(b);
  const out = Array.from(
    { length: Math.max(x.length, y.length) },
    (_, i) => ((x[i] ?? 0) + (y[i] ?? 0)) % 10,
  );
  return fromColumns(out);
}

/** Digit-by-digit difference taking the smaller from the larger in every column. */
export function differenceSmallerFromLarger(a: number, b: number): number {
  const x = columns(a);
  const y = columns(b);
  const out = x.map((d, i) => Math.abs(d - (y[i] ?? 0)));
  return fromColumns(out);
}

const nonNegative = (wrongs: Wrong[]): Wrong[] =>
  wrongs.filter((w) => Number(w.answer) >= 0 && Number.isFinite(Number(w.answer)));

// ── addition ────────────────────────────────────────────────────────────────────────────────────

export const addWhole = defineTemplate({
  id: "ops.add-whole",
  description: "Add whole numbers with a controlled number of carries; basic addition facts.",
  covers: (o) =>
    scoped(o, {
      topic: OPS,
      strand: ADD,
      text: /^(?:add |demonstrate an understanding of basic addition)/i,
      not: /law|commutative|associative/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const t = o.text.toLowerCase();
    if (/basic addition facts/.test(t)) {
      const tens = d >= 3;
      const a = rng.int(tens ? 3 : 6, 9) * (tens ? 10 : 1) + (d >= 4 ? rng.int(1, 9) * 100 : 0);
      const b = rng.int(tens ? 3 : 6, 9) * (tens ? 10 : 1);
      const answer = a + b;
      return q.numeric({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Work out ${fmtInt(a)} + ${fmtInt(b)}.`,
        answer: String(answer),
        wrongs: nonNegative([
          { answer: String(answer - 1), tag: "BASIC_FACT_ERROR" },
          { answer: String(answer + 1), tag: "BASIC_FACT_ERROR" },
          { answer: String(answer - (tens ? 10 : 2)), tag: "BASIC_FACT_ERROR" },
        ]),
        explanation: `${fmtInt(a)} + ${fmtInt(b)} = ${fmtInt(answer)}.`,
        hints: [
          "Use a fact you know well, like a double: 7 + 7 = 14.",
          tens
            ? "Add the tens, then think of the zeros that come with them."
            : "Make a ten first, then add what is left.",
        ],
      });
    }
    const digits = Math.min(wholeDigitsFor(o.grade, d), String(GRADE_MAX[o.grade]!).length - 1);
    const carries = /without carrying/.test(t)
      ? 0
      : /once/.test(t)
        ? 1
        : /twice/.test(t)
          ? 2
          : /up to 2 times/.test(t)
            ? rng.int(0, 2)
            : Math.min(digits - 1, byLevel(d, [0, 1, 2, 3, 4]) + (rng.chance(0.3) ? 1 : 0));
    const [a, b] = addendsWithCarries(rng, Math.max(2, digits), carries);
    const sum = a + b;
    const noCarry = sumWithoutCarrying(a, b);
    const onesA = columns(a)[0]!;
    const onesB = columns(b)[0]!;
    const wrongs = nonNegative([
      ...(noCarry !== sum ? [{ answer: String(noCarry), tag: "CARRYING_ERROR" }] : []),
      ...(sum - 10 > 0 && noCarry !== sum - 10 && carries > 0
        ? [{ answer: String(sum - 10), tag: "CARRYING_ERROR" }]
        : []),
      { answer: String(sum + 1), tag: "BASIC_FACT_ERROR" },
      { answer: String(sum - 1), tag: "BASIC_FACT_ERROR" },
      { answer: String(sum + 10), tag: "CARRYING_ERROR" },
    ]);
    const common = {
      skill: "APPLICATION" as const,
      explanation: `Add column by column from the right${carries > 0 ? ", carrying when a column makes 10 or more" : ""}: ${fmtInt(a)} + ${fmtInt(b)} = ${fmtInt(sum)}.`,
      hints: [
        "Write the numbers under each other: ones under ones, tens under tens …",
        "Start with the ones column. If a column adds to 10 or more, write the ones digit and carry the tens digit to the next column.",
        `The ones column: ${onesA} + ${onesB}.`,
      ],
    };
    if (d <= 1 && wrongs.length >= 2)
      return q.mcq({
        ...common,
        stem: `What is ${fmtInt(a)} + ${fmtInt(b)}?`,
        correct: fmtInt(sum),
        wrongs: wrongs.map((w) => ({ ...w, answer: fmtInt(Number(w.answer)) })),
      });
    return q.numeric({
      ...common,
      stem: `Work out ${fmtInt(a)} + ${fmtInt(b)}.`,
      answer: String(sum),
      wrongs,
    });
  },
});

export const additionLaws = defineTemplate({
  id: "ops.add-laws",
  description: "The commutative and associative laws of addition.",
  covers: (o) => scoped(o, { topic: OPS, strand: ADD, text: /commutative|associative/i }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const associative = /associative/i.test(o.text);
    const max = Math.min(GRADE_MAX[o.grade]! / 10, byLevel(d, [20, 100, 500, 5000, 50000]));
    const make = () => rng.int(Math.max(2, Math.floor(max / 10)), max);
    if (!associative || rng.chance(0.4)) {
      const a = make();
      const b = make();
      if (d <= 2) {
        const left = `${fmtInt(a)} + ${fmtInt(b)}`;
        return q.mcq({
          skill: "KNOWLEDGE_COMPREHENSION",
          stem: "Which statement shows that addition is commutative (the order does not matter)?",
          correct: `${left} = ${fmtInt(b)} + ${fmtInt(a)}`,
          wrongs: [
            { answer: `${left} = ${fmtInt(a)} − ${fmtInt(b)}` },
            { answer: `${left} = ${fmtInt(a)} + ${fmtInt(b)} + ${fmtInt(a)}` },
            { answer: `${left} + 0 = ${left}` },
          ],
          explanation: `The commutative law says a + b = b + a. So ${left} = ${fmtInt(b)} + ${fmtInt(a)}.`,
          hints: [
            "Commutative means we may swap the numbers.",
            "Look for the statement where the same two numbers are added in the opposite order.",
          ],
        });
      }
      return q.numeric({
        skill: "KNOWLEDGE_COMPREHENSION",
        type: "FILL_IN_THE_BLANK",
        stem: `Fill in the missing number:  ${fmtInt(a)} + ${fmtInt(b)} = ${fmtInt(b)} + ___`,
        answer: String(a),
        wrongs: [{ answer: String(b) }, { answer: String(a + b) }],
        explanation: `Addition is commutative: the order of the numbers does not change the sum. ${fmtInt(a)} + ${fmtInt(b)} = ${fmtInt(b)} + ${fmtInt(a)}.`,
        hints: [
          "The commutative law lets us swap the two numbers.",
          "Which number is not yet on the right-hand side?",
        ],
      });
    }
    // associative: make a friendly total by regrouping
    const tens = rng.pick([10, 100, 1000].filter((v) => v <= Math.max(10, max)));
    const a = rng.int(2, tens - 2);
    const b = tens - a;
    const c = make();
    if (d <= 3) {
      return q.numeric({
        skill: "APPLICATION",
        type: "FILL_IN_THE_BLANK",
        stem: `Fill in the missing number:  (${fmtInt(a)} + ${fmtInt(b)}) + ${fmtInt(c)} = ${fmtInt(a)} + (___ + ${fmtInt(c)})`,
        answer: String(b),
        wrongs: [{ answer: String(a) }, { answer: String(c) }],
        explanation: `The associative law lets us group the numbers differently: (${fmtInt(a)} + ${fmtInt(b)}) + ${fmtInt(c)} = ${fmtInt(a)} + (${fmtInt(b)} + ${fmtInt(c)}).`,
        hints: [
          "The associative law changes the brackets, not the order of the numbers.",
          "The numbers keep their order: the second number must move into the new bracket.",
        ],
      });
    }
    return q.numeric({
      skill: "APPLICATION",
      stem: `Use the laws of addition to work out ${fmtInt(a)} + ${fmtInt(c)} + ${fmtInt(b)} in an easy way.`,
      answer: String(a + b + c),
      wrongs: nonNegative([
        { answer: String(a + b + c + 10), tag: "CARRYING_ERROR" },
        { answer: String(a + b + c - 10), tag: "CARRYING_ERROR" },
      ]),
      explanation: `Group the numbers that make ${fmtInt(tens)}: (${fmtInt(a)} + ${fmtInt(b)}) + ${fmtInt(c)} = ${fmtInt(tens)} + ${fmtInt(c)} = ${fmtInt(a + b + c)}.`,
      hints: [
        "You may add the numbers in any order and group them any way you like.",
        `Look for two numbers that make a round number such as ${fmtInt(tens)}.`,
      ],
    });
  },
});

// ── subtraction ─────────────────────────────────────────────────────────────────────────────────

export const subtractWhole = defineTemplate({
  id: "ops.subtract-whole",
  description: "Subtract whole numbers with a controlled number of borrows.",
  covers: (o) =>
    scoped(o, {
      topic: OPS,
      strand: SUB,
      text: /^subtract (?:numbers|whole numbers)/i,
      not: /equal addition/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const digits = Math.max(
      2,
      Math.min(wholeDigitsFor(o.grade, d), String(GRADE_MAX[o.grade]!).length - 1),
    );
    const borrows = Math.min(
      digits - 1,
      byLevel(d, [0, 1, 1, 2, 3]) + (d >= 4 && rng.chance(0.3) ? 1 : 0),
    );
    const borrowColumns = pickColumns(rng, digits, borrows);
    const [top, bottom] = subtractionWithBorrows(rng, digits, borrowColumns);
    const answer = top - bottom;
    const wrongs = nonNegative([
      ...(differenceSmallerFromLarger(top, bottom) !== answer
        ? [{ answer: String(differenceSmallerFromLarger(top, bottom)), tag: "BORROWING_ERROR" }]
        : []),
      ...borrowColumns
        .slice(0, 1)
        .map((c) => ({ answer: String(answer + 10 ** (c + 1)), tag: "BORROWING_ERROR" })),
      { answer: String(answer + 1), tag: "BASIC_FACT_ERROR" },
      { answer: String(answer - 1), tag: "BASIC_FACT_ERROR" },
    ]);
    const common = {
      skill: "APPLICATION" as const,
      explanation: `Subtract column by column from the right${borrows > 0 ? ", borrowing 1 from the next column when the top digit is too small" : ""}: ${fmtInt(top)} − ${fmtInt(bottom)} = ${fmtInt(answer)}.`,
      hints: [
        "Write the numbers under each other: ones under ones, tens under tens …",
        "Start with the ones column. If the top digit is smaller than the bottom digit, borrow 1 from the next column (it becomes 10 here).",
        "After borrowing, the digit you borrowed from is now 1 less. Do not forget to reduce it.",
      ],
    };
    if (d <= 1)
      return q.mcq({
        ...common,
        stem: `What is ${fmtInt(top)} − ${fmtInt(bottom)}?`,
        correct: fmtInt(answer),
        wrongs: wrongs.map((w) => ({ ...w, answer: fmtInt(Number(w.answer)) })),
      });
    return q.numeric({
      ...common,
      stem: `Work out ${fmtInt(top)} − ${fmtInt(bottom)}.`,
      answer: String(answer),
      wrongs,
    });
  },
});

export const equalAdditions = defineTemplate({
  id: "ops.equal-additions",
  description: "Subtract by the method of equal additions.",
  covers: (o) => scoped(o, { topic: OPS, strand: SUB, text: /equal addition/i }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const maxSteps = /one to three/.test(o.text) ? 3 : /one or two/.test(o.text) ? 2 : 1;
    const steps = Math.min(maxSteps, byLevel(d, [1, 1, 2, 3, 3]), maxSteps);
    const digits = Math.max(
      steps + 1,
      Math.min(wholeDigitsFor(o.grade, d), String(GRADE_MAX[o.grade]!).length - 1),
    );
    const [top, bottom] = subtractionWithBorrows(
      rng,
      digits,
      Array.from({ length: steps }, (_, i) => i),
    );
    const added = Number("1".repeat(steps) + "0"); // 10, 110, 1110
    const answer = top - bottom;
    const blank = bottom + added;
    const mode = d <= 3 ? "fill" : "work";
    if (mode === "fill") {
      return q.numeric({
        skill: "APPLICATION",
        type: "FILL_IN_THE_BLANK",
        stem: `Equal additions keep the difference the same. Fill in the missing number:  ${fmtInt(top)} − ${fmtInt(bottom)} = ${fmtInt(top + added)} − ___`,
        answer: String(blank),
        wrongs: nonNegative([
          { answer: String(bottom + added / 10) },
          { answer: String(bottom + added * 10) },
          { answer: String(top + added) },
        ]),
        explanation: `${fmtInt(added)} was added to ${fmtInt(top)}. The same amount must be added to ${fmtInt(bottom)}: ${fmtInt(bottom)} + ${fmtInt(added)} = ${fmtInt(blank)}.`,
        hints: [
          "With equal additions we add the SAME amount to both numbers, so the difference stays the same.",
          `How much was added to ${fmtInt(top)}?`,
          "Add that same amount to the second number.",
        ],
      });
    }
    return q.numeric({
      skill: "APPLICATION",
      stem: `Use equal additions to work out ${fmtInt(top)} − ${fmtInt(bottom)}.`,
      answer: String(answer),
      wrongs: nonNegative([
        { answer: String(differenceSmallerFromLarger(top, bottom)), tag: "BORROWING_ERROR" },
        { answer: String(answer + added / 10), tag: "BORROWING_ERROR" },
        { answer: String(answer - 1), tag: "BASIC_FACT_ERROR" },
      ]),
      explanation: `Add ${fmtInt(added)} to both numbers: ${fmtInt(top + added)} − ${fmtInt(blank)} = ${fmtInt(answer)}. The difference does not change.`,
      hints: [
        "Add 10 to the top number's ones digit and 1 to the bottom number's tens digit so that the ones column can be subtracted.",
        "Do the same in the next column if it is too small.",
        "Subtract the new numbers column by column.",
      ],
    });
  },
});

// ── multiplication ──────────────────────────────────────────────────────────────────────────────

export const repeatedAddition = defineTemplate({
  id: "ops.repeated-addition",
  description: "Multiplication as repeated addition.",
  covers: (o) => scoped(o, { topic: OPS, strand: MUL, text: /repeated addition/i }),
  generate: ({ difficulty: d, rng, q }) => {
    const a = rng.int(2, byLevel(d, [5, 6, 9, 12, 15]));
    const n = rng.int(2, byLevel(d, [4, 5, 7, 8, 10]));
    const sum = Array.from({ length: n }, () => String(a)).join(" + ");
    const mode =
      d <= 2 ? rng.pick(["mcq", "count"] as const) : rng.pick(["count", "total", "count"] as const);
    if (mode === "mcq") {
      return q.mcq({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Which multiplication is the same as ${sum}?`,
        correct: `${n} × ${a}`,
        wrongs: [
          { answer: `${a} × ${a}`, tag: "OPERATION_CHOICE_ERROR" },
          { answer: `${n} + ${a}`, tag: "OPERATION_CHOICE_ERROR" },
          { answer: `${n * a} × ${a}` },
        ],
        explanation: `${sum} adds ${a} a total of ${n} times, which is ${n} × ${a} = ${n * a}.`,
        hints: [
          "Multiplication is repeated addition: count how many times the number is added.",
          "The number being added again and again is the one that is repeated.",
        ],
      });
    }
    if (mode === "count") {
      return q.numeric({
        skill: "KNOWLEDGE_COMPREHENSION",
        type: "FILL_IN_THE_BLANK",
        stem: `${sum} = ___ × ${a}`,
        answer: String(n),
        wrongs: [{ answer: String(n * a) }, { answer: String(a) }, { answer: String(n + 1) }],
        explanation: `The number ${a} is added ${n} times, so ${sum} = ${n} × ${a}.`,
        hints: [
          "Count how many times the number is added.",
          "That count is the number you multiply by.",
        ],
      });
    }
    return q.numeric({
      skill: "APPLICATION",
      stem: `Write ${n} × ${a} as repeated addition and work out the total.`,
      answer: String(n * a),
      wrongs: nonNegative([
        { answer: String(n + a), tag: "OPERATION_CHOICE_ERROR" },
        { answer: String(n * a + a), tag: "BASIC_FACT_ERROR" },
        { answer: String(n * a - a), tag: "BASIC_FACT_ERROR" },
      ]),
      explanation: `${n} × ${a} means ${a} added ${n} times: ${sum} = ${n * a}.`,
      hints: [
        `${n} × ${a} means ${a} is added ${n} times.`,
        `Write ${a} down ${n} times with + between them, then add.`,
      ],
    });
  },
});

export const multiplicationFacts = defineTemplate({
  id: "ops.times-facts",
  description: "Multiplication facts and missing factors.",
  covers: (o) => scoped(o, { topic: OPS, strand: MUL, text: /facts|basic multiplication/i }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const top = o.grade === 4 ? 9 : 12;
    const a = rng.int(byLevel(d, [2, 2, 3, 6, 7]), top);
    const b = rng.int(byLevel(d, [2, 2, 3, 6, 7]), top);
    const product = a * b;
    const mode = d <= 2 ? "mcq" : d === 3 ? "plain" : rng.pick(["plain", "missing"] as const);
    const wrongs: Wrong[] = [
      { answer: String(product + a), tag: "BASIC_FACT_ERROR" },
      { answer: String(product - a), tag: "BASIC_FACT_ERROR" },
      { answer: String(product + b), tag: "BASIC_FACT_ERROR" },
      { answer: String(product - b), tag: "BASIC_FACT_ERROR" },
      { answer: String(a + b), tag: "OPERATION_CHOICE_ERROR" },
    ];
    const hints = [
      `Think of ${b} groups of ${a}, or ${a} groups of ${b}.`,
      `Build it from a fact you know well, for example ${a} × ${b > 5 ? b - 5 : b - 1} and then add ${b > 5 ? 5 : 1} more group${b > 5 ? "s" : ""} of ${a}.`,
    ];
    if (mode === "mcq")
      return q.mcq({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `What is ${a} × ${b}?`,
        correct: String(product),
        wrongs,
        explanation: `${a} × ${b} = ${product}.`,
        hints,
      });
    if (mode === "missing")
      return q.numeric({
        skill: "KNOWLEDGE_COMPREHENSION",
        type: "FILL_IN_THE_BLANK",
        stem: `${a} × ___ = ${product}`,
        answer: String(b),
        wrongs: [{ answer: String(product - a) }, { answer: String(a) }, { answer: String(b + 1) }],
        explanation: `${a} × ${b} = ${product}, so the missing number is ${b}.`,
        hints: [
          "How many times does the first number go into the product?",
          `Count up in ${a}s until you reach ${product}.`,
        ],
      });
    return q.numeric({
      skill: "KNOWLEDGE_COMPREHENSION",
      stem: `Work out ${a} × ${b}.`,
      answer: String(product),
      wrongs,
      explanation: `${a} × ${b} = ${product}.`,
      hints,
    });
  },
});

/** Multiplicand digits that keep every digit-times-multiplier below 10 (no carrying). */
function multiplyWithoutCarry(rng: Rng, digits: number, m: number): number {
  const top = Math.floor(9 / m);
  return Number(
    Array.from({ length: digits }, (_, i) => rng.int(i === 0 ? 1 : 0, Math.max(1, top))).join(""),
  );
}

export const multiplyByDigit = defineTemplate({
  id: "ops.multiply-digit",
  description: "Multiply by a one-digit number, with or without carrying.",
  covers: (o) =>
    scoped(o, {
      topic: OPS,
      strand: MUL,
      text: /one digit multiplier|multiply where carrying/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const carrying = /carrying is involved/i.test(o.text);
    const limit = o.grade === 3 ? 500 : 1000;
    let a = 0;
    let m = 0;
    for (let tries = 0; tries < 400; tries++) {
      m = rng.int(2, byLevel(d, [3, 5, 6, 8, 9]));
      const digits = d <= 2 ? 2 : 3;
      a = carrying
        ? rng.int(10 ** (digits - 1), 10 ** digits - 1)
        : multiplyWithoutCarry(rng, digits, m);
      const hasCarry = columns(a).some((x) => x * m >= 10);
      if (a * m <= limit && a * m >= 2 * m && hasCarry === carrying) break;
      if (tries === 399) throw new Error("multiplyByDigit: no suitable numbers");
    }
    const product = a * m;
    const noCarry = fromColumns(columns(a).map((x) => (x * m) % 10));
    const wrongs = nonNegative([
      ...(noCarry !== product ? [{ answer: String(noCarry), tag: "CARRYING_ERROR" }] : []),
      { answer: String(product + m), tag: "BASIC_FACT_ERROR" },
      { answer: String(product - m), tag: "BASIC_FACT_ERROR" },
      { answer: String(product + 10), tag: "CARRYING_ERROR" },
    ]);
    const common = {
      skill: "APPLICATION" as const,
      explanation: `Multiply each digit by ${m}, starting with the ones${carrying ? " and carrying when the answer is 10 or more" : ""}: ${fmtInt(a)} × ${m} = ${fmtInt(product)}.`,
      hints: [
        "Write the number with the multiplier under it. Multiply the ones digit first.",
        carrying
          ? "If a product is 10 or more, write the ones digit and carry the tens digit to the next column; add it after you multiply that column."
          : "Multiply each digit in turn; each answer is a single digit, so nothing needs to be carried.",
        `The ones column: ${columns(a)[0]} × ${m}.`,
      ],
    };
    if (d <= 1)
      return q.mcq({
        ...common,
        stem: `What is ${fmtInt(a)} × ${m}?`,
        correct: String(product),
        wrongs: wrongs.map((w) => ({ ...w })),
      });
    return q.numeric({
      ...common,
      stem: `Work out ${fmtInt(a)} × ${m}.`,
      answer: String(product),
      wrongs,
    });
  },
});

export const multiplyByTens = defineTemplate({
  id: "ops.multiply-tens",
  description: "Multiply by multiples of 10.",
  covers: (o) => scoped(o, { topic: OPS, strand: MUL, text: /multiples of 10/i }),
  generate: ({ difficulty: d, rng, q }) => {
    const m = rng.int(1, 10) * 10;
    const a = rng.int(byLevel(d, [2, 11, 12, 21, 31]), byLevel(d, [9, 30, 45, 49, 49]));
    const answer = a * m;
    return q.numeric({
      skill: "APPLICATION",
      stem: `Work out ${fmtInt(a)} × ${m}.`,
      answer: String(answer),
      wrongs: nonNegative([
        { answer: String(answer / 10), tag: "MULTIPLICATION_PLACE_ERROR" },
        { answer: String(answer * 10), tag: "MULTIPLICATION_PLACE_ERROR" },
        { answer: String(answer + a), tag: "BASIC_FACT_ERROR" },
      ]),
      explanation: `${m} is ${m / 10} × 10. First work out ${fmtInt(a)} × ${m / 10} = ${fmtInt(a * (m / 10))}, then multiply by 10 by adding a zero: ${fmtInt(answer)}.`,
      hints: [
        `${m} is a multiple of 10. Multiply by ${m / 10} first.`,
        "Then multiply the answer by 10: every digit moves one place to the left and a 0 goes in the ones place.",
      ],
    });
  },
});

export const multiplyLong = defineTemplate({
  id: "ops.multiply-long",
  description: "Long and short multiplication by two- and three-digit numbers.",
  covers: (o) =>
    scoped(o, {
      topic: OPS,
      strand: MUL,
      text: /two-digit numbers|up to two-digit|short and long|long and short|three-digit/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const limit = ({ 5: 5000, 6: 10000, 7: 100000 } as Record<number, number>)[o.grade]!;
    const bDigits = o.grade === 7 && d >= 3 ? 3 : 2;
    let a = 0;
    let b = 0;
    for (let tries = 0; ; tries++) {
      if (tries > 500) throw new Error("multiplyLong: no suitable numbers");
      b = bDigits === 3 ? rng.int(101, 999) : d <= 2 ? rng.int(11, 29) : rng.int(12, 99);
      if (b % 10 === 0) continue;
      const aDigits = o.grade === 5 ? (d <= 3 ? 2 : 3) : d <= 2 ? 2 : 3;
      const aMax = Math.min(10 ** aDigits - 1, Math.floor((limit - 1) / b));
      const aMin = 10 ** (aDigits - 1);
      if (aMax < aMin) continue;
      a = rng.int(aMin, aMax);
      if (a % 10 !== 0) break;
    }
    const product = a * b;
    const bCols = columns(b);
    const partials = bCols.map((digit, i) => a * digit * 10 ** i);
    // forgetting the place-holder zero(s): every partial product is written one place too low
    const noPlaceholder = bCols.reduce((sum, digit) => sum + a * digit, 0);
    const mistaken = bCols.reduce(
      (sum, digit, i) => sum + a * digit * (i === 0 ? 1 : 10 ** (i - 1)),
      0,
    );
    return q.numeric({
      skill: "APPLICATION",
      stem: `Use the long method to work out ${fmtInt(a)} × ${fmtInt(b)}.`,
      answer: String(product),
      wrongs: nonNegative([
        { answer: String(noPlaceholder), tag: "MULTIPLICATION_PLACE_ERROR" },
        ...(mistaken !== product && mistaken !== noPlaceholder
          ? [{ answer: String(mistaken), tag: "MULTIPLICATION_PLACE_ERROR" }]
          : []),
        { answer: String(product + a), tag: "BASIC_FACT_ERROR" },
        { answer: String(product - 10), tag: "CARRYING_ERROR" },
      ]),
      explanation: `${fmtInt(a)} × ${fmtInt(b)}: ${bCols
        .map((digit, i) => `${fmtInt(a)} × ${digit * 10 ** i} = ${fmtInt(partials[i]!)}`)
        .join(", ")}. Add them: ${fmtInt(product)}.`,
      solutionSteps: bCols.map(
        (digit, i) => `${fmtInt(a)} × ${digit}${"0".repeat(i)} = ${fmtInt(partials[i]!)}`,
      ),
      hints: [
        "Multiply by the ones digit of the bottom number first. Write the answer in the first row.",
        "Now multiply by the tens digit. This is really multiplying by tens, so write a 0 in the ones place of the second row first.",
        "Add the rows together.",
      ],
    });
  },
});

// ── factors, multiples, HCF and LCM ─────────────────────────────────────────────────────────────

export const factorsAndMultiples = defineTemplate({
  id: "ops.factors-multiples",
  description: "Factors and multiples of whole numbers.",
  covers: (o) =>
    scoped(o, {
      topic: OPS,
      text: /identify factors|calculate factors|listing factors and multiples/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const limit = byLevel(d, [20, 36, 60, 100, 100]);
    const wantsMultiples = /multiples/i.test(o.text) && rng.chance(0.4);
    if (wantsMultiples) {
      const base = rng.int(3, byLevel(d, [6, 8, 9, 12, 15]));
      const seq = Array.from({ length: 5 }, (_, i) => base * (i + 1));
      return q.list({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Write down the first five multiples of ${base}.`,
        sequence: seq.map(String),
        answerHint: "Type the five numbers in order, with commas between them.",
        explanation: `The multiples of ${base} are found by counting in ${base}s: ${seq.join(", ")}.`,
        hints: [
          `A multiple of ${base} is a number in the ${base} times table.`,
          `Count on in ${base}s starting from ${base}.`,
        ],
      });
    }
    const n = rng.pick(
      Array.from({ length: limit - 5 }, (_, i) => i + 6).filter(
        (v) => divisors(v).length >= (d >= 3 ? 4 : 3) && divisors(v).length <= 10,
      ),
    );
    const factors = divisors(n);
    const mode = d <= 2 ? "pick" : rng.pick(["pick", "list", "count", "pick"] as const);
    if (mode === "list")
      return q.list({
        skill: "APPLICATION",
        stem: `List all the factors of ${n}, smallest first.`,
        sequence: factors.map(String),
        answerHint: "Type the factors in order, with commas between them.",
        explanation: `The factors of ${n} are ${joinWords(factors.map(String))}. They pair up: ${factors
          .slice(0, Math.ceil(factors.length / 2))
          .map((f) => `${f} × ${n / f}`)
          .join(", ")}.`,
        hints: [
          "A factor divides the number exactly with nothing left over. Start with 1.",
          "Try 1, 2, 3, 4 … in turn. Each time one divides exactly, write down the pair.",
          `Stop when the numbers in the pairs meet in the middle.`,
        ],
      });
    if (mode === "count")
      return q.numeric({
        skill: "APPLICATION",
        stem: `How many factors does ${n} have?`,
        answer: String(factors.length),
        wrongs: [
          { answer: String(factors.length - 1) },
          { answer: String(factors.length + 1) },
          { answer: String(Math.floor(factors.length / 2)) },
        ],
        explanation: `The factors of ${n} are ${joinWords(factors.map(String))}: that is ${factors.length} factors.`,
        hints: [
          "List the pairs of numbers that multiply to give the number.",
          "Do not forget 1 and the number itself.",
        ],
      });
    const nonFactors = Array.from({ length: n * 2 }, (_, i) => i + 2).filter((v) => n % v !== 0);
    const multiplesOfN = [n * 2, n * 3].filter((v) => v <= 200);
    const correct = rng.pick(
      factors.filter((f) => f > 1 && f < n).concat(factors.length === 2 ? [n] : []),
    );
    return q.mcq({
      skill: "KNOWLEDGE_COMPREHENSION",
      stem: `Which of these is a factor of ${n}?`,
      correct: String(correct),
      wrongs: [
        { answer: String(multiplesOfN[0]), tag: "HCF_LCM_CONFUSION" },
        ...rng
          .sample(
            nonFactors.filter((v) => v < n),
            2,
          )
          .map((v) => ({ answer: String(v) })),
      ],
      explanation: `${n} ÷ ${correct} = ${n / correct} with nothing left over, so ${correct} is a factor of ${n}. A factor goes INTO the number; a multiple comes OUT of the times table.`,
      hints: [
        "A factor is a number that divides exactly into the given number.",
        `Divide ${n} by each choice. Which one leaves nothing over?`,
        `Do not choose a number bigger than ${n}: factors cannot be bigger than the number.`,
      ],
    });
  },
});

interface HcfLcmCase {
  a: number;
  b: number;
  hcf: number;
  lcm: number;
}

export function hcfLcmCase(
  rng: Rng,
  kind: "hcf" | "lcm",
  limit: number,
  maxNumber: number,
): HcfLcmCase {
  for (let tries = 0; tries < 2000; tries++) {
    const a = rng.int(2, maxNumber);
    const b = rng.int(2, maxNumber);
    if (a === b || a % b === 0 || b % a === 0) continue;
    const h = gcd(a, b);
    const l = lcm(a, b);
    if (kind === "hcf" ? h < limit && h > 1 : l < limit) return { a, b, hcf: h, lcm: l };
  }
  throw new Error("hcfLcmCase: none found");
}

export const hcfLcm = defineTemplate({
  id: "ops.hcf-lcm",
  description: "Highest common factor and lowest common multiple of two numbers.",
  covers: (o) =>
    scoped(o, {
      topic: OPS,
      text: /\bHCF\b|\bLCM\b/i,
      not: /listing/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const wantsHcf = /HCF/i.test(o.text);
    const limit = wantsHcf ? (o.grade === 7 ? 20 : 10) : o.grade >= 6 ? 100 : 50;
    const maxNumber = wantsHcf
      ? byLevel(d, [20, 30, 48, 72, 100])
      : byLevel(d, [8, 12, 16, 20, 25]);
    const { a, b, hcf, lcm: l } = hcfLcmCase(rng, wantsHcf ? "hcf" : "lcm", limit, maxNumber);
    const answer = wantsHcf ? hcf : l;
    const other = wantsHcf ? l : hcf;
    const word = wantsHcf ? "highest common factor (HCF)" : "lowest common multiple (LCM)";
    const wrongs: Wrong[] = [
      { answer: String(other), tag: "HCF_LCM_CONFUSION" },
      ...(wantsHcf
        ? [{ answer: String(Math.min(a, b)) }, { answer: String(hcf * 2) }]
        : [{ answer: String(a * b) }, { answer: String(Math.max(a, b)) }]),
    ];
    const fa = divisors(a);
    const fb = divisors(b);
    const ma = Array.from({ length: 5 }, (_, i) => a * (i + 1));
    const mb = Array.from({ length: 5 }, (_, i) => b * (i + 1));
    return q.numeric({
      skill: "APPLICATION",
      stem: `Find the ${word} of ${a} and ${b}.`,
      answer: String(answer),
      wrongs: wrongs.filter((w) => Number(w.answer) !== answer),
      explanation: wantsHcf
        ? `Factors of ${a}: ${fa.join(", ")}. Factors of ${b}: ${fb.join(", ")}. The biggest factor in both lists is ${hcf}.`
        : `Multiples of ${a}: ${ma.join(", ")} … Multiples of ${b}: ${mb.join(", ")} … The first number in both lists is ${l}.`,
      hints: wantsHcf
        ? [
            "A factor divides the number exactly. List the factors of each number.",
            "Look for the factors that appear in BOTH lists.",
            "The HCF is the biggest of those common factors.",
          ]
        : [
            "A multiple is in the times table of the number. List the first few multiples of each number.",
            "Look for the multiples that appear in BOTH lists.",
            "The LCM is the smallest of those common multiples.",
          ],
    });
  },
});

// ── division ────────────────────────────────────────────────────────────────────────────────────

export const shareEqually = defineTemplate({
  id: "ops.share-equally",
  description: "Share equally without a remainder (division facts in context).",
  covers: (o) => scoped(o, { topic: OPS, strand: DIV, text: /share equally/i }),
  generate: ({ difficulty: d, rng, q, local }) => {
    const groups = rng.int(2, byLevel(d, [4, 5, 7, 9, 10]));
    const each = rng.int(2, byLevel(d, [5, 8, 10, 10, 10]));
    const total = groups * each;
    const name = rng.pick(["Tendai", "Rudo", "Farai", "Chipo", "Nyasha"]);
    const item = local
      ? rng.pick(["mangoes", "oranges", "maize cobs", "eggs"])
      : rng.pick(["sweets", "pencils", "stickers", "counters"]);
    return q.numeric({
      skill: "APPLICATION",
      type: "WORD_PROBLEM",
      stem: `${name} has ${total} ${item}. ${name} shares them equally among ${groups} children. How many ${item} does each child get?`,
      answer: String(each),
      wrongs: nonNegative([
        { answer: String(total - groups), tag: "OPERATION_CHOICE_ERROR" },
        { answer: String(total + groups), tag: "OPERATION_CHOICE_ERROR" },
        { answer: String(total * groups), tag: "OPERATION_CHOICE_ERROR" },
        { answer: String(each + 1), tag: "BASIC_FACT_ERROR" },
      ]),
      usesLocalContext: local,
      explanation: `Sharing equally is division: ${total} ÷ ${groups} = ${each}. Each child gets ${each} ${item}.`,
      hints: [
        "Sharing equally means dividing.",
        `Think: ${groups} times what number makes ${total}?`,
        "Or deal the items out one at a time to each child, like dealing cards.",
      ],
    });
  },
});

export const repeatedSubtraction = defineTemplate({
  id: "ops.repeated-subtraction",
  description: "Division as repeated subtraction.",
  covers: (o) => scoped(o, { topic: OPS, strand: DIV, text: /repeated subtraction/i }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const divisor = rng.int(
      2,
      o.grade === 3 ? byLevel(d, [4, 5, 6, 8, 9]) : byLevel(d, [9, 12, 15, 20, 25]),
    );
    const times = rng.int(3, byLevel(d, [5, 6, 8, 9, 10]));
    const total = divisor * times;
    const withRemainder = d >= 4 && o.grade >= 5 && rng.chance(0.4);
    const remainder = withRemainder ? rng.int(1, divisor - 1) : 0;
    const start = total + remainder;
    if (withRemainder) {
      return q.multiPart({
        skill: "APPLICATION",
        type: "WORKED_CALCULATION",
        stem: `Take ${divisor} away from ${start} again and again until you cannot take away any more. How many times did you take ${divisor} away, and what is left?`,
        parts: [
          {
            id: "times",
            label: `Times ${divisor} was taken away`,
            answer: String(times),
            wrongs: [{ answer: String(times + 1), tag: "DIVISION_REMAINDER_ERROR" }],
          },
          {
            id: "left",
            label: "Left over",
            answer: String(remainder),
            wrongs: [{ answer: String(divisor - remainder), tag: "DIVISION_REMAINDER_ERROR" }],
          },
        ],
        explanation: `${start} − ${divisor} − ${divisor} … taken ${times} times leaves ${remainder}. So ${start} ÷ ${divisor} = ${times} remainder ${remainder}.`,
        hints: [
          `Subtract ${divisor} from ${start}, then subtract ${divisor} again from what is left.`,
          "Count how many times you subtract. Stop when what is left is smaller than the number you are subtracting.",
        ],
      });
    }
    return q.numeric({
      skill: "KNOWLEDGE_COMPREHENSION",
      stem: `How many times can ${divisor} be taken away from ${start} until nothing is left?`,
      answer: String(times),
      wrongs: nonNegative([
        { answer: String(times + 1), tag: "BASIC_FACT_ERROR" },
        { answer: String(times - 1), tag: "BASIC_FACT_ERROR" },
        { answer: String(start - divisor), tag: "OPERATION_CHOICE_ERROR" },
      ]),
      explanation: `${start} − ${divisor} − ${divisor} … after ${times} times nothing is left. So ${start} ÷ ${divisor} = ${times}.`,
      hints: [
        `Take ${divisor} away from ${start}, then take ${divisor} away again, and keep a tally.`,
        "Repeated subtraction is the same as dividing.",
      ],
    });
  },
});

interface DivisionCase {
  divisor: number;
  quotient: number;
  remainder: number;
  dividend: number;
}

function divisionCase(
  rng: Rng,
  grade: number,
  objectiveText: string,
  difficulty: Difficulty,
): DivisionCase {
  const t = objectiveText.toLowerCase();
  const limit = ({ 4: 1000, 5: 10000, 6: 10000, 7: 100000 } as Record<number, number>)[grade]!;
  const between = (lo: number, hi: number) => rng.int(lo, Math.max(lo, hi));
  for (let tries = 0; tries < 1000; tries++) {
    let divisor: number;
    let quotient: number;
    let remainder = 0;
    if (grade === 4) {
      divisor = rng.int(2, byLevel(difficulty, [5, 6, 8, 9, 9]));
      quotient = between(
        byLevel(difficulty, [3, 10, 20, 50, 100]),
        Math.floor(limit / divisor) - 1,
      );
      if (difficulty >= 3 && rng.chance(0.5)) remainder = rng.int(1, divisor - 1);
    } else if (grade === 5) {
      // divisor and dividend are multiples of 10 (and so is any remainder)
      divisor = rng.int(1, 9) * 10;
      quotient = between(
        byLevel(difficulty, [2, 5, 10, 20, 40]),
        Math.min(byLevel(difficulty, [9, 30, 60, 120, 250]), Math.floor(limit / divisor) - 1),
      );
      if (/remainders/.test(t)) remainder = rng.int(1, divisor / 10 - 1) * 10;
    } else if (grade === 6) {
      divisor = between(
        byLevel(difficulty, [11, 12, 13, 21, 31]),
        byLevel(difficulty, [19, 30, 45, 60, 99]),
      );
      quotient = between(byLevel(difficulty, [3, 10, 20, 30, 60]), Math.floor(limit / divisor) - 1);
      if (difficulty >= 3 && rng.chance(0.5)) remainder = rng.int(1, divisor - 1);
    } else {
      divisor = between(
        byLevel(difficulty, [100, 110, 150, 200, 300]),
        byLevel(difficulty, [150, 250, 400, 600, 999]),
      );
      quotient = between(byLevel(difficulty, [3, 10, 20, 40, 70]), Math.floor(limit / divisor) - 1);
      if (difficulty >= 3 && rng.chance(0.4)) remainder = rng.int(1, divisor - 1);
    }
    if (remainder >= divisor || quotient < 2) continue;
    const dividend = quotient * divisor + remainder;
    if (dividend > limit) continue;
    return { divisor, quotient, remainder, dividend };
  }
  throw new Error("divisionCase: none found");
}

export const divideWhole = defineTemplate({
  id: "ops.divide-whole",
  description:
    "Divide whole numbers by one-, two- and three-digit divisors, with remainders where the grade has them.",
  covers: (o) =>
    scoped(o, {
      topic: OPS,
      strand: DIV,
      text: /^(?:divide|carry out division|demonstrate division using long method)/i,
      not: /repeated subtraction|share equally/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const { divisor, quotient, remainder, dividend } = divisionCase(rng, o.grade, o.text, d);
    const hints = [
      "Look at the first digits of the dividend. How many times does the divisor go into them?",
      "Write that digit in the answer. Multiply it by the divisor, subtract, and bring down the next digit.",
      "Keep going until all the digits have been brought down. What is left at the end is the remainder.",
    ];
    if (remainder === 0) {
      const zeroPlace = String(quotient).includes("0");
      return q.numeric({
        skill: "APPLICATION",
        stem: `Work out ${fmtInt(dividend)} ÷ ${divisor}.`,
        answer: String(quotient),
        wrongs: nonNegative([
          ...(zeroPlace
            ? [
                {
                  answer: String(Number(String(quotient).replace(/0/g, ""))),
                  tag: "ZERO_PLACEHOLDER_ERROR",
                },
              ]
            : []),
          { answer: String(quotient + 1), tag: "BASIC_FACT_ERROR" },
          { answer: String(quotient - 1), tag: "BASIC_FACT_ERROR" },
          { answer: String(quotient * 10), tag: "PLACE_VALUE_CONFUSION" },
        ]),
        explanation: `${fmtInt(dividend)} ÷ ${divisor} = ${fmtInt(quotient)}, because ${fmtInt(quotient)} × ${divisor} = ${fmtInt(dividend)}.`,
        hints: [
          ...hints.slice(0, 2),
          `Check your answer by multiplying it by ${divisor}: you should get back to ${fmtInt(dividend)}.`,
        ],
      });
    }
    return q.multiPart({
      skill: "APPLICATION",
      type: "WORKED_CALCULATION",
      stem: `Work out ${fmtInt(dividend)} ÷ ${divisor}. Give the quotient and the remainder.`,
      parts: [
        {
          id: "quotient",
          label: "Quotient",
          answer: String(quotient),
          wrongs: [
            { answer: String(quotient + 1), tag: "DIVISION_REMAINDER_ERROR" },
            { answer: String(quotient - 1), tag: "BASIC_FACT_ERROR" },
          ],
        },
        {
          id: "remainder",
          label: "Remainder",
          answer: String(remainder),
          wrongs: [
            { answer: String(divisor - remainder), tag: "DIVISION_REMAINDER_ERROR" },
            { answer: "0", tag: "DIVISION_REMAINDER_ERROR" },
          ].filter((w) => w.answer !== String(remainder)),
        },
      ],
      explanation: `${fmtInt(dividend)} ÷ ${divisor} = ${fmtInt(quotient)} remainder ${remainder}, because ${fmtInt(quotient)} × ${divisor} = ${fmtInt(quotient * divisor)} and ${fmtInt(quotient * divisor)} + ${remainder} = ${fmtInt(dividend)}.`,
      hints: [
        ...hints.slice(0, 2),
        `Check: quotient × ${divisor} + remainder should give back ${fmtInt(dividend)}.`,
      ],
    });
  },
});

// ── combined operations ─────────────────────────────────────────────────────────────────────────

interface Expr {
  text: string;
  value: number;
  leftToRight: number;
}

/** An expression with 2 or 3 operations, evaluated both correctly and strictly left to right. */
function combinedExpression(rng: Rng, operations: number, difficulty: Difficulty): Expr {
  for (let tries = 0; tries < 2000; tries++) {
    const nums = Array.from({ length: operations + 1 }, () =>
      rng.int(2, byLevel(difficulty, [9, 12, 15, 20, 30])),
    );
    const ops = Array.from({ length: operations }, () => rng.pick(["+", "−", "×", "÷"] as const));
    // there must be at least one × or ÷ and at least one + or −, so precedence matters
    const hasHigh = ops.some((o) => o === "×" || o === "÷");
    const hasLow = ops.some((o) => o === "+" || o === "−");
    if (!hasHigh || !hasLow) continue;
    // make every ÷ exact by making the dividend a multiple of the divisor
    for (let i = 0; i < ops.length; i++) {
      if (ops[i] === "÷") {
        const divisor = rng.int(2, 6);
        nums[i + 1] = divisor;
        nums[i] = divisor * rng.int(2, 9);
      }
    }
    // evaluate with precedence
    const toks: Array<number | string> = [];
    nums.forEach((n, i) => {
      toks.push(n);
      if (i < ops.length) toks.push(ops[i]!);
    });
    const reduce = (
      tokens: Array<number | string>,
      set: string[],
    ): Array<number | string> | null => {
      const out = [...tokens];
      for (let i = 1; i < out.length; i += 2) {
        if (set.includes(out[i] as string)) {
          const a = out[i - 1] as number;
          const b = out[i + 1] as number;
          const op = out[i] as string;
          let v: number;
          if (op === "×") v = a * b;
          else if (op === "÷") {
            if (b === 0 || a % b !== 0) return null;
            v = a / b;
          } else if (op === "+") v = a + b;
          else v = a - b;
          out.splice(i - 1, 3, v);
          i -= 2;
        }
      }
      return out;
    };
    const high = reduce(toks, ["×", "÷"]);
    if (!high) continue;
    const full = reduce(high, ["+", "−"]);
    if (!full || typeof full[0] !== "number") continue;
    const lr = reduce(toks, ["×", "÷", "+", "−"]);
    if (!lr || typeof lr[0] !== "number") continue;
    const value = full[0] as number;
    if (value < 0 || value > 1000) continue;
    if (difficulty >= 2 && lr[0] === value) continue; // left-to-right must give a different answer
    return { text: toks.join(" "), value, leftToRight: lr[0] as number };
  }
  throw new Error("combinedExpression: none found");
}

export const combinedOperations = defineTemplate({
  id: "ops.combined",
  description: "Combined operations using the order of operations (× and ÷ before + and −).",
  covers: (o) => scoped(o, { topic: OPS, strand: /^combined-operations$/ }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const operations = o.grade === 6 ? 2 : d <= 2 ? 2 : 3;
    const { text, value, leftToRight } = combinedExpression(rng, operations, d);
    return q.numeric({
      skill: "APPLICATION",
      stem: `Work out ${text}.`,
      answer: String(value),
      wrongs: nonNegative([
        ...(leftToRight !== value
          ? [{ answer: String(leftToRight), tag: "ORDER_OF_OPERATIONS_ERROR" }]
          : []),
        { answer: String(value + 1), tag: "BASIC_FACT_ERROR" },
        { answer: String(value - 1), tag: "BASIC_FACT_ERROR" },
      ]),
      explanation: `Multiplication and division come before addition and subtraction. Do those first, then add and subtract from left to right: ${text} = ${value}.`,
      hints: [
        "Do not work strictly from left to right. Multiplication and division come first.",
        "Underline the × and ÷ parts and work them out first.",
        "Then add and subtract the results from left to right.",
      ],
    });
  },
});

// ── word problems ───────────────────────────────────────────────────────────────────────────────

type Operation = "add" | "subtract" | "multiply" | "divide";

interface Context {
  local: boolean;
  /** Builds the question from the two numbers; the answer combines them with the operation. */
  text: (a: string, b: string) => string;
}

const CONTEXTS: Record<Operation, readonly Context[]> = {
  add: [
    {
      local: false,
      text: (a, b) =>
        `A library has ${a} story books and ${b} Mathematics books. How many books does it have altogether?`,
    },
    {
      local: false,
      text: (a, b) =>
        `A factory made ${a} bolts in the morning and ${b} bolts in the afternoon. How many bolts did it make in the day?`,
    },
    {
      local: true,
      text: (a, b) =>
        `A school has ${a} boys and ${b} girls. How many learners does it have altogether?`,
    },
    {
      local: true,
      text: (a, b) =>
        `A farmer harvested ${a} kg of maize in the first week and ${b} kg in the second week. How many kilograms did the farmer harvest altogether?`,
    },
    {
      local: true,
      text: (a, b) =>
        `A kombi carried ${a} passengers on Monday and ${b} passengers on Tuesday. How many passengers did it carry on the two days?`,
    },
  ],
  subtract: [
    {
      local: false,
      text: (a, b) =>
        `A stadium has ${a} seats. ${b} of the seats are taken. How many seats are empty?`,
    },
    {
      local: false,
      text: (a, b) => `A shop had ${a} pencils and sold ${b} of them. How many pencils are left?`,
    },
    {
      local: true,
      text: (a, b) =>
        `A tuck shop had ${a} sweets and sold ${b} of them. How many sweets are left?`,
    },
    {
      local: true,
      text: (a, b) =>
        `A farmer had ${a} kg of maize and sold ${b} kg at the market. How many kilograms are left?`,
    },
    {
      local: true,
      text: (a, b) =>
        `A school bought ${a} exercise books and gave out ${b} of them. How many exercise books are left?`,
    },
  ],
  multiply: [
    {
      local: false,
      text: (a, b) =>
        `Each box holds ${a} exercise books. How many exercise books are in ${b} boxes?`,
    },
    {
      local: false,
      text: (a, b) =>
        `A printer prints ${a} pages every hour. How many pages does it print in ${b} hours?`,
    },
    {
      local: true,
      text: (a, b) =>
        `A farmer plants ${a} maize plants in each row. There are ${b} rows. How many maize plants are there?`,
    },
    {
      local: true,
      text: (a, b) =>
        `A bus carries ${a} passengers on each trip. How many passengers does it carry in ${b} trips?`,
    },
    {
      local: true,
      text: (a, b) =>
        `A baker bakes ${a} loaves of bread each day. How many loaves does the baker bake in ${b} days?`,
    },
  ],
  divide: [
    {
      local: false,
      text: (a, b) =>
        `${a} pencils are shared equally among ${b} learners. How many pencils does each learner get?`,
    },
    {
      local: false,
      text: (a, b) => `${a} learners are put into groups of ${b}. How many groups are there?`,
    },
    {
      local: true,
      text: (a, b) =>
        `${a} oranges are packed equally into ${b} bags. How many oranges are in each bag?`,
    },
    {
      local: true,
      text: (a, b) =>
        `A teacher shares ${a} exercise books equally among ${b} classes. How many exercise books does each class get?`,
    },
    {
      local: true,
      text: (a, b) =>
        `A farmer packs ${a} eggs into trays that each hold ${b} eggs. How many trays does the farmer fill?`,
    },
  ],
};

const wordProblemSources = [addWhole, subtractWhole, multiplyByDigit, multiplyLong, divideWhole];

export const wordProblems = defineTemplate({
  id: "ops.word-problem",
  description: "Everyday problems that need addition, subtraction, multiplication or division.",
  levels: [3, 4, 5],
  covers: (o) =>
    o.topicCode === OPS &&
    !/facts/i.test(o.text) &&
    wordProblemSources.some((template) => template.covers(o)),
  generate: ({ objective: o, difficulty: d, rng, q, local }) => {
    const operation: Operation = addWhole.covers(o)
      ? "add"
      : subtractWhole.covers(o)
        ? "subtract"
        : divideWhole.covers(o)
          ? "divide"
          : "multiply";
    const digits = Math.max(
      2,
      Math.min(5, wholeDigitsFor(o.grade, d), String(GRADE_MAX[o.grade]!).length - 1),
    );
    let a: number;
    let b: number;
    let answer: number;
    let wrongs: Wrong[];
    if (operation === "add") {
      [a, b] = addendsWithCarries(rng, digits, Math.min(digits - 1, rng.int(1, 3)));
      answer = a + b;
      wrongs = [
        { answer: String(Math.abs(a - b)), tag: "OPERATION_CHOICE_ERROR" },
        { answer: String(answer + 10), tag: "CARRYING_ERROR" },
        { answer: String(answer - 1), tag: "BASIC_FACT_ERROR" },
      ];
    } else if (operation === "subtract") {
      [a, b] = subtractionWithBorrows(rng, digits, pickColumns(rng, digits, rng.int(1, 2)));
      answer = a - b;
      wrongs = [
        { answer: String(a + b), tag: "OPERATION_CHOICE_ERROR" },
        { answer: String(answer + 10), tag: "BORROWING_ERROR" },
        { answer: String(answer + 1), tag: "BASIC_FACT_ERROR" },
      ];
    } else if (operation === "multiply") {
      const limit = ({ 3: 500, 4: 1000, 5: 5000, 6: 10000, 7: 100000 } as Record<number, number>)[
        o.grade
      ]!;
      b = multiplyLong.covers(o) ? rng.int(11, 29) : rng.int(2, 9);
      a = rng.int(
        Math.max(11, Math.floor(limit / 40 / b)),
        Math.max(12, Math.floor((limit - 1) / b)),
      );
      answer = a * b;
      wrongs = [
        { answer: String(a + b), tag: "OPERATION_CHOICE_ERROR" },
        { answer: String(answer + a), tag: "BASIC_FACT_ERROR" },
        { answer: String(answer - b), tag: "BASIC_FACT_ERROR" },
      ];
    } else {
      const grade = Math.max(4, o.grade);
      const c = divisionCase(rng, grade, grade === 5 ? "division without remainders" : "", d);
      a = c.dividend - c.remainder;
      b = c.divisor;
      answer = c.quotient;
      wrongs = [
        { answer: String(a - b), tag: "OPERATION_CHOICE_ERROR" },
        { answer: String(answer + 1), tag: "BASIC_FACT_ERROR" },
        { answer: String(answer * 10), tag: "PLACE_VALUE_CONFUSION" },
      ];
    }
    const pool = CONTEXTS[operation].filter((c) => local || !c.local);
    const context = rng.pick(pool);
    const symbol = { add: "+", subtract: "−", multiply: "×", divide: "÷" }[operation];
    const reason = {
      add: "The story joins two amounts together, so we add",
      subtract: "The story takes one amount away from another, so we subtract",
      multiply: "The same amount is repeated, so we multiply",
      divide: "The amount is shared out equally, so we divide",
    }[operation];
    return q.numeric({
      skill: d >= 4 ? "PROBLEM_SOLVING" : "APPLICATION",
      type: "WORD_PROBLEM",
      stem: context.text(fmtInt(a), fmtInt(b)),
      answer: String(answer),
      wrongs: nonNegative(wrongs).filter((w) => Number(w.answer) !== answer),
      usesLocalContext: context.local,
      explanation: `${reason}: ${fmtInt(a)} ${symbol} ${fmtInt(b)} = ${fmtInt(answer)}.`,
      hints: [
        "Read the story again and say it in your own words. What is happening?",
        "Is something being joined together, taken away, repeated or shared out?",
        `Choose the operation that fits the story, then work it out with the numbers ${fmtInt(a)} and ${fmtInt(b)}.`,
      ],
    });
  },
});

export const wholeOperationTemplates = [
  addWhole,
  additionLaws,
  subtractWhole,
  equalAdditions,
  repeatedAddition,
  multiplicationFacts,
  multiplyByDigit,
  multiplyByTens,
  multiplyLong,
  factorsAndMultiples,
  hcfLcm,
  shareEqually,
  repeatedSubtraction,
  divideWhole,
  combinedOperations,
  wordProblems,
];
