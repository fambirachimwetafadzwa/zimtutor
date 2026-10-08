import { numberToWords } from "../../marking/words";
import { byLevel, defineTemplate, fmtMoney, scoped, type Builders, type Wrong } from "../kit";
import { trimmedDecimal } from "../maths";
import type { Rng } from "../rng";
import type { AssessmentSkill, Difficulty, QuestionType, StemData } from "../types";

/**
 * Money: counting and converting money, change, operations with money, invoices, profit and loss,
 * exchange rates, and simple financial transactions. Amounts follow the printed Content for each
 * grade: up to $10 (G3), $50 (G4), $100 (G5), $200 (G6), $500 (G7).
 */

const MEA = "MEA" as const;
const MONEY = /^(?:money|conversions-of-money|change)$/;

/** Largest amount (in cents) each grade works with. */
const MONEY_MAX: Record<number, number> = {
  3: 1000,
  4: 5000,
  5: 10000,
  6: 20000,
  7: 50000,
};

const dollarsText = (cents: number): string => trimmedDecimal(cents, 2);

interface MoneyAnswer {
  skill: AssessmentSkill;
  type?: Extract<QuestionType, "NUMERIC" | "WORD_PROBLEM">;
  stem: string;
  cents: number;
  wrongs: Array<{ cents: number; tag?: string }>;
  explanation: string;
  hints: string[];
  local?: boolean;
  stemData?: StemData;
  /** The answer must be in this unit (conversions). Otherwise $ or c are both fine. */
  unit?: "$" | "c";
  answerHint?: string;
}

/** A money answer marked as an amount of money: "$2.50", "250c", "2.50" are all the same amount. */
function moneyAnswer(q: Builders, a: MoneyAnswer) {
  const wrongs: Wrong[] = a.wrongs
    .filter((w) => w.cents >= 0 && w.cents !== a.cents)
    .map((w) => ({
      answer: a.unit === "c" ? String(w.cents) : dollarsText(w.cents),
      ...(w.tag ? { tag: w.tag } : {}),
    }));
  const common = {
    skill: a.skill,
    type: a.type ?? ("NUMERIC" as const),
    stem: a.stem,
    wrongs,
    explanation: a.explanation,
    hints: a.hints,
    usesLocalContext: a.local ?? false,
    ...(a.answerHint ? { answerHint: a.answerHint } : {}),
    ...(a.stemData ? { stemData: a.stemData } : {}),
  };
  if (a.unit === "c")
    return q.unit({
      ...common,
      value: String(a.cents),
      unit: "c",
      unitOptional: true,
      strictUnit: true,
      answerText: `${a.cents}c`,
    });
  return q.unit({
    ...common,
    value: dollarsText(a.cents),
    unit: "$",
    unitOptional: true,
    strictUnit: a.unit === "$",
    answerText: fmtMoney(a.cents),
  });
}

// ── counting money ──────────────────────────────────────────────────────────────────────────────

const DENOMINATIONS: Record<number, readonly number[]> = {
  3: [5, 10, 20, 50, 100, 200, 500],
  4: [5, 10, 20, 50, 100, 200, 500, 1000],
  5: [10, 20, 50, 100, 200, 500, 1000, 2000],
  6: [20, 50, 100, 200, 500, 1000, 2000, 5000],
  7: [50, 100, 200, 500, 1000, 2000, 5000, 10000],
};

const kindOf = (cents: number): string => (cents >= 200 ? "note" : "coin");
const piece = (cents: number, count: number): string => {
  const name = `${fmtMoney(cents)} ${kindOf(cents)}`;
  return `${numberToWords(count)} ${name}${count === 1 ? "" : "s"}`;
};
const joinList = (items: string[]): string =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

interface Collection {
  items: Array<{ cents: number; count: number }>;
  total: number;
}

function makeCollection(rng: Rng, grade: number, difficulty: Difficulty): Collection {
  const max = MONEY_MAX[grade]!;
  const pool = DENOMINATIONS[grade]!.filter((v) => v < max);
  for (let tries = 0; tries < 500; tries++) {
    const kinds = rng.sample(pool, byLevel(difficulty, [2, 2, 3, 3, 4]));
    const items = kinds
      .sort((a, b) => b - a)
      .map((cents) => ({ cents, count: rng.int(1, byLevel(difficulty, [2, 3, 4, 4, 5])) }));
    const total = items.reduce((sum, i) => sum + i.cents * i.count, 0);
    if (total <= max && total >= 50) return { items, total };
  }
  throw new Error("makeCollection: none found");
}

