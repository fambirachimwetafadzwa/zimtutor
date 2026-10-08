import { Rational } from "../../marking/rational";
import {
  byLevel,
  defineTemplate,
  fractionWords,
  fmtInt,
  joinWords,
  scoped,
  type Wrong,
} from "../kit";
import { gcd } from "../maths";
import type { Rng } from "../rng";
import type { Difficulty } from "../types";
import {
  denomsFor,
  fractionBar,
  frac,
  MIXED_DENOMS,
  FRACTION_DENOMS,
  mixed,
  properFraction,
  twoDenominators,
} from "./rational-common";
import { numberToWords } from "../../marking/words";

/**
 * Fractions and mixed numbers: naming and writing, diagrams, comparing and ordering, equivalent
 * fractions, lowest terms, mixed numbers and improper fractions. Denominators follow the printed
 * Content for each grade.
 */

const PF = /^proper-fractions$/;
const MN = /^mixed-numbers$/;

const cmp = (a: [number, number], b: [number, number]): number => a[0] * b[1] - b[0] * a[1];
const sign = (value: number): "<" | "=" | ">" => (value < 0 ? "<" : value > 0 ? ">" : "=");

// ── writing and reading fractions ───────────────────────────────────────────────────────────────

export const fractionNotation = defineTemplate({
  id: "frac.notation",
  description: "Identify, read and write proper fractions.",
  covers: (o) =>
    scoped(o, {
      topic: "NUM",
      strand: PF,
      text: /write fractions|read\/sign fractions|identify proper fractions/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const t = o.text.toLowerCase();
    const den = rng.pick(denomsFor(o.grade, d));
    const [num] = properFraction(rng, den, { coprime: true });
    const text = frac(num, den);
    const words = fractionWords(num, den);
    const swapped = frac(den, num);

    if (/identify/.test(t)) {
      const improper = frac(den + rng.int(1, 3), den);
      return q.mcq({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: "Which of these is a proper fraction?",
        keepEqualValues: true,
        correct: text,
        wrongs: [
          { answer: swapped, tag: "FRACTION_NOTATION_CONFUSION" },
          { answer: improper },
          { answer: mixed(1, num, den) },
          { answer: String(den) },
        ],
        explanation: `A proper fraction has a numerator that is smaller than its denominator, so it is less than one whole. ${text} is a proper fraction.`,
        hints: [
          "In a proper fraction the top number is smaller than the bottom number.",
          "Look at the top and bottom of each choice. Which one has the smaller number on top?",
        ],
      });
    }
    if (/read/.test(t)) {
      return q.mcq({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Which words show the fraction ${text}?`,
        correct: words,
        wrongs: [
          ...(num > 1
            ? [{ answer: fractionWords(den, num), tag: "FRACTION_NOTATION_CONFUSION" }]
            : []),
          ...(num > 1 ? [{ answer: fractionWords(num - 1, den) }] : []),
          ...(num + 1 < den ? [{ answer: fractionWords(num + 1, den) }] : []),
          { answer: fractionWords(num, den + 1) },
        ],
        explanation: `In ${text}, the bottom number ${den} says the whole is cut into ${den} equal parts, and the top number ${num} says how many of them we have. We read it “${words}”.`,
        hints: [
          "The bottom number names the kind of part (halves, thirds, quarters, fifths …).",
          "The top number says how many of those parts there are.",
        ],
      });
    }
    // write
    const common = {
      skill: "KNOWLEDGE_COMPREHENSION" as const,
      explanation: `${words} means ${num} of ${den} equal parts, written ${text}. The top number counts the parts, the bottom number names them.`,
      hints: [
        "The bottom number names the kind of part and shows how many equal parts make a whole.",
        "The top number counts how many of those parts we have.",
        "Write the number of parts on top and the kind of part underneath.",
      ],
    };
    if (d <= 1)
      return q.mcq({
        ...common,
        stem: `Which fraction is “${words}”?`,
        correct: text,
        wrongs: [
          { answer: swapped, tag: "FRACTION_NOTATION_CONFUSION" },
          { answer: frac(num, den + 1) },
          { answer: frac(num > 1 ? num - 1 : num + 1, den) },
        ],
      });
    return q.fraction({
      ...common,
      stem: `Write “${words}” as a fraction.`,
      value: text,
      lowestTerms: true,
      answerHint: "Write a fraction using a slash (/).",
      wrongs: [{ answer: swapped, tag: "FRACTION_NOTATION_CONFUSION" }],
    });
  },
});

// ── fractions in diagrams ───────────────────────────────────────────────────────────────────────

export const fractionDiagram = defineTemplate({
  id: "frac.diagram",
  description: "Name the fraction shown in a diagram and decide how many parts to shade.",
  covers: (o) =>
    scoped(o, {
      topic: "NUM",
      strand: PF,
      text: /diagram/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const pool = denomsFor(o.grade, d).filter((x) => x <= 12);
    const den = rng.pick(pool.length > 0 ? pool : [2, 4, 5]);
    const num = rng.int(1, den - 1);
    const shadeQuestion = /\bshade\b/i.test(o.text);
    if (shadeQuestion) {
      return q.numeric({
        skill: "KNOWLEDGE_COMPREHENSION",
        type: "VISUAL_DIAGRAM",
        stem: `The bar is cut into ${den} equal parts. How many parts must be shaded to show ${frac(num, den)}?`,
        stemData: fractionBar(den, 0),
        answer: String(num),
        wrongs: [
          { answer: String(den - num), tag: "PART_WHOLE_CONFUSION" },
          { answer: String(den) },
          { answer: String(Math.min(den, num + 1)) },
        ],
        explanation: `The bottom number ${den} tells us the bar has ${den} equal parts. The top number ${num} tells us to shade ${num} of them.`,
        hints: [
          "The bottom number tells how many equal parts the whole is cut into.",
          "The top number tells how many of those parts to shade.",
        ],
      });
    }
    return q.fraction({
      skill: "KNOWLEDGE_COMPREHENSION",
      type: "VISUAL_DIAGRAM",
      stem: "What fraction of the bar is shaded?",
      stemData: fractionBar(den, num),
      value: frac(num, den),
      lowestTerms: false,
      answerHint: "Write a fraction using a slash (/).",
      wrongs: [
        { answer: frac(num, den - num), tag: "PART_WHOLE_CONFUSION" },
        { answer: frac(den, num), tag: "FRACTION_NOTATION_CONFUSION" },
        { answer: frac(den - num, den) },
      ],
      explanation: `The bar is cut into ${den} equal parts and ${num} of them are shaded, so ${frac(num, den)} of the bar is shaded.`,
      hints: [
        "First count ALL the equal parts in the bar. That is the bottom number.",
        "Then count the shaded parts. That is the top number.",
        "Do not count the parts that are not shaded in the bottom number.",
      ],
    });
  },
});

// ── comparing fractions ─────────────────────────────────────────────────────────────────────────

function comparisonPair(
  rng: Rng,
  grade: number,
  difficulty: Difficulty,
): { a: [number, number]; b: [number, number]; kind: "same-den" | "same-num" | "different" } {
  const pool = denomsFor(grade, difficulty);
  const mode =
    grade === 3 || difficulty === 1
      ? "same-den"
      : difficulty === 2
        ? rng.pick(["same-den", "same-num"] as const)
        : rng.pick(["same-num", "different", "different"] as const);
  for (let tries = 0; tries < 200; tries++) {
    if (mode === "same-den") {
      const den = rng.pick(pool.filter((x) => x >= 3));
      const x = rng.int(1, den - 1);
      const y = rng.int(1, den - 1);
      if (x !== y) return { a: [x, den], b: [y, den], kind: "same-den" };
    } else if (mode === "same-num") {
      const [d1, d2] = twoDenominators(rng, pool);
      const x = rng.int(1, Math.min(d1, d2) - 1);
      return { a: [x, d1], b: [x, d2], kind: "same-num" };
    } else {
      const [d1, d2] = twoDenominators(rng, pool);
      const x = rng.int(1, d1 - 1);
      const y = rng.int(1, d2 - 1);
      if (x !== y && x * d2 !== y * d1) return { a: [x, d1], b: [y, d2], kind: "different" };
    }
  }
  throw new Error("comparisonPair: failed");
}

export const compareFractions = defineTemplate({
  id: "frac.compare",
  description: "Compare proper fractions with <, = and >.",
  covers: (o) => scoped(o, { topic: "NUM", strand: PF, text: /compare fractions/i }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const { a, b, kind } = comparisonPair(rng, o.grade, d);
    const answer = sign(cmp(a, b));
    const left = frac(...a);
    const right = frac(...b);
    // What a learner who compares the wrong thing would answer.
    const byNumerators = sign(a[0] - b[0]);
    const byDenominators = sign(a[1] - b[1]);
    const wrongs: Wrong[] = (["<", "=", ">"] as const)
      .filter((s) => s !== answer)
      .map((s) => {
        if (kind === "same-num" && s === byDenominators)
          return { answer: s, tag: "FRACTION_SIZE_BY_DENOMINATOR" };
        if (kind === "different" && s === byNumerators)
          return { answer: s, tag: "FRACTION_COMPONENT_COMPARISON" };
        if (kind === "different" && s === byDenominators)
          return { answer: s, tag: "FRACTION_SIZE_BY_DENOMINATOR" };
        return { answer: s };
      });
    const hints =
      kind === "same-den"
        ? [
            "When the denominators are the same, the parts are the same size.",
            "So the fraction with more parts is the bigger fraction. Compare the top numbers.",
          ]
        : kind === "same-num"
          ? [
              "Both fractions have the same number of parts. Think about the SIZE of each part.",
              "Cut the same whole into more pieces and each piece gets smaller.",
              "Which denominator makes the smaller pieces?",
            ]
          : [
              "The denominators are different, so we cannot compare the top numbers yet.",
              "Make both fractions have the same denominator. A number that both denominators go into will work.",
              `Both fractions can be written with the denominator ${(a[1] * b[1]) / gcd(a[1], b[1])}.`,
            ];
    const common = (a[1] * b[1]) / gcd(a[1], b[1]);
    return q.mcq({
      skill: kind === "different" ? "ANALYSIS" : "KNOWLEDGE_COMPREHENSION",
      stem: `Which sign makes the statement true?  ${left}  ___  ${right}`,
      correct: answer,
      wrongs,
      keepOrder: true,
      explanation:
        kind === "same-den"
          ? `Both fractions are in ${b[1]}ths, so we compare the numerators: ${a[0]} ${answer} ${b[0]}. So ${left} ${answer} ${right}.`
          : kind === "same-num"
            ? `Both fractions have ${a[0]} part${a[0] === 1 ? "" : "s"}, but the parts are different sizes: the bigger the denominator, the smaller each part. So ${left} ${answer} ${right}.`
            : `With the common denominator ${common}: ${left} = ${(a[0] * common) / a[1]}/${common} and ${right} = ${(b[0] * common) / b[1]}/${common}. So ${left} ${answer} ${right}.`,
      hints,
    });
  },
});

// ── ordering fractions ──────────────────────────────────────────────────────────────────────────

export const orderFractions = defineTemplate({
  id: "frac.order",
  description: "Arrange proper fractions in ascending or descending order.",
  covers: (o) =>
    scoped(o, {
      topic: "NUM",
      strand: PF,
      text: /arrange|order of size/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const pool = denomsFor(o.grade, d);
    const count = byLevel(d, [3, 3, 3, 4, 4]);
    const mode =
      d <= 1 ? "same-den" : d === 2 ? rng.pick(["same-den", "same-num"] as const) : "different";
    let items: Array<[number, number]> = [];
    for (let tries = 0; tries < 300 && items.length < count; tries++) {
      items = [];
      if (mode === "same-den") {
        const den = rng.pick(pool.filter((x) => x >= count + 1));
        const nums = rng.sample(
          Array.from({ length: den - 1 }, (_, i) => i + 1),
          count,
        );
        items = nums.map((n) => [n, den]);
      } else if (mode === "same-num") {
        const dens = rng.sample(pool, count);
        const n = rng.int(1, Math.min(...dens) - 1);
        items = dens.map((dn) => [n, dn]);
      } else {
        const dens = rng.sample(
          pool.filter((x) => x <= 20),
          count,
        );
        items = dens.map((dn) => [rng.int(1, dn - 1), dn]);
      }
      const values = items.map(([n, dn]) => new Rational(BigInt(n), BigInt(dn)).toString());
      if (new Set(values).size !== items.length) items = [];
    }
    if (items.length < count) throw new Error("orderFractions: no distinct set");
    const ascending = rng.chance(0.5);
    const byValue = [...items].sort((a, b) => cmp(a, b));
    const target = ascending ? byValue : [...byValue].reverse();
    const sequence = target.map(([n, dn]) => frac(n, dn));
    const shown = items.map(([n, dn]) => frac(n, dn));
    const byNum = [...items]
      .sort((a, b) => a[0] - b[0] || a[1] - b[1])
      .map(([n, dn]) => frac(n, dn));
    const byDen = [...items]
      .sort((a, b) => a[1] - b[1] || a[0] - b[0])
      .map(([n, dn]) => frac(n, dn));
    const orient = (list: string[]) => (ascending ? list : [...list].reverse());
    const wrongOrders: Array<{ order: string[]; tag: string }> = [];
    if (mode !== "same-den" && orient(byNum).join() !== sequence.join())
      wrongOrders.push({ order: orient(byNum), tag: "FRACTION_COMPONENT_COMPARISON" });
    if (mode !== "same-den" && orient(byDen).join() !== sequence.join())
      wrongOrders.push({ order: orient(byDen), tag: "FRACTION_SIZE_BY_DENOMINATOR" });
    const common = items.reduce((acc, [, dn]) => (acc * dn) / gcd(acc, dn), 1);
    return q.ordering({
      skill: mode === "different" ? "ANALYSIS" : "KNOWLEDGE_COMPREHENSION",
      stem: `Arrange these fractions in ${ascending ? "ascending" : "descending"} order (from the ${ascending ? "smallest to the largest" : "largest to the smallest"}): ${shown.join(", ")}.`,
      sequence,
      wrongOrders,
      explanation:
        mode === "different"
          ? `Write each fraction with the denominator ${common}: ${target.map(([n, dn]) => `${frac(n, dn)} = ${(n * common) / dn}/${common}`).join(", ")}. In ${ascending ? "ascending" : "descending"} order: ${sequence.join(", ")}.`
          : `In ${ascending ? "ascending" : "descending"} order: ${sequence.join(", ")}.`,
      hints:
        mode === "same-den"
          ? [
              "The denominators are the same, so the parts are the same size.",
              "Put the fractions in order of their top numbers.",
            ]
          : mode === "same-num"
            ? [
                "Each fraction has the same number of parts. Which parts are the biggest?",
                "The smaller the denominator, the bigger each part.",
              ]
            : [
                "The denominators are different. Give all the fractions the same denominator first.",
                `A number that all the denominators go into: ${common}.`,
                "Then compare the numerators.",
              ],
    });
  },
});

// ── equivalent fractions ────────────────────────────────────────────────────────────────────────

export const equivalentFractions = defineTemplate({
  id: "frac.equivalent",
  description: "Find missing numbers in equivalent fractions.",
  covers: (o) =>
    scoped(o, {
      topic: "NUM",
      strand: PF,
      text: /equivalent/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const pool = [...(FRACTION_DENOMS[o.grade] ?? FRACTION_DENOMS[5]!)];
    // a base fraction and a multiplier so that both denominators are allowed
    const options: Array<{ b: number; k: number }> = [];
    for (const b of pool)
      for (const k of [2, 3, 4, 5, 10]) if (pool.includes(b * k)) options.push({ b, k });
    const { b, k } = rng.pick(options);
    const [a] = properFraction(rng, b);
    const A = a * k;
    const B = b * k;
    const mode = d <= 2 ? "choose" : rng.pick(["numerator", "denominator"] as const);
    const hints = [
      "Equivalent fractions name the same amount. They are made by multiplying the top and the bottom by the SAME number.",
      `Find the number that takes the denominator ${b} to ${B}.`,
    ];
    if (mode === "choose") {
      const wrongs: Wrong[] = [
        { answer: frac(a + (B - b), B), tag: "EQUIVALENT_FRACTION_ADDITIVE_ERROR" },
        { answer: frac(a, B) },
        { answer: frac(A, b) },
        { answer: frac(A + 1, B) },
      ];
      return q.mcq({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Which fraction is equivalent to ${frac(a, b)}?`,
        correct: frac(A, B),
        wrongs,
        explanation: `Multiply the top and the bottom of ${frac(a, b)} by ${k}: ${a} × ${k} = ${A} and ${b} × ${k} = ${B}. So ${frac(a, b)} = ${frac(A, B)}.`,
        hints: [
          "Equivalent fractions name the same amount. Multiply the top and the bottom by the SAME number.",
          "Check each choice: was the top multiplied by the same number as the bottom?",
        ],
      });
    }
    if (mode === "numerator") {
      return q.numeric({
        skill: "APPLICATION",
        type: "FILL_IN_THE_BLANK",
        stem: `Fill in the missing number:  ${frac(a, b)} = ___/${B}`,
        answer: String(A),
        wrongs: [
          { answer: String(a + (B - b)), tag: "EQUIVALENT_FRACTION_ADDITIVE_ERROR" },
          { answer: String(a) },
          { answer: String(k) },
        ],
        explanation: `The denominator went from ${b} to ${B}: it was multiplied by ${k}. The numerator must be multiplied by ${k} too: ${a} × ${k} = ${A}.`,
        hints,
      });
    }
    return q.numeric({
      skill: "APPLICATION",
      type: "FILL_IN_THE_BLANK",
      stem: `Fill in the missing number:  ${frac(a, b)} = ${A}/___`,
      answer: String(B),
      wrongs: [
        { answer: String(b + (A - a)), tag: "EQUIVALENT_FRACTION_ADDITIVE_ERROR" },
        { answer: String(b) },
        { answer: String(k) },
      ],
      explanation: `The numerator went from ${a} to ${A}: it was multiplied by ${k}. The denominator must be multiplied by ${k} too: ${b} × ${k} = ${B}.`,
      hints: [
        "Equivalent fractions name the same amount. They are made by multiplying the top and the bottom by the SAME number.",
        `Find the number that takes the numerator ${a} to ${A}.`,
      ],
    });
  },
});

// ── lowest terms ────────────────────────────────────────────────────────────────────────────────

export const lowestTerms = defineTemplate({
  id: "frac.lowest-terms",
  description: "Reduce proper fractions to their lowest terms.",
  covers: (o) => scoped(o, { topic: "NUM", strand: PF, text: /lowest terms|simplify/i }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const pool = [...(FRACTION_DENOMS[o.grade] ?? FRACTION_DENOMS[5]!)];
    const options: Array<{ b: number; k: number }> = [];
    for (const k of [2, 3, 4, 5, 6, 10])
      for (const b of Array.from({ length: 15 }, (_, i) => i + 2))
        if (pool.includes(b * k) && (d >= 3 || k <= 5)) options.push({ b, k });
    const { b, k } = rng.pick(options);
    const [a] = properFraction(rng, b, { coprime: true });
    const A = a * k;
    const B = b * k;
    const low = frac(a, b);
    const unreduced = frac(A, B);
    // divided by a common factor, but not the greatest one
    const partial = (() => {
      for (const f of [2, 3, 5]) if (k % f === 0 && k / f > 1) return frac(A / f, B / f);
      return null;
    })();
    const common = {
      skill: "APPLICATION" as const,
      explanation: `The greatest number that divides both ${A} and ${B} is ${k}. ${A} ÷ ${k} = ${a} and ${B} ÷ ${k} = ${b}, so ${unreduced} = ${low} in lowest terms.`,
      hints: [
        "Find a number that divides both the top and the bottom exactly.",
        "Divide the top and the bottom by that number. Keep going until no number (except 1) divides both.",
        `The greatest number that divides both ${A} and ${B} saves the most work.`,
      ],
    };
    if (d <= 1)
      return q.mcq({
        ...common,
        stem: `Which is ${unreduced} written in its lowest terms?`,
        correct: low,
        wrongs: [
          ...(partial ? [{ answer: partial }] : []),
          { answer: frac(b, a), tag: "FRACTION_NOTATION_CONFUSION" },
          { answer: frac(A, b) },
          { answer: frac(a + 1, b + 1) },
        ],
      });
    return q.fraction({
      ...common,
      stem: `Write ${unreduced} in its lowest terms.`,
      value: low,
      lowestTerms: true,
      answerHint: "Write a fraction using a slash (/).",
      wrongs: [{ answer: frac(b, a), tag: "FRACTION_NOTATION_CONFUSION" }],
    });
  },
});

// ── mixed numbers ───────────────────────────────────────────────────────────────────────────────

function mixedDenoms(grade: number, difficulty: Difficulty): number[] {
  const all = [...(MIXED_DENOMS[grade] ?? MIXED_DENOMS[5]!)];
  return difficulty <= 2 ? all.filter((x) => [2, 3, 4, 5, 10].includes(x)) : all;
}

function mixedParts(rng: Rng, grade: number, difficulty: Difficulty) {
  const den = rng.pick(mixedDenoms(grade, difficulty));
  const [num] = properFraction(rng, den, { coprime: true });
  const whole = rng.int(1, byLevel(difficulty, [3, 5, 9, 12, 20]));
  return { whole, num, den, improper: whole * den + num };
}

const mixedWords = (w: number, n: number, d: number): string =>
  `${numberToWords(w)} and ${fractionWords(n, d)}`;

export const mixedNumeration = defineTemplate({
  id: "mixed.numeration",
  description: "Identify, read, write and name the parts of mixed numbers.",
  covers: (o) =>
    scoped(o, {
      topic: "NUM",
      strand: MN,
      text: /identify|read\/sign|write mixed numbers|parts? of a mixed/i,
      not: /improper|decimals|diagram/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const { whole, num, den, improper } = mixedParts(rng, o.grade, d);
    const text = mixed(whole, num, den);
    const t = o.text.toLowerCase();

    if (/parts?/.test(t)) {
      const askWhole = rng.chance(0.5);
      if (askWhole)
        return q.numeric({
          skill: "KNOWLEDGE_COMPREHENSION",
          stem: `What is the whole-number part of the mixed number ${text}?`,
          answer: String(whole),
          wrongs: [
            { answer: String(num) },
            { answer: String(den) },
            { answer: String(improper), tag: "MIXED_IMPROPER_CONVERSION_ERROR" },
          ],
          explanation: `A mixed number has a whole-number part and a fraction part. In ${text} the whole-number part is ${whole} and the fraction part is ${frac(num, den)}.`,
          hints: [
            "A mixed number is made of a whole number and a fraction.",
            "The whole number is written first, on the left.",
          ],
        });
      return q.fraction({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `What is the fraction part of the mixed number ${text}?`,
        value: frac(num, den),
        lowestTerms: false,
        answerHint: "Write a fraction using a slash (/).",
        wrongs: [{ answer: frac(den, num), tag: "FRACTION_NOTATION_CONFUSION" }],
        explanation: `A mixed number has a whole-number part and a fraction part. In ${text} the whole-number part is ${whole} and the fraction part is ${frac(num, den)}.`,
        hints: [
          "A mixed number is made of a whole number and a fraction.",
          "The fraction is written after the whole number, on the right.",
        ],
      });
    }
    if (/identify/.test(t)) {
      return q.mcq({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: "Which of these is a mixed number?",
        keepEqualValues: true,
        correct: text,
        wrongs: [
          { answer: frac(num, den) },
          { answer: frac(improper, den) },
          { answer: String(whole) },
        ],
        explanation: `A mixed number is a whole number together with a fraction. ${text} is ${whole} whole${whole === 1 ? "" : "s"} and ${frac(num, den)}.`,
        hints: [
          "A mixed number has two parts: a whole number and a fraction.",
          "Look for the choice that has both a whole number and a fraction.",
        ],
      });
    }
    if (/read/.test(t)) {
      const words = mixedWords(whole, num, den);
      return q.mcq({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Which words show the mixed number ${text}?`,
        correct: words,
        wrongs: [
          ...(whole < den
            ? [{ answer: mixedWords(num, whole, den), tag: "FRACTION_NOTATION_CONFUSION" }]
            : []),
          { answer: mixedWords(whole + 1, num, den) },
          { answer: mixedWords(whole, num, den === 2 ? 4 : den - 1) },
          { answer: mixedWords(whole, Math.min(den - 1, num + 1) || 1, den) },
        ],
        explanation: `${text} is read “${words}”: the whole number first, then “and”, then the fraction.`,
        hints: ["Say the whole number first.", "Then say “and” and read the fraction."],
      });
    }
    // write
    const words = mixedWords(whole, num, den);
    return q.numeric({
      skill: "KNOWLEDGE_COMPREHENSION",
      stem: `Write “${words}” as a mixed number.`,
      answer: text,
      requireForm: "mixed",
      answerHint: "Write a mixed number: whole number, a space, then the fraction.",
      wrongs: [
        ...(whole < den
          ? [{ answer: mixed(num, whole, den), tag: "FRACTION_NOTATION_CONFUSION" }]
          : []),
        { answer: mixed(whole, den, num + den), tag: "FRACTION_NOTATION_CONFUSION" },
      ],
      explanation: `“${words}” has the whole number ${whole} and the fraction ${frac(num, den)}, so it is written ${text}.`,
      hints: [
        "A mixed number is a whole number followed by a fraction.",
        "Write the whole number first, then the fraction next to it.",
      ],
    });
  },
});

export const mixedConversion = defineTemplate({
  id: "mixed.convert",
  description:
    "Change mixed numbers to improper fractions and improper fractions to mixed numbers.",
  covers: (o) => scoped(o, { topic: "NUM", strand: MN, text: /improper/i }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const { whole, num, den, improper } = mixedParts(rng, o.grade, d);
    const text = mixed(whole, num, den);
    const improperText = frac(improper, den);
    const both = /vice versa/i.test(o.text);
    const toImproper = both ? rng.chance(0.5) : /mixed numbers? (?:as|to) improper/i.test(o.text);
    if (toImproper) {
      return q.numeric({
        skill: "APPLICATION",
        stem: `Write ${text} as an improper fraction.`,
        answer: improperText,
        requireForm: "fraction",
        answerHint: "Write an improper fraction using a slash (/).",
        wrongs: [
          { answer: frac(whole + num, den), tag: "MIXED_IMPROPER_CONVERSION_ERROR" },
          { answer: frac(Number(`${whole}${num}`), den), tag: "MIXED_IMPROPER_CONVERSION_ERROR" },
          { answer: frac(whole * den, den), tag: "MIXED_IMPROPER_CONVERSION_ERROR" },
        ],
        explanation: `Each whole is ${den} ${fractionWords(2, den).split(" ").slice(1).join(" ")}. ${whole} whole${whole === 1 ? "" : "s"} make ${whole} × ${den} = ${whole * den} parts. Add the ${num} parts: ${whole * den} + ${num} = ${improper}. So ${text} = ${improperText}.`,
        hints: [
          "How many equal parts are there in ONE whole?",
          `So how many parts are there in ${whole} whole${whole === 1 ? "" : "s"}?`,
          "Then add the parts of the fraction part.",
        ],
      });
    }
    return q.numeric({
      skill: "APPLICATION",
      stem: `Write ${improperText} as a mixed number.`,
      answer: text,
      requireForm: "mixed",
      answerHint: "Write a mixed number: whole number, a space, then the fraction.",
      wrongs: [
        { answer: mixed(whole + 1, num, den), tag: "MIXED_IMPROPER_CONVERSION_ERROR" },
        { answer: mixed(whole, den - num, den), tag: "MIXED_IMPROPER_CONVERSION_ERROR" },
        { answer: mixed(whole, num, improper), tag: "MIXED_IMPROPER_CONVERSION_ERROR" },
      ],
      explanation: `${improper} ÷ ${den} = ${whole} remainder ${num}. So there are ${whole} whole${whole === 1 ? "" : "s"} and ${num} part${num === 1 ? "" : "s"} left over: ${text}.`,
      hints: [
        "How many parts make one whole? Divide the top number by the bottom number.",
        "The answer to the division is the whole-number part.",
        "The remainder is the number of parts left over: it goes on top of the fraction.",
      ],
    });
  },
});

export const mixedCompare = defineTemplate({
  id: "mixed.compare",
  description: "Compare and order mixed numbers.",
  covers: (o) =>
    scoped(o, {
      topic: "NUM",
      strand: MN,
      text: /compare|arrange/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const dens = mixedDenoms(o.grade, d);
    const ordering = /arrange/i.test(o.text);
    const make = (sameWhole: boolean, whole: number) => {
      const den = rng.pick(dens);
      const num = rng.int(1, den - 1);
      return { whole: sameWhole ? whole : rng.int(1, 9), num, den };
    };
    const value = (m: { whole: number; num: number; den: number }): [number, number] => [
      m.whole * m.den + m.num,
      m.den,
    ];
    const text = (m: { whole: number; num: number; den: number }) => mixed(m.whole, m.num, m.den);

    if (ordering) {
      const count = d <= 2 ? 3 : 4;
      let items: Array<{ whole: number; num: number; den: number }> = [];
      for (let tries = 0; tries < 200; tries++) {
        const base = rng.int(1, 5);
        items = Array.from({ length: count }, () => make(d >= 4, base));
        const vals = items.map((m) =>
          new Rational(BigInt(value(m)[0]), BigInt(value(m)[1])).toString(),
        );
        if (new Set(vals).size === count) break;
        items = [];
      }
      if (items.length === 0) throw new Error("mixedCompare: no distinct set");
      const ascending = rng.chance(0.5);
      const sorted = [...items].sort((a, b) => cmp(value(a), value(b)));
      const target = (ascending ? sorted : [...sorted].reverse()).map(text);
      return q.ordering({
        skill: "ANALYSIS",
        stem: `Arrange these mixed numbers in ${ascending ? "ascending" : "descending"} order (from the ${ascending ? "smallest to the largest" : "largest to the smallest"}): ${items.map(text).join(", ")}.`,
        sequence: target,
        explanation: `Compare the whole numbers first. If they are the same, compare the fractions. In ${ascending ? "ascending" : "descending"} order: ${target.join(", ")}.`,
        hints: [
          "Compare the whole-number parts first. The bigger whole number makes the bigger mixed number.",
          "If two mixed numbers have the same whole number, compare their fraction parts.",
        ],
      });
    }
    const sameWhole = d >= 3 && rng.chance(0.6);
    const base = rng.int(1, 8);
    const a = make(sameWhole, base);
    let b = make(sameWhole, base);
    for (let tries = 0; tries < 100 && cmp(value(a), value(b)) === 0; tries++)
      b = make(sameWhole, base);
    // trap: the smaller whole number has the bigger fraction
    const answer = sign(cmp(value(a), value(b)));
    const fractionOnly = sign(a.num * b.den - b.num * a.den);
    return q.mcq({
      skill: "ANALYSIS",
      stem: `Which sign makes the statement true?  ${text(a)}  ___  ${text(b)}`,
      correct: answer,
      wrongs: (["<", "=", ">"] as const)
        .filter((s) => s !== answer)
        .map((s) => ({
          answer: s,
          ...(s === fractionOnly && !sameWhole ? { tag: "FRACTION_COMPONENT_COMPARISON" } : {}),
        })),
      keepOrder: true,
      explanation: sameWhole
        ? `Both have ${a.whole} whole${a.whole === 1 ? "" : "s"}, so compare the fractions ${frac(a.num, a.den)} and ${frac(b.num, b.den)}. So ${text(a)} ${answer} ${text(b)}.`
        : `Compare the whole numbers first: ${a.whole} and ${b.whole}. So ${text(a)} ${answer} ${text(b)}.`,
      hints: [
        "Compare the whole-number parts first.",
        "Only when the whole numbers are the same do we need to compare the fraction parts.",
      ],
    });
  },
});

export const mixedDiagram = defineTemplate({
  id: "mixed.diagram",
  description: "Write the mixed number shown in a diagram and show a mixed number on a diagram.",
  covers: (o) => scoped(o, { topic: "NUM", strand: MN, text: /diagram/i }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const den = rng.pick(mixedDenoms(o.grade, d).filter((x) => x <= 10));
    const num = rng.int(1, den - 1);
    const whole = rng.int(1, Math.min(4, byLevel(d, [2, 2, 3, 4, 4])));
    const text = mixed(whole, num, den);
    const represent = /vice/i.test(o.text) && rng.chance(0.5);
    if (represent) {
      return q.multiPart({
        skill: "APPLICATION",
        type: "WORKED_CALCULATION",
        stem: `Each bar is cut into ${den} equal parts. To show the mixed number ${text}, how many bars must be completely shaded, and how many parts of the next bar?`,
        stemData: fractionBar(den, 0),
        parts: [
          {
            id: "bars",
            label: "Bars completely shaded",
            answer: String(whole),
            wrongs: [{ answer: String(num) }],
          },
          {
            id: "parts",
            label: `Parts shaded on the next bar (out of ${den})`,
            answer: String(num),
            wrongs: [{ answer: String(whole) }],
          },
        ],
        explanation: `${text} is ${whole} whole bar${whole === 1 ? "" : "s"} and ${num} out of ${den} parts of the next bar.`,
        hints: [
          "The whole-number part tells how many complete bars to shade.",
          "The fraction part tells how many parts of the next bar to shade.",
        ],
      });
    }
    return q.numeric({
      skill: "KNOWLEDGE_COMPREHENSION",
      type: "VISUAL_DIAGRAM",
      stem: "Write the mixed number that the shaded bars show.",
      stemData: fractionBar(den, num, whole),
      answer: text,
      requireForm: "mixed",
      answerHint: "Write a mixed number: whole number, a space, then the fraction.",
      wrongs: [
        { answer: mixed(whole, den - num, den), tag: "PART_WHOLE_CONFUSION" },
        { answer: mixed(whole + 1, num, den) },
        ...(whole < den
          ? [{ answer: mixed(num, whole, den), tag: "FRACTION_NOTATION_CONFUSION" }]
          : []),
      ],
      explanation: `${whole} whole bar${whole === 1 ? " is" : "s are"} completely shaded, and ${num} of the ${den} parts of the last bar are shaded. That is ${text}.`,
      hints: [
        "Count the bars that are completely shaded. That is the whole-number part.",
        "Look at the last bar. How many equal parts does it have, and how many are shaded?",
      ],
    });
  },
});

export const mixedProblems = defineTemplate({
  id: "mixed.problems",
  description: "Solve everyday problems that use mixed numbers and improper fractions.",
  covers: (o) => scoped(o, { topic: "NUM", strand: MN, text: /solve problems/i }),
  generate: ({ objective: o, difficulty: d, rng, q, local }) => {
    const dens = mixedDenoms(o.grade, d);
    const name = rng.pick(["Tendai", "Rudo", "Farai", "Chipo", "Nyasha", "Tapiwa"]);
    const kind = rng.pick(["fill", "more", "pieces"] as const);
    if (kind === "pieces") {
      const den = rng.pick(dens.filter((x) => [2, 4, 3, 5].includes(x)));
      const whole = rng.int(1, 5);
      const num = rng.int(1, den - 1);
      const unit = den === 2 ? "halves" : den === 4 ? "quarters" : den === 3 ? "thirds" : "fifths";
      const item = local ? "loaf of bread" : "pizza";
      return q.numeric({
        skill: "PROBLEM_SOLVING",
        type: "WORD_PROBLEM",
        stem: `${name} has ${mixed(whole, num, den)} ${item === "pizza" ? "pizzas" : "loaves of bread"}. Each person is given one ${unit.slice(0, -1)} of a whole. How many ${unit} does ${name} have altogether?`,
        answer: String(whole * den + num),
        wrongs: [
          { answer: String(whole + num), tag: "MIXED_IMPROPER_CONVERSION_ERROR" },
          { answer: String(whole * den), tag: "MIXED_IMPROPER_CONVERSION_ERROR" },
        ],
        usesLocalContext: local,
        explanation: `Each whole has ${den} ${unit}. ${whole} wholes have ${whole} × ${den} = ${whole * den} ${unit}. Add the ${num} extra: ${whole * den + num} ${unit}.`,
        hints: [
          `How many ${unit} make one whole?`,
          `Count the ${unit} in the whole ${item === "pizza" ? "pizzas" : "loaves"}, then add the extra ones.`,
        ],
      });
    }
    if (kind === "more") {
      let a = { whole: rng.int(1, 6), num: 1, den: rng.pick(dens) };
      let b = { whole: a.whole, num: 1, den: rng.pick(dens) };
      a = { ...a, num: rng.int(1, a.den - 1) };
      b = { ...b, num: rng.int(1, b.den - 1) };
      for (let tries = 0; tries < 100 && a.num * b.den === b.num * a.den; tries++)
        b = { ...b, num: rng.int(1, b.den - 1) };
      const other = rng.pick(["Chipo", "Simba", "Rudo"].filter((x) => x !== name));
      const aValue: [number, number] = [a.whole * a.den + a.num, a.den];
      const bValue: [number, number] = [b.whole * b.den + b.num, b.den];
      const aBigger = cmp(aValue, bValue) > 0;
      return q.mcq({
        skill: "PROBLEM_SOLVING",
        type: "MULTIPLE_CHOICE",
        stem: `${name} walked ${mixed(a.whole, a.num, a.den)} km to school. ${other} walked ${mixed(b.whole, b.num, b.den)} km. Who walked further?`,
        correct: aBigger ? name : other,
        wrongs: [
          {
            answer: aBigger ? other : name,
            // choosing by the bigger numerator (ignoring the denominators) gives this wrong name
            ...(a.num > b.num === aBigger ? {} : { tag: "FRACTION_COMPONENT_COMPARISON" }),
          },
          { answer: "They walked the same distance" },
          { answer: "It is not possible to tell" },
        ],
        explanation: `Both walked ${a.whole} whole kilometres, so compare the fractions ${frac(a.num, a.den)} and ${frac(b.num, b.den)}. ${aBigger ? name : other} walked further.`,
        hints: [
          "The whole numbers are the same. What do we compare next?",
          "Give the two fractions the same denominator, then compare the numerators.",
        ],
      });
    }
    const den = rng.pick(dens.filter((x) => x >= 3 && x <= 8));
    const whole = rng.int(1, 4);
    const num = rng.int(1, den - 1);
    const improper = whole * den + num;
    return q.mcq({
      skill: "PROBLEM_SOLVING",
      type: "MULTIPLE_CHOICE",
      stem: `A jug holds ${frac(improper, den)} litres of water. Which mixed number shows the same amount?`,
      correct: mixed(whole, num, den),
      wrongs: [
        { answer: mixed(whole + 1, num, den), tag: "MIXED_IMPROPER_CONVERSION_ERROR" },
        { answer: mixed(whole, den - num, den), tag: "MIXED_IMPROPER_CONVERSION_ERROR" },
        { answer: mixed(Math.max(1, whole - 1), num, den), tag: "MIXED_IMPROPER_CONVERSION_ERROR" },
        ...(whole < den
          ? [{ answer: mixed(num, whole, den), tag: "FRACTION_NOTATION_CONFUSION" }]
          : []),
      ],
      explanation: `${improper} ÷ ${den} = ${whole} remainder ${num}, so ${frac(improper, den)} litres = ${mixed(whole, num, den)} litres.`,
      hints: [
        "An improper fraction has a top number bigger than its bottom number.",
        "Divide the top number by the bottom number to find the whole litres.",
      ],
    });
  },
});

export const fractionTemplates = [
  fractionNotation,
  fractionDiagram,
  compareFractions,
  orderFractions,
  equivalentFractions,
  lowestTerms,
  mixedNumeration,
  mixedConversion,
  mixedCompare,
  mixedDiagram,
  mixedProblems,
];

// Re-exports kept for the operations templates, which share these helpers.
export { cmp, sign };
export { joinWords, fmtInt };