export const moneyComposition = defineTemplate({
  id: "mea.money-composition",
  description: "Count a collection of notes and coins and find how many pieces make an amount.",
  covers: (o) =>
    scoped(o, {
      topic: MEA,
      strand: MONEY,
      text: /identify currency|composition of amounts|break down money|relationship between notes and coins/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const name = rng.pick(["Tendai", "Rudo", "Farai", "Chipo", "Nyasha", "Tapiwa"]);
    const mode = /composition|break down|relationship/i.test(o.text)
      ? rng.pick(["howmany", "howmany", "choose", "total"] as const)
      : "total";
    if (mode === "howmany") {
      const pool = DENOMINATIONS[o.grade]!.filter((v) => v <= 500);
      const cents = rng.pick(pool);
      const count = rng.int(2, byLevel(d, [5, 8, 10, 12, 20]));
      const total = cents * count;
      if (total > MONEY_MAX[o.grade]!) throw new Error("amount too large");
      return q.numeric({
        skill: "APPLICATION",
        type: "WORD_PROBLEM",
        stem: `How many ${fmtMoney(cents)} ${kindOf(cents)}s make ${fmtMoney(total)}?`,
        answer: String(count),
        wrongs: [
          { answer: String(count + 1), tag: "BASIC_FACT_ERROR" },
          { answer: String(count - 1), tag: "BASIC_FACT_ERROR" },
          { answer: String(total), tag: "OPERATION_CHOICE_ERROR" },
          {
            answer: String(Math.max(1, Math.round((total / cents) * 10))),
            tag: "UNIT_CONVERSION_ERROR",
          },
        ].filter((w) => Number(w.answer) !== count),
        solutionKind: "unit-conversion",
        explanation: `${fmtMoney(total)} ÷ ${fmtMoney(cents)} = ${count}. You need ${count} ${fmtMoney(cents)} ${kindOf(cents)}s.`,
        hints: [
          `Change the amounts to the same unit (all in cents, or all in dollars).`,
          `How many times does ${fmtMoney(cents)} fit into ${fmtMoney(total)}? Share the amount out, or count on in ${fmtMoney(cents)}s.`,
        ],
      });
    }
    const { items, total } = makeCollection(rng, o.grade, d);
    const sentence = joinList(items.map((i) => piece(i.cents, i.count)));
    if (mode === "choose") {
      const correct = items;
      const wrongSets: Collection[] = [];
      for (let tries = 0; tries < 20 && wrongSets.length < 3; tries++) {
        const copy = items.map((i) => ({ ...i }));
        const k = rng.int(0, copy.length - 1);
        copy[k]!.count = Math.max(1, copy[k]!.count + rng.pick([-1, 1]));
        const t = copy.reduce((s, i) => s + i.cents * i.count, 0);
        if (t !== total && t <= MONEY_MAX[o.grade]! && !wrongSets.some((w) => w.total === t))
          wrongSets.push({ items: copy, total: t });
      }
      const show = (c: typeof correct) => joinList(c.map((i) => piece(i.cents, i.count)));
      return q.mcq({
        skill: "APPLICATION",
        stem: `Which of these is worth exactly ${fmtMoney(total)}?`,
        correct: show(correct),
        wrongs: wrongSets.map((w) => ({ answer: show(w.items) })),
        explanation: `Add the value of each group: ${items.map((i) => `${i.count} × ${fmtMoney(i.cents)} = ${fmtMoney(i.cents * i.count)}`).join(", ")}. Together that is ${fmtMoney(total)}.`,
        hints: [
          "Work out how much each group of notes or coins is worth.",
          "Add the values of the groups and compare with the amount you need.",
        ],
      });
    }
    return moneyAnswer(q, {
      skill: "KNOWLEDGE_COMPREHENSION",
      type: "WORD_PROBLEM",
      stem: `${name} has ${sentence}. How much money does ${name} have altogether?`,
      cents: total,
      wrongs: [
        {
          cents: total - items[items.length - 1]!.cents * items[items.length - 1]!.count,
          tag: "BASIC_FACT_ERROR",
        },
        { cents: items.reduce((s, i) => s + i.cents, 0), tag: "OPERATION_CHOICE_ERROR" },
        { cents: total * 10, tag: "UNIT_CONVERSION_ERROR" },
        { cents: Math.round(total / 10), tag: "UNIT_CONVERSION_ERROR" },
      ],
      explanation: `${items.map((i) => `${i.count} × ${fmtMoney(i.cents)} = ${fmtMoney(i.cents * i.count)}`).join(", ")}. Adding: ${fmtMoney(total)}.`,
      hints: [
        "Work out how much each group of notes or coins is worth: the number of pieces times the value of one.",
        "Change everything to cents (or everything to dollars) before you add.",
        "Add the amounts together.",
      ],
    });
  },
});

// ── converting between dollars and cents ────────────────────────────────────────────────────────

export const moneyConversion = defineTemplate({
  id: "mea.money-convert",
  description: "Change cents to dollars and dollars to cents.",
  covers: (o) =>
    scoped(o, {
      topic: MEA,
      strand: MONEY,
      text: /convert cents to dollars|convert money from cents|express money in dollars and cents/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const max = MONEY_MAX[o.grade]!;
    const wholeDollars = rng.int(
      byLevel(d, [1, 1, 2, 3, 5]),
      Math.min(Math.floor(max / 100) - 1, byLevel(d, [5, 9, 20, 50, 200])),
    );
    const centPart =
      d <= 1 ? rng.pick([0, 50]) : d <= 2 ? rng.pick([0, 25, 50, 75]) : rng.int(1, 99);
    const cents = wholeDollars * 100 + centPart;
    const toDollars = rng.chance(0.5);
    if (toDollars) {
      return q.unit({
        skill: "APPLICATION",
        stem: `Write ${cents}c in dollars.`,
        value: dollarsText(cents),
        unit: "$",
        unitOptional: true,
        strictUnit: true,
        answerText: fmtMoney(cents),
        solutionKind: "unit-conversion",
        wrongs: [
          { answer: dollarsText(cents * 10), tag: "UNIT_CONVERSION_ERROR" },
          { answer: dollarsText(Math.round(cents / 10)), tag: "UNIT_CONVERSION_ERROR" },
          { answer: String(cents), tag: "UNIT_CONVERSION_ERROR" },
        ],
        explanation: `100c make $1. ${cents} ÷ 100 = ${dollarsText(cents)}, so ${cents}c = ${fmtMoney(cents)}.`,
        hints: [
          "There are 100 cents in one dollar.",
          "Changing cents to dollars gives a smaller number: divide by 100.",
        ],
      });
    }
    return q.unit({
      skill: "APPLICATION",
      stem: `Write ${fmtMoney(cents)} in cents.`,
      value: String(cents),
      unit: "c",
      unitOptional: true,
      strictUnit: true,
      answerText: `${cents}c`,
      solutionKind: "unit-conversion",
      wrongs: [
        { answer: String(cents * 10), tag: "UNIT_CONVERSION_ERROR" },
        { answer: String(Math.round(cents / 10)), tag: "UNIT_CONVERSION_ERROR" },
        { answer: String(cents / 100), tag: "UNIT_CONVERSION_ERROR" },
      ],
      explanation: `$1 is 100c. ${dollarsText(cents)} × 100 = ${cents}, so ${fmtMoney(cents)} = ${cents}c.`,
      hints: [
        "There are 100 cents in one dollar.",
        "Changing dollars to cents gives a bigger number: multiply by 100.",
      ],
    });
  },
});

// ── change ──────────────────────────────────────────────────────────────────────────────────────

interface ShopItem {
  name: string;
  cents: number;
}

const SHOP: Record<number, readonly ShopItem[]> = {
  3: [
    { name: "pen", cents: 40 },
    { name: "exercise book", cents: 60 },
    { name: "ruler", cents: 50 },
    { name: "loaf of bread", cents: 100 },
    { name: "packet of biscuits", cents: 75 },
    { name: "bottle of water", cents: 80 },
    { name: "school badge", cents: 150 },
    { name: "plastic lunch box", cents: 350 },
  ],
  4: [
    { name: "geometry set", cents: 450 },
    { name: "school bag", cents: 2250 },
    { name: "T-shirt", cents: 1200 },
    { name: "pair of socks", cents: 275 },
    { name: "loaf of bread", cents: 100 },
    { name: "story book", cents: 850 },
    { name: "calculator", cents: 800 },
  ],
  5: [
    { name: "school shirt", cents: 1450 },
    { name: "pair of shorts", cents: 1875 },
    { name: "atlas", cents: 2400 },
    { name: "football", cents: 3500 },
    { name: "dictionary", cents: 1250 },
    { name: "lunch box", cents: 925 },
  ],
  6: [
    { name: "pair of school shoes", cents: 4500 },
    { name: "school jersey", cents: 3250 },
    { name: "Mathematics textbook", cents: 2800 },
    { name: "sports kit", cents: 5600 },
    { name: "school bag", cents: 3850 },
    { name: "geometry set", cents: 650 },
  ],
  7: [
    { name: "pair of school shoes", cents: 6500 },
    { name: "school blazer", cents: 8250 },
    { name: "bicycle helmet", cents: 4800 },
    { name: "tablet cover", cents: 2950 },
    { name: "set of textbooks", cents: 12500 },
    { name: "school uniform set", cents: 9800 },
  ],
};

const PAYMENTS: Record<number, readonly number[]> = {
  3: [100, 200, 500, 1000],
  4: [200, 500, 1000, 2000, 5000],
  5: [500, 1000, 2000, 5000, 10000],
  6: [1000, 2000, 5000, 10000, 20000],
  7: [2000, 5000, 10000, 20000, 50000],
};

export const moneyChange = defineTemplate({
  id: "mea.money-change",
  description: "Work out the change from buying and selling.",
  covers: (o) => scoped(o, { topic: MEA, strand: MONEY, text: /change/i, not: /exchange/i }),
  generate: ({ objective: o, difficulty: d, rng, q, local }) => {
    const name = rng.pick(["Tendai", "Rudo", "Farai", "Chipo", "Nyasha", "Tapiwa"]);
    const shop = SHOP[o.grade]!;
    const count = byLevel(d, [1, 1, 2, 2, 3]);
    let items: ShopItem[] = [];
    let total = 0;
    let paid = 0;
    for (let tries = 0; tries < 300; tries++) {
      items = rng.sample(shop, count);
      total = items.reduce((s, i) => s + i.cents, 0);
      const options = PAYMENTS[o.grade]!.filter(
        (p) => p > total && p - total <= MONEY_MAX[o.grade]!,
      );
      if (options.length > 0 && total <= MONEY_MAX[o.grade]!) {
        paid = rng.pick(options.slice(0, 3));
        break;
      }
    }
    if (paid === 0) throw new Error("moneyChange: no case");
    const change = paid - total;
    const list = joinList(items.map((i) => `a ${i.name} for ${fmtMoney(i.cents)}`));
    const place = local && o.grade <= 4 ? "tuck shop" : "shop";
    return moneyAnswer(q, {
      skill: d >= 4 ? "PROBLEM_SOLVING" : "APPLICATION",
      type: "WORD_PROBLEM",
      stem: `${name} buys ${list} at the ${place} and pays with ${fmtMoney(paid)}. How much change should ${name} get?`,
      cents: change,
      local: local && o.grade <= 4,
      wrongs: [
        { cents: paid + total, tag: "OPERATION_CHOICE_ERROR" },
        { cents: total, tag: "OPERATION_CHOICE_ERROR" },
        { cents: change + (change >= 100 ? 100 : 10), tag: "BASIC_FACT_ERROR" },
        { cents: Math.abs(change - 5), tag: "BASIC_FACT_ERROR" },
        { cents: change * 10, tag: "UNIT_CONVERSION_ERROR" },
      ],
      explanation: `${count > 1 ? `Total cost: ${items.map((i) => fmtMoney(i.cents)).join(" + ")} = ${fmtMoney(total)}. ` : ""}Change = amount paid − cost = ${fmtMoney(paid)} − ${fmtMoney(total)} = ${fmtMoney(change)}.`,
      hints: [
        count > 1
          ? "First find the total cost of everything bought."
          : "Change is what is left from the money paid.",
        "Subtract the cost from the amount paid. Write both amounts in the same unit first.",
        "Check by adding the change to the cost: you should get back to the amount paid.",
      ],
    });
  },
});

export const moneyOperations = defineTemplate({
  id: "mea.money-operations",
  description: "Add, subtract, multiply and divide amounts of money.",
  covers: (o) => scoped(o, { topic: MEA, strand: MONEY, text: /operations involving money/i }),
  generate: ({ objective: o, difficulty: d, rng, q, local }) => {
    const max = MONEY_MAX[o.grade]!;
    const item = rng.pick(SHOP[o.grade]!.filter((i) => i.cents <= max / 6));
    const kind = rng.pick(
      d <= 2 ? (["times", "total"] as const) : (["times", "total", "share", "left"] as const),
    );
    const name = rng.pick(["Tendai", "Rudo", "Farai", "Chipo"]);
    if (kind === "times") {
      const n = rng.int(2, byLevel(d, [4, 6, 8, 9, 12]));
      const total = item.cents * n;
      if (total > max) throw new Error("amount too large");
      return moneyAnswer(q, {
        skill: "APPLICATION",
        type: "WORD_PROBLEM",
        stem: `One ${item.name} costs ${fmtMoney(item.cents)}. How much do ${n} ${item.name}s cost?`,
        cents: total,
        wrongs: [
          { cents: item.cents + n, tag: "OPERATION_CHOICE_ERROR" },
          { cents: total * 10, tag: "UNIT_CONVERSION_ERROR" },
          { cents: total + item.cents, tag: "BASIC_FACT_ERROR" },
          { cents: Math.round(total / 10), tag: "UNIT_CONVERSION_ERROR" },
        ],
        explanation: `${n} × ${fmtMoney(item.cents)} = ${fmtMoney(total)}.`,
        hints: [
          "The same price is paid again and again, so multiply.",
          `Work out ${n} × ${item.cents}c, then change the answer to dollars if you can.`,
        ],
      });
    }
    if (kind === "total") {
      const others = rng.sample(
        SHOP[o.grade]!.filter((i) => i.name !== item.name),
        2,
      );
      const all = [item, ...others];
      const total = all.reduce((s, i) => s + i.cents, 0);
      if (total > max) throw new Error("amount too large");
      return moneyAnswer(q, {
        skill: "APPLICATION",
        type: "WORD_PROBLEM",
        stem: `${name} buys ${joinList(all.map((i) => `a ${i.name} (${fmtMoney(i.cents)})`))}. How much does ${name} spend altogether?`,
        cents: total,
        wrongs: [
          { cents: total - all[all.length - 1]!.cents, tag: "BASIC_FACT_ERROR" },
          { cents: total + 100, tag: "CARRYING_ERROR" },
          { cents: total * 10, tag: "UNIT_CONVERSION_ERROR" },
        ],
        explanation: `${all.map((i) => fmtMoney(i.cents)).join(" + ")} = ${fmtMoney(total)}.`,
        hints: [
          "Add the prices of everything that was bought.",
          "Change every price to cents (or every price to dollars) before you add.",
        ],
      });
    }
    if (kind === "share") {
      const n = rng.pick([2, 4, 5]);
      const each = rng.int(2, byLevel(d, [20, 50, 150, 400, 900])) * 5;
      const total = each * n;
      if (total > max) throw new Error("amount too large");
      return moneyAnswer(q, {
        skill: "APPLICATION",
        type: "WORD_PROBLEM",
        stem: `${fmtMoney(total)} is shared equally among ${n} children${local ? " at a school fun day" : ""}. How much does each child get?`,
        cents: each,
        local,
        wrongs: [
          { cents: total - n, tag: "OPERATION_CHOICE_ERROR" },
          { cents: each * 10, tag: "UNIT_CONVERSION_ERROR" },
          { cents: Math.round(each / 10), tag: "UNIT_CONVERSION_ERROR" },
          { cents: each + 5, tag: "BASIC_FACT_ERROR" },
        ],
        explanation: `${fmtMoney(total)} ÷ ${n} = ${fmtMoney(each)}.`,
        hints: [
          "Sharing equally means dividing.",
          `Change the amount to cents first: ${total}c ÷ ${n}.`,
        ],
      });
    }
    const budget = MONEY_MAX[o.grade]!;
    const start = rng.int(Math.floor(budget / 2), budget);
    const spend = rng.int(Math.floor(start / 5), Math.floor(start / 2));
    return moneyAnswer(q, {
      skill: "APPLICATION",
      type: "WORD_PROBLEM",
      stem: `${name} has ${fmtMoney(start - (start % 5))} and spends ${fmtMoney(spend - (spend % 5))}. How much money is left?`,
      cents: start - (start % 5) - (spend - (spend % 5)),
      wrongs: [
        { cents: start - (start % 5) + (spend - (spend % 5)), tag: "OPERATION_CHOICE_ERROR" },
        { cents: start - (start % 5) - (spend - (spend % 5)) + 100, tag: "BORROWING_ERROR" },
        {
          cents: Math.round((start - (start % 5) - (spend - (spend % 5))) / 10),
          tag: "UNIT_CONVERSION_ERROR",
        },
      ],
      explanation: `${fmtMoney(start - (start % 5))} − ${fmtMoney(spend - (spend % 5))} = ${fmtMoney(start - (start % 5) - (spend - (spend % 5)))}.`,
      hints: [
        "Money that is spent is taken away, so subtract.",
        "Write both amounts in cents (or both in dollars) and subtract column by column.",
      ],
    });
  },
});

// ── invoices ────────────────────────────────────────────────────────────────────────────────────

export const moneyInvoice = defineTemplate({
  id: "mea.invoice",
  description: "Complete an invoice (quantity × price for each line, then the total).",
  covers: (o) => scoped(o, { topic: MEA, strand: MONEY, text: /invoice/i }),
  generate: ({ objective: o, difficulty: d, rng, q, local }) => {
    const lines = byLevel(d, [2, 2, 3, 3, 4]);
    const catalogue = local
      ? [
          { name: "Exercise books", cents: 85 },
          { name: "Ball-point pens", cents: 40 },
          { name: "Rulers", cents: 60 },
          { name: "Chalk (boxes)", cents: 150 },
          { name: "Mathematics sets", cents: 325 },
          { name: "Brooms", cents: 450 },
        ]
      : [
          { name: "Notebooks", cents: 120 },
          { name: "Pencils", cents: 25 },
          { name: "Erasers", cents: 35 },
          { name: "Folders", cents: 240 },
          { name: "Staplers", cents: 650 },
          { name: "Scissors", cents: 180 },
        ];
    const items = rng.sample(catalogue, lines).map((item) => ({
      ...item,
      quantity: rng.int(2, byLevel(d, [6, 10, 12, 20, 30])),
    }));
    const amounts = items.map((i) => i.cents * i.quantity);
    const total = amounts.reduce((a, b) => a + b, 0);
    if (total > MONEY_MAX[o.grade]!) throw new Error("amount too large");
    const wrongTotal = items.reduce((s, i) => s + i.cents + i.quantity * 5, 0);
    return moneyAnswer(q, {
      skill: "PROBLEM_SOLVING",
      type: "WORD_PROBLEM",
      stem: "A shop wrote this invoice for a school. What is the total amount due?",
      stemData: {
        kind: "table",
        caption: "Invoice",
        headers: ["Item", "Quantity", "Price each", "Amount"],
        rows: [
          ...items.map((i, k) => [
            i.name,
            String(i.quantity),
            fmtMoney(i.cents),
            fmtMoney(amounts[k]!),
          ]),
          ["Total", "", "", "?"],
        ],
      },
      cents: total,
      local,
      wrongs: [
        { cents: items.reduce((s, i) => s + i.cents, 0), tag: "OPERATION_CHOICE_ERROR" },
        { cents: total - amounts[amounts.length - 1]!, tag: "BASIC_FACT_ERROR" },
        { cents: total * 10, tag: "UNIT_CONVERSION_ERROR" },
        { cents: Math.round(total / 10), tag: "UNIT_CONVERSION_ERROR" },
        { cents: wrongTotal },
      ],
      explanation: `Amount for each line = quantity × price each: ${items.map((i, k) => `${i.quantity} × ${fmtMoney(i.cents)} = ${fmtMoney(amounts[k]!)}`).join("; ")}. Total = ${amounts.map(fmtMoney).join(" + ")} = ${fmtMoney(total)}.`,
      hints: [
        "On an invoice, each amount is the quantity multiplied by the price of one.",
        "Work out the amount for every line first.",
        "Then add all the amounts to get the total.",
      ],
    });
  },
});

// ── profit and loss ─────────────────────────────────────────────────────────────────────────────

export const profitAndLoss = defineTemplate({
  id: "mea.profit-loss",
  description: "Decide whether a sale made a profit or a loss, and by how much.",
  covers: (o) => scoped(o, { topic: MEA, strand: MONEY, text: /profit or loss/i }),
  generate: ({ objective: o, difficulty: d, rng, q, local }) => {
    const max = MONEY_MAX[o.grade]!;
    const cost = rng.int(Math.floor(max / 40), Math.floor(max / 4)) - (0 % 5);
    const costCents = cost - (cost % 25);
    const margin = rng.int(1, byLevel(d, [4, 6, 8, 10, 10])) * (costCents >= 1000 ? 100 : 25);
    const profit = rng.chance(0.55);
    const selling = profit ? costCents + margin : Math.max(25, costCents - margin);
    const difference = Math.abs(selling - costCents);
    const thing = local
      ? rng.pick([
          "a goat",
          "a bag of maize meal",
          "a bicycle",
          "a sewing machine",
          "a bundle of firewood",
        ])
      : rng.pick(["a bicycle", "a radio", "a school bag", "a watch", "a football"]);
    const name = rng.pick(["Tendai", "Rudo", "Farai", "Chipo", "Nyasha", "Tapiwa"]);
    const label = profit ? "profit" : "loss";
    const other = profit ? "loss" : "profit";
    return q.multiPart({
      skill: "PROBLEM_SOLVING",
      type: "WORD_PROBLEM",
      stem: `${name} buys ${thing} for ${fmtMoney(costCents)} and sells it for ${fmtMoney(selling)}. Did ${name} make a profit or a loss, and how much?`,
      usesLocalContext: local,
      parts: [
        {
          id: "kind",
          label: "Profit or loss?",
          answer: label,
          spec: { method: "TEXT_NORMALISED", accepted: [label] },
          wrongs: [{ answer: other, tag: "PROFIT_LOSS_CONFUSION" }],
        },
        {
          id: "amount",
          label: "How much? ($)",
          unit: "$",
          answer: fmtMoney(difference),
          spec: {
            method: "NUMERIC_WITH_UNIT",
            value: dollarsText(difference),
            unit: "$",
            unitOptional: true,
            strictUnit: false,
          },
          wrongs: [
            { answer: dollarsText(selling + costCents), tag: "OPERATION_CHOICE_ERROR" },
            { answer: dollarsText(difference * 10), tag: "UNIT_CONVERSION_ERROR" },
            { answer: dollarsText(Math.round(difference / 10)), tag: "UNIT_CONVERSION_ERROR" },
          ].filter((w) => w.answer !== dollarsText(difference)),
        },
      ],
      explanation: `${name} paid ${fmtMoney(costCents)} (cost price) and received ${fmtMoney(selling)} (selling price). The selling price is ${profit ? "more" : "less"} than the cost price, so it is a ${label}: ${profit ? fmtMoney(selling) + " − " + fmtMoney(costCents) : fmtMoney(costCents) + " − " + fmtMoney(selling)} = ${fmtMoney(difference)}.`,
      hints: [
        "Compare the price paid (cost price) with the price received (selling price).",
        "If the seller got back MORE money than was paid, the seller gained. If the seller got back LESS, the seller lost money.",
        "Subtract the smaller amount from the bigger one to find how much.",
      ],
    });
  },
});

// ── exchange rates ──────────────────────────────────────────────────────────────────────────────

export const exchangeRate = defineTemplate({
  id: "mea.exchange",
  description: "Use an exchange rate to change between two currencies.",
  covers: (o) => scoped(o, { topic: MEA, strand: MONEY, text: /exchange rate/i }),
  generate: ({ difficulty: d, rng, q }) => {
    const other = rng.pick([
      { name: "South African rand", symbol: "rand", rate: 18 },
      { name: "Botswana pula", symbol: "pula", rate: 13 },
      { name: "Zambian kwacha", symbol: "kwacha", rate: 25 },
    ]);
    const dollars = rng.int(byLevel(d, [2, 5, 10, 20, 50]), byLevel(d, [9, 20, 50, 200, 500]));
    const toOther = d <= 3 || rng.chance(0.5);
    if (toOther) {
      const answer = dollars * other.rate;
      return q.numeric({
        skill: "APPLICATION",
        type: "WORD_PROBLEM",
        stem: `In this question the exchange rate is $1 = ${other.rate} ${other.symbol}. How many ${other.symbol} can you get for $${dollars}?`,
        answer: String(answer),
        wrongs: [
          { answer: String(Math.round(dollars / other.rate)), tag: "OPERATION_CHOICE_ERROR" },
          { answer: String(dollars + other.rate), tag: "OPERATION_CHOICE_ERROR" },
          { answer: String(answer + other.rate), tag: "BASIC_FACT_ERROR" },
        ].filter((w) => Number(w.answer) !== answer && Number(w.answer) > 0),
        explanation: `Each $1 buys ${other.rate} ${other.symbol}, so $${dollars} buys ${dollars} × ${other.rate} = ${answer} ${other.symbol}.`,
        hints: [
          "The exchange rate tells you how much of the other money ONE dollar buys.",
          `So for ${dollars} dollars you need ${dollars} lots of that amount: multiply.`,
        ],
      });
    }
    const amount = dollars * other.rate;
    return q.numeric({
      skill: "APPLICATION",
      type: "WORD_PROBLEM",
      stem: `In this question the exchange rate is $1 = ${other.rate} ${other.symbol}. How many dollars can you get for ${amount} ${other.symbol}?`,
      answer: String(dollars),
      wrongs: [
        { answer: String(amount * other.rate), tag: "OPERATION_CHOICE_ERROR" },
        { answer: String(amount - other.rate), tag: "OPERATION_CHOICE_ERROR" },
        { answer: String(dollars + 1), tag: "BASIC_FACT_ERROR" },
      ].filter((w) => Number(w.answer) !== dollars && Number(w.answer) > 0),
      explanation: `Each $1 is worth ${other.rate} ${other.symbol}. To find how many dollars, share ${amount} into groups of ${other.rate}: ${amount} ÷ ${other.rate} = ${dollars}.`,
      hints: [
        `One dollar is worth ${other.rate} ${other.symbol}. How many lots of ${other.rate} are in ${amount}?`,
        "Going from the smaller unit back to dollars needs division.",
      ],
    });
  },
});

// ── financial transactions and budgets ──────────────────────────────────────────────────────────

export const financialTransactions = defineTemplate({
  id: "mea.financial",
  description: "Banking, discount, simple interest, hire purchase and household budgets.",
  covers: (o) => scoped(o, { topic: MEA, strand: MONEY, text: /financial transactions|budgets/i }),
  generate: ({ objective: o, difficulty: d, rng, q, local }) => {
    const name = rng.pick(["Tendai", "Rudo", "Farai", "Chipo", "Nyasha", "Tapiwa"]);
    const budget = /budget/i.test(o.text);
    const kind = budget
      ? "budget"
      : rng.pick(
          d <= 2
            ? (["bank", "discount"] as const)
            : (["bank", "discount", "interest", "hire"] as const),
        );
    const dollar = (n: number) => `$${n}`;
    if (kind === "budget") {
      const income = rng.pick([240, 300, 350, 420, 480, 500]);
      const lines = [
        ["food", rng.int(Math.floor(income * 0.3), Math.floor(income * 0.4))],
        ["rent", rng.int(Math.floor(income * 0.2), Math.floor(income * 0.3))],
        ["transport", rng.int(Math.floor(income * 0.05), Math.floor(income * 0.1))],
        ["school fees", rng.int(Math.floor(income * 0.08), Math.floor(income * 0.15))],
      ] as Array<[string, number]>;
      const spent = lines.reduce((s, [, v]) => s + v, 0);
      const saved = income - spent;
      if (saved <= 0) throw new Error("budget overspent");
      return q.numeric({
        skill: "PROBLEM_SOLVING",
        type: "WORD_PROBLEM",
        stem: `A family's monthly budget: income ${dollar(income)}. Spending: ${lines.map(([n, v]) => `${n} ${dollar(v)}`).join(", ")}. How much money is left to save?`,
        answer: String(saved),
        wrongs: [
          { answer: String(income + spent), tag: "OPERATION_CHOICE_ERROR" },
          { answer: String(saved + lines[lines.length - 1]![1]), tag: "BASIC_FACT_ERROR" },
          { answer: String(spent), tag: "OPERATION_CHOICE_ERROR" },
        ],
        usesLocalContext: local,
        explanation: `Total spending = ${lines.map(([, v]) => dollar(v)).join(" + ")} = ${dollar(spent)}. Money left = income − spending = ${dollar(income)} − ${dollar(spent)} = ${dollar(saved)}.`,
        hints: [
          "A budget compares the money coming in (income) with the money going out (spending).",
          "Add up all the spending first.",
          "Subtract the total spending from the income.",
        ],
      });
    }
    if (kind === "bank") {
      const balance = rng.int(5, 40) * 10;
      const deposit = rng.int(2, 20) * 5;
      const withdraw = rng.int(1, Math.floor((balance + deposit) / 10)) * 5;
      const answer = balance + deposit - withdraw;
      return q.numeric({
        skill: "APPLICATION",
        type: "WORD_PROBLEM",
        stem: `${name} has ${dollar(balance)} in a savings account. ${name} deposits ${dollar(deposit)} and later withdraws ${dollar(withdraw)}. What is the balance in the account now?`,
        answer: String(answer),
        wrongs: [
          { answer: String(balance - deposit - withdraw), tag: "OPERATION_CHOICE_ERROR" },
          { answer: String(balance + deposit + withdraw), tag: "OPERATION_CHOICE_ERROR" },
          { answer: String(balance + deposit), tag: "OPERATION_CHOICE_ERROR" },
        ].filter((w) => Number(w.answer) !== answer),
        explanation: `A deposit adds money and a withdrawal takes money out: ${dollar(balance)} + ${dollar(deposit)} − ${dollar(withdraw)} = ${dollar(answer)}.`,
        hints: [
          "A deposit puts money INTO the account. A withdrawal takes money OUT.",
          "Start with the balance, add the deposit, then subtract the withdrawal.",
        ],
      });
    }
    if (kind === "discount") {
      const percent = rng.pick([10, 20, 25, 50]);
      const price = rng.int(2, 20) * 20;
      const discount = (price * percent) / 100;
      if (!Number.isInteger(discount)) throw new Error("discount not whole");
      return q.numeric({
        skill: "PROBLEM_SOLVING",
        type: "WORD_PROBLEM",
        stem: `A shop sells a ${rng.pick(["jacket", "pair of shoes", "school bag", "radio"])} for ${dollar(price)}. During a sale there is a ${percent}% discount. What is the sale price?`,
        answer: String(price - discount),
        wrongs: [
          { answer: String(discount), tag: "OPERATION_CHOICE_ERROR" },
          { answer: String(price + discount), tag: "OPERATION_CHOICE_ERROR" },
          { answer: String(price - percent), tag: "PERCENT_CONVERSION_ERROR" },
        ].filter((w) => Number(w.answer) !== price - discount),
        explanation: `${percent}% of ${dollar(price)} = ${dollar(discount)} is taken off. Sale price = ${dollar(price)} − ${dollar(discount)} = ${dollar(price - discount)}.`,
        hints: [
          "A discount is an amount taken OFF the price.",
          `Find ${percent}% of the price first (${percent}% means ${percent} out of every 100).`,
          "Subtract the discount from the original price.",
        ],
      });
    }
    if (kind === "interest") {
      const rate = rng.pick([2, 4, 5, 10]);
      const principal = rng.int(2, 20) * 50;
      const years = d >= 5 ? rng.int(2, 4) : 1;
      const interest = (principal * rate * years) / 100;
      if (!Number.isInteger(interest)) throw new Error("interest not whole");
      return q.numeric({
        skill: "PROBLEM_SOLVING",
        type: "WORD_PROBLEM",
        stem: `${name} puts ${dollar(principal)} into a savings account that pays simple interest of ${rate}% per year. How much interest does the money earn in ${years === 1 ? "one year" : `${years} years`}?`,
        answer: String(interest),
        wrongs: [
          { answer: String(principal + interest), tag: "OPERATION_CHOICE_ERROR" },
          { answer: String((principal * rate) / 100), tag: "BASIC_FACT_ERROR" },
          { answer: String(interest * 10), tag: "PERCENT_CONVERSION_ERROR" },
        ].filter((w) => Number(w.answer) !== interest),
        explanation: `Interest for one year = ${rate}% of ${dollar(principal)} = ${dollar((principal * rate) / 100)}.${years > 1 ? ` For ${years} years: ${dollar((principal * rate) / 100)} × ${years} = ${dollar(interest)}.` : ""}`,
        hints: [
          `${rate}% means ${rate} out of every 100. Find ${rate}% of ${dollar(principal)}.`,
          years > 1
            ? "Simple interest is the same amount every year. Multiply by the number of years."
            : "That is the interest for one year.",
        ],
      });
    }
    const cash = rng.int(8, 40) * 10;
    const deposit = Math.round((cash * rng.pick([0.1, 0.2, 0.25])) / 5) * 5;
    const months = rng.pick([6, 10, 12]);
    const instalment = Math.ceil((cash - deposit) / months / 5) * 5 + 5;
    const hire = deposit + instalment * months;
    return q.numeric({
      skill: "PROBLEM_SOLVING",
      type: "WORD_PROBLEM",
      stem: `A fridge costs ${dollar(cash)} cash. On hire purchase, ${name}'s family pays a deposit of ${dollar(deposit)} and then ${dollar(instalment)} a month for ${months} months. What is the total hire purchase price?`,
      answer: String(hire),
      wrongs: [
        { answer: String(instalment * months), tag: "BASIC_FACT_ERROR" },
        { answer: String(deposit + instalment + months), tag: "OPERATION_CHOICE_ERROR" },
        { answer: String(hire - deposit * 2), tag: "BASIC_FACT_ERROR" },
      ].filter((w) => Number(w.answer) !== hire),
      explanation: `Monthly payments: ${dollar(instalment)} × ${months} = ${dollar(instalment * months)}. Add the deposit: ${dollar(instalment * months)} + ${dollar(deposit)} = ${dollar(hire)}.`,
      hints: [
        "On hire purchase you pay a deposit first and then regular payments.",
        "Work out the total of the monthly payments, then add the deposit.",
      ],
    });
  },
});

export const moneyTemplates = [
  moneyComposition,
  moneyConversion,
  moneyChange,
  moneyOperations,
  moneyInvoice,
  profitAndLoss,
  exchangeRate,
  financialTransactions,
];
