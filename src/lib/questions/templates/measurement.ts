import { numberToWords } from "../../marking/words";
import {
  anyScope,
  byLevel,
  defineTemplate,
  fmtDecimal,
  fmtInt,
  joinWords,
  scoped,
  type Builders,
  type Wrong,
} from "../kit";
import { trimmedDecimal } from "../maths";
import type { AssessmentSkill, QuestionType, StemData } from "../types";

/**
 * Measuring mass, length, capacity and volume: reading scales, rulers and jugs, converting between
 * units, comparing, estimating, operations, gross/net/tare mass, volume of cuboids and by
 * displacement. Ranges follow the printed Content for each grade.
 */

const MEA = "MEA" as const;
const NAMES = ["Tendai", "Rudo", "Farai", "Chipo", "Nyasha", "Tapiwa", "Anesu", "Thandiwe"];

/** A number with a unit, marked as an amount. */
interface Amount {
  skill: AssessmentSkill;
  type?: Extract<QuestionType, "NUMERIC" | "WORD_PROBLEM" | "VISUAL_DIAGRAM" | "FILL_IN_THE_BLANK">;
  stem: string;
  stemData?: StemData;
  value: string;
  unit: string;
  /** How the answer is shown afterwards ("2 500 g"). */
  show?: string;
  /** The answer must be in exactly this unit (conversions). */
  strict?: boolean;
  wrongs: Array<{ value: string; tag?: string }>;
  explanation: string;
  hints: string[];
  solutionKind?: string;
  local?: boolean;
  answerHint?: string;
}

function amount(q: Builders, a: Amount) {
  const wrongs: Wrong[] = a.wrongs
    .filter((w) => w.value !== a.value && Number.isFinite(Number(w.value)) && Number(w.value) >= 0)
    .map((w) => ({ answer: w.value, ...(w.tag ? { tag: w.tag } : {}) }));
  return q.unit({
    skill: a.skill,
    type: a.type ?? "NUMERIC",
    stem: a.stem,
    ...(a.stemData ? { stemData: a.stemData } : {}),
    value: a.value,
    unit: a.unit,
    unitOptional: true,
    strictUnit: a.strict ?? false,
    answerText: a.show ?? `${fmtDecimal(a.value)} ${a.unit}`,
    wrongs,
    explanation: a.explanation,
    hints: a.hints,
    usesLocalContext: a.local ?? false,
    ...(a.solutionKind ? { solutionKind: a.solutionKind } : {}),
    ...(a.answerHint ? { answerHint: a.answerHint } : {}),
  });
}

const dec = (n: number, dp: number): string => trimmedDecimal(Math.round(n * 10 ** dp), dp);

// ── mass ────────────────────────────────────────────────────────────────────────────────────────

const PARCELS = ["bag of sugar", "bag of rice", "parcel", "tin of maize meal", "box of books"];

export const massWeights = defineTemplate({
  id: "mea.mass-weights",
  description: "Find and compare masses balanced by standard weights (100 g, 200 g, 500 g, 1 kg).",
  covers: (o) => scoped(o, { topic: MEA, grades: [3], strand: /^mass$/, text: /using weights/i }),
  generate: ({ objective: o, difficulty: d, rng, q, local }) => {
    const weights = [100, 200, 500, 1000];
    const set = (count: number): number[] =>
      Array.from({ length: count }, () => rng.pick(weights)).sort((a, b) => b - a);
    const show = (g: number) => (g === 1000 ? "1 kg" : `${g} g`);
    const thing = local
      ? rng.pick(["bag of maize meal", "bag of sugar", "tin of cooking oil"])
      : rng.pick(PARCELS);
    if (/compare/i.test(o.text)) {
      let a: number[] = [];
      let b: number[] = [];
      for (let tries = 0; tries < 100; tries++) {
        a = set(rng.int(2, byLevel(d, [2, 3, 3, 4, 4])));
        b = set(rng.int(2, byLevel(d, [2, 3, 3, 4, 4])));
        if (a.reduce((x, y) => x + y, 0) !== b.reduce((x, y) => x + y, 0)) break;
      }
      const ta = a.reduce((x, y) => x + y, 0);
      const tb = b.reduce((x, y) => x + y, 0);
      const heavier = ta > tb ? "Parcel A" : "Parcel B";
      return q.mcq({
        skill: "ANALYSIS",
        stem: `Parcel A balances with weights of ${joinWords(a.map(show))}. Parcel B balances with weights of ${joinWords(b.map(show))}. Which parcel is heavier?`,
        correct: heavier,
        wrongs: [
          { answer: ta > tb ? "Parcel B" : "Parcel A" },
          { answer: "They have the same mass" },
        ],
        explanation: `Parcel A: ${a.map(show).join(" + ")} = ${ta} g. Parcel B: ${b.map(show).join(" + ")} = ${tb} g. ${heavier} is heavier.`,
        hints: [
          "Find the total mass of the weights for each parcel. Write 1 kg as 1 000 g so all the masses are in grams.",
          "Compare the two totals.",
        ],
      });
    }
    const weightsUsed = set(rng.int(2, byLevel(d, [2, 3, 3, 4, 5])));
    const total = weightsUsed.reduce((x, y) => x + y, 0);
    return amount(q, {
      skill: "APPLICATION",
      type: "WORD_PROBLEM",
      stem: `A ${thing} balances with weights of ${joinWords(weightsUsed.map(show))}. What is the mass of the ${thing} in grams?`,
      value: String(total),
      unit: "g",
      show: `${fmtInt(total)} g`,
      wrongs: [
        ...(weightsUsed.includes(1000)
          ? [{ value: String(total - 999), tag: "UNIT_CONVERSION_ERROR" }]
          : []),
        { value: String(total - weightsUsed[weightsUsed.length - 1]!), tag: "BASIC_FACT_ERROR" },
        { value: String(total + 100), tag: "BASIC_FACT_ERROR" },
        { value: String(total / 10), tag: "UNIT_CONVERSION_ERROR" },
      ],
      local,
      solutionKind: "unit-conversion",
      explanation: `Add the weights, writing 1 kg as 1 000 g: ${weightsUsed.map((w) => `${w} g`).join(" + ")} = ${fmtInt(total)} g.`,
      hints: [
        "The weights add up to the mass of the object.",
        "Make sure every weight is in grams: 1 kg = 1 000 g.",
        "Add the weights together.",
      ],
    });
  },
});

export const massScale = defineTemplate({
  id: "mea.mass-scale",
  description: "Read a mass from a dial scale.",
  covers: (o) =>
    scoped(o, {
      topic: MEA,
      strand: /^mass$/,
      text: /find the mass of different objects|measure mass$/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const metric =
      o.grade <= 4
        ? d <= 2 || rng.chance(0.5)
          ? ({ max: 5, step: 0.5, label: 1, unit: "kg" } as const)
          : ({ max: 10, step: 0.5, label: 2, unit: "kg" } as const)
        : rng.pick([
            { max: 100, step: 5, label: 20, unit: "kg" },
            { max: 20, step: 1, label: 5, unit: "kg" },
            { max: 1000, step: 50, label: 250, unit: "g" },
          ] as const);
    const ticks = Math.round(metric.max / metric.step);
    let reading = rng.int(1, ticks - 1) * metric.step;
    for (let tries = 0; tries < 20 && d >= 3 && reading % metric.label === 0; tries++)
      reading = rng.int(1, ticks - 1) * metric.step;
    const text = trimmedDecimal(Math.round(reading * 100), 2);
    const below = Math.floor(reading / metric.label) * metric.label;
    return amount(q, {
      skill: "KNOWLEDGE_COMPREHENSION",
      type: "VISUAL_DIAGRAM",
      stem: `The scale measures mass in ${metric.unit === "kg" ? "kilograms" : "grams"}. What mass does the pointer show?`,
      stemData: {
        kind: "dial-scale",
        max: metric.max,
        reading,
        unit: metric.unit,
        step: metric.step,
        labelEvery: metric.label,
      },
      value: text,
      unit: metric.unit,
      wrongs: [
        { value: dec(below, 2), tag: "GRAPH_READING_ERROR" },
        { value: dec(reading + metric.step, 2), tag: "GRAPH_READING_ERROR" },
        { value: dec(reading - metric.step, 2), tag: "GRAPH_READING_ERROR" },
        { value: dec(below + metric.label, 2), tag: "GRAPH_READING_ERROR" },
      ],
      explanation: `The pointer is ${trimmedDecimal(Math.round(((reading - below) / metric.step) * 100), 2)} small steps after the mark ${below}. Each small step is ${metric.step} ${metric.unit}, so the mass is ${text} ${metric.unit}.`,
      hints: [
        "Find the last numbered mark before the pointer.",
        "Work out what each small step on the scale is worth: divide the gap between two numbered marks by the number of small steps.",
        "Count the small steps from the numbered mark to the pointer and add them on.",
      ],
    });
  },
});

export const massConversion = defineTemplate({
  id: "mea.mass-convert",
  description: "Change between kilograms and grams.",
  covers: (o) =>
    scoped(o, {
      topic: MEA,
      strand: /^mass$/,
      text: /convert kilograms|change grams|convert grammes|change grammes/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const toGrams = /^convert kilograms/i.test(o.text) ? true : rng.chance(0.5);
    const maxKg = ({ 4: 10, 5: 100, 6: 1000, 7: 1000 } as Record<number, number>)[o.grade]!;
    const wholeKg = rng.int(1, Math.min(maxKg - 1, byLevel(d, [5, 9, 30, 80, 900])));
    const halves = d >= 3 && o.grade >= 4 && rng.chance(0.5);
    const fraction = halves
      ? rng.pick(o.grade === 4 ? [0.5] : [0.25, 0.5, 0.75, 0.1, 0.2, 0.4])
      : 0;
    const kg = wholeKg + fraction;
    const kgText = trimmedDecimal(Math.round(kg * 100), 2);
    const grams = Math.round(kg * 1000);
    const common = {
      skill: "APPLICATION" as const,
      type: "FILL_IN_THE_BLANK" as const,
      solutionKind: "unit-conversion",
      strict: true,
    };
    if (toGrams) {
      return amount(q, {
        ...common,
        stem: `${fmtDecimal(kgText)} kg = ___ g`,
        value: String(grams),
        unit: "g",
        show: `${fmtInt(grams)} g`,
        wrongs: [
          { value: String(grams / 10), tag: "UNIT_CONVERSION_ERROR" },
          { value: String(grams / 100), tag: "UNIT_CONVERSION_ERROR" },
          { value: String(grams * 10), tag: "UNIT_CONVERSION_ERROR" },
          { value: kgText, tag: "UNIT_CONVERSION_ERROR" },
        ],
        explanation: `1 kg = 1 000 g, so ${fmtDecimal(kgText)} kg = ${fmtDecimal(kgText)} × 1 000 = ${fmtInt(grams)} g.`,
        hints: [
          "There are 1 000 grams in 1 kilogram.",
          "Changing to the smaller unit gives a bigger number: multiply by 1 000.",
        ],
      });
    }
    return amount(q, {
      ...common,
      stem: `${fmtInt(grams)} g = ___ kg`,
      value: kgText,
      unit: "kg",
      show: `${fmtDecimal(kgText)} kg`,
      wrongs: [
        { value: trimmedDecimal(grams, 2), tag: "UNIT_CONVERSION_ERROR" },
        { value: trimmedDecimal(grams, 1), tag: "UNIT_CONVERSION_ERROR" },
        { value: String(grams * 1000), tag: "UNIT_CONVERSION_ERROR" },
        { value: String(grams), tag: "UNIT_CONVERSION_ERROR" },
      ],
      explanation: `1 000 g = 1 kg, so ${fmtInt(grams)} g = ${fmtInt(grams)} ÷ 1 000 = ${fmtDecimal(kgText)} kg.`,
      hints: [
        "There are 1 000 grams in 1 kilogram.",
        "Changing to the bigger unit gives a smaller number: divide by 1 000.",
      ],
    });
  },
});

interface Pick4 {
  stem: string;
  correct: string;
  wrongs: string[];
  explanation: string;
  hints: string[];
}

const MASS_UNIT_ITEMS: Pick4[] = [
  {
    stem: "Which unit is best for measuring the mass of a pencil?",
    correct: "grams",
    wrongs: ["kilograms", "tonnes", "litres"],
    explanation: "A pencil is very light, so we measure its mass in grams.",
    hints: ["Is a pencil heavy or light? Choose the small unit for light things."],
  },
  {
    stem: "Which unit is best for measuring the mass of a bag of maize meal?",
    correct: "kilograms",
    wrongs: ["grams", "millilitres", "centimetres"],
    explanation: "A bag of maize meal is heavy, so we measure it in kilograms.",
    hints: ["Mass is measured in grams or kilograms. Is a bag of maize meal heavy or light?"],
  },
  {
    stem: "Which unit is best for measuring the mass of a goat?",
    correct: "kilograms",
    wrongs: ["grams", "metres", "millilitres"],
    explanation: "A goat has a mass of many kilograms.",
    hints: ["Which unit of mass is big enough for an animal?"],
  },
  {
    stem: "Which unit is best for measuring the mass of a mango?",
    correct: "grams",
    wrongs: ["kilograms", "tonnes", "metres"],
    explanation: "A mango is small and light, so we measure its mass in grams.",
    hints: ["Is a mango heavy or light?"],
  },
  {
    stem: "Which of these is a unit for measuring mass?",
    correct: "kilogram",
    wrongs: ["litre", "metre", "second"],
    explanation:
      "The kilogram measures mass. The litre measures capacity, the metre measures length and the second measures time.",
    hints: ["Each unit measures a different thing: mass, capacity, length or time."],
  },
];

const MASS_ESTIMATE_ITEMS: Pick4[] = [
  {
    stem: "About what is the mass of a bag of sugar from the shop?",
    correct: "2 kg",
    wrongs: ["2 g", "200 kg", "2 000 kg"],
    explanation: "A bag of sugar has a mass of about 2 kg.",
    hints: [
      "Think of carrying a bag of sugar: is it as light as a pencil or as heavy as a person?",
    ],
  },
  {
    stem: "About what is the mass of a Grade 6 learner?",
    correct: "40 kg",
    wrongs: ["4 kg", "400 kg", "4 000 kg"],
    explanation: "A child of about 12 years has a mass of about 40 kg.",
    hints: ["Think of how heavy a child is compared with a bag of cement (50 kg)."],
  },
  {
    stem: "About what is the mass of an adult cow?",
    correct: "400 kg",
    wrongs: ["4 kg", "40 g", "40 000 kg"],
    explanation: "An adult cow has a mass of several hundred kilograms.",
    hints: ["A cow is much heavier than a person."],
  },
  {
    stem: "About what is the mass of an egg?",
    correct: "60 g",
    wrongs: ["6 kg", "600 g", "6 g"],
    explanation: "A hen's egg has a mass of about 60 g.",
    hints: ["An egg is light enough to hold in one hand."],
  },
  {
    stem: "About what is the mass of a loaf of bread?",
    correct: "700 g",
    wrongs: ["7 g", "7 kg", "70 kg"],
    explanation: "A loaf of bread has a mass of about 700 g.",
    hints: ["It is lighter than a bag of sugar but heavier than an egg."],
  },
  {
    stem: "About what is the mass of a full 20 litre bucket of water?",
    correct: "20 kg",
    wrongs: ["2 kg", "200 kg", "2 000 g"],
    explanation:
      "1 litre of water has a mass of about 1 kg, so 20 litres has a mass of about 20 kg.",
    hints: ["A litre of water has a mass of about 1 kilogram."],
  },
];

export const massUnitsAndEstimates = defineTemplate({
  id: "mea.mass-units",
  description: "Choose the right unit of mass and estimate the mass of everyday things.",
  covers: (o) =>
    scoped(o, {
      topic: MEA,
      strand: /^mass$/,
      text: /identify standard units|approximate mass/i,
    }),
  generate: ({ objective: o, rng, q }) => {
    const items = /approximate/i.test(o.text) ? MASS_ESTIMATE_ITEMS : MASS_UNIT_ITEMS;
    const item = rng.pick(items);
    return q.mcq({
      skill: /approximate/i.test(o.text) ? "APPLICATION" : "KNOWLEDGE_COMPREHENSION",
      stem: item.stem,
      correct: item.correct,
      wrongs: item.wrongs.map((answer) => ({ answer })),
      explanation: item.explanation,
      hints:
        item.hints.length >= 2
          ? item.hints
          : [...item.hints, "Cross out the choices that are far too big or far too small."],
    });
  },
});

export const massComparison = defineTemplate({
  id: "mea.mass-compare",
  description: "Compare masses given in different units.",
  covers: (o) =>
    scoped(o, { topic: MEA, strand: /^mass$/, text: /compare mass/i, not: /using weights/i }),
  generate: ({ difficulty: d, rng, q }) => {
    const heavy = rng.chance(0.5);
    const base = rng.int(2, byLevel(d, [5, 9, 20, 40, 90]));
    const values: Array<{ kg: number; text: string }> = [];
    const used = new Set<number>();
    const make = () => {
      const kg = base + rng.int(-1, 3) * (d >= 4 ? 0.1 : 0.5);
      return Math.round(kg * 10) / 10;
    };
    for (let tries = 0; tries < 60 && values.length < 4; tries++) {
      const kg = make();
      if (kg <= 0 || used.has(kg)) continue;
      used.add(kg);
      values.push({
        kg,
        text:
          values.length % 2 === 0 || d <= 1
            ? `${fmtDecimal(trimmedDecimal(Math.round(kg * 100), 2))} kg`
            : `${fmtInt(Math.round(kg * 1000))} g`,
      });
    }
    if (values.length < 4) throw new Error("massComparison: not enough values");
    const sorted = [...values].sort((a, b) => a.kg - b.kg);
    const answer = heavy ? sorted[3]! : sorted[0]!;
    return q.mcq({
      skill: "ANALYSIS",
      stem: `Which is the ${heavy ? "heaviest" : "lightest"} mass?`,
      correct: answer.text,
      wrongs: values.filter((v) => v !== answer).map((v) => ({ answer: v.text })),
      explanation: `Change every mass to kilograms: ${sorted.map((v) => `${v.text} = ${trimmedDecimal(Math.round(v.kg * 1000), 3)} kg`).join("; ")}. The ${heavy ? "heaviest" : "lightest"} is ${answer.text}.`,
      hints: [
        "The masses are in different units, so you cannot compare the numbers yet.",
        "Change them all to the same unit: 1 kg = 1 000 g.",
        "Now compare the numbers.",
      ],
    });
  },
});

export const massOperations = defineTemplate({
  id: "mea.mass-operations",
  description: "Add, subtract, multiply and divide masses.",
  covers: (o) => scoped(o, { topic: MEA, strand: /^mass$/, text: /operations involving mass/i }),
  generate: ({ difficulty: d, rng, q, local }) => {
    const name = rng.pick(NAMES);
    const kind = rng.pick(
      d <= 2 ? (["add", "times"] as const) : (["add", "times", "left", "share"] as const),
    );
    const item = local
      ? rng.pick(["maize meal", "rice", "sugar"])
      : rng.pick(["flour", "rice", "sugar"]);
    const a = rng.int(2, byLevel(d, [6, 9, 12, 20, 30]));
    const b = rng.int(1, byLevel(d, [5, 8, 10, 15, 25]));
    const half = d >= 3 && rng.chance(0.5) ? 0.5 : 0;
    if (kind === "add") {
      const total = a + b + half;
      return amount(q, {
        skill: "APPLICATION",
        type: "WORD_PROBLEM",
        stem: `${name} buys a bag of ${item} with a mass of ${a} kg and another bag with a mass of ${dec(b + half, 1)} kg. What is the total mass of ${item} in kilograms?`,
        value: dec(total, 1),
        unit: "kg",
        local,
        wrongs: [
          { value: dec(a - b - half, 1), tag: "OPERATION_CHOICE_ERROR" },
          { value: dec(total + 1, 1), tag: "BASIC_FACT_ERROR" },
          { value: dec(total * 10, 1), tag: "UNIT_CONVERSION_ERROR" },
        ],
        explanation: `${a} kg + ${dec(b + half, 1)} kg = ${dec(total, 1)} kg.`,
        hints: [
          "Joining two masses means adding them.",
          "Line up the kilograms, and the half kilogram if there is one.",
        ],
      });
    }
    if (kind === "times") {
      const n = rng.int(2, byLevel(d, [4, 6, 8, 9, 12]));
      return amount(q, {
        skill: "APPLICATION",
        type: "WORD_PROBLEM",
        stem: `Each bag of ${item} has a mass of ${a} kg. What is the mass of ${n} bags?`,
        value: String(a * n),
        unit: "kg",
        local,
        wrongs: [
          { value: String(a + n), tag: "OPERATION_CHOICE_ERROR" },
          { value: String(a * n + a), tag: "BASIC_FACT_ERROR" },
          { value: String(a * n * 10), tag: "UNIT_CONVERSION_ERROR" },
        ],
        explanation: `${n} bags of ${a} kg: ${n} × ${a} = ${a * n} kg.`,
        hints: ["The same mass is repeated for each bag, so multiply.", `Work out ${n} × ${a}.`],
      });
    }
    if (kind === "left") {
      const start = a + b + half + 2;
      const used = b + half;
      return amount(q, {
        skill: "APPLICATION",
        type: "WORD_PROBLEM",
        stem: `A sack holds ${dec(start, 1)} kg of ${item}. ${name} uses ${dec(used, 1)} kg. What is the mass of ${item} left in the sack?`,
        value: dec(start - used, 1),
        unit: "kg",
        local,
        wrongs: [
          { value: dec(start + used, 1), tag: "OPERATION_CHOICE_ERROR" },
          { value: dec(start - used + 1, 1), tag: "BORROWING_ERROR" },
          { value: dec(start - used - 1, 1), tag: "BASIC_FACT_ERROR" },
        ],
        explanation: `${dec(start, 1)} kg − ${dec(used, 1)} kg = ${dec(start - used, 1)} kg.`,
        hints: [
          "What is left after some is used? Take it away.",
          "Subtract the mass used from the mass in the sack.",
        ],
      });
    }
    const n = rng.pick([2, 4, 5]);
    const each = rng.int(1, 6);
    return amount(q, {
      skill: "APPLICATION",
      type: "WORD_PROBLEM",
      stem: `${n * each} kg of ${item} is shared equally among ${n} families. How many kilograms does each family get?`,
      value: String(each),
      unit: "kg",
      local,
      wrongs: [
        { value: String(n * each - n), tag: "OPERATION_CHOICE_ERROR" },
        { value: String(each + 1), tag: "BASIC_FACT_ERROR" },
        { value: String(n * each * n), tag: "OPERATION_CHOICE_ERROR" },
      ],
      explanation: `${n * each} ÷ ${n} = ${each} kg for each family.`,
      hints: [
        "Sharing equally means dividing.",
        `Think: ${n} times what number makes ${n * each}?`,
      ],
    });
  },
});

export const grossNetTare = defineTemplate({
  id: "mea.gross-net-tare",
  description: "Gross mass, net mass and tare mass.",
  covers: (o) =>
    scoped(o, { topic: MEA, strand: /^mass$/, text: /gross, net and tare|gross, net/i }),
  generate: ({ difficulty: d, rng, q, local }) => {
    const net = rng.int(byLevel(d, [10, 20, 40, 60, 120]), byLevel(d, [40, 90, 200, 400, 800]));
    const tare = rng.int(1, byLevel(d, [3, 5, 12, 25, 60]));
    const gross = net + tare;
    const container = local
      ? rng.pick(["sack of maize", "bag of cement", "bag of fertiliser", "box of tomatoes"])
      : rng.pick(["crate of bottles", "box of books", "sack of potatoes"]);
    const ask = rng.pick(["net", "gross", "tare"] as const);
    const explanations = {
      net: `Net mass = gross mass − tare mass = ${gross} kg − ${tare} kg = ${net} kg.`,
      gross: `Gross mass = net mass + tare mass = ${net} kg + ${tare} kg = ${gross} kg.`,
      tare: `Tare mass = gross mass − net mass = ${gross} kg − ${net} kg = ${tare} kg.`,
    };
    const stems = {
      net: `A ${container} has a gross mass of ${gross} kg. The empty container (the tare) has a mass of ${tare} kg. What is the net mass of the contents?`,
      gross: `The contents of a ${container} have a net mass of ${net} kg. The empty container (the tare) has a mass of ${tare} kg. What is the gross mass?`,
      tare: `A ${container} has a gross mass of ${gross} kg. The contents have a net mass of ${net} kg. What is the tare mass of the empty container?`,
    };
    const answer = { net, gross, tare }[ask];
    const hintsBy = {
      net: [
        "Gross mass is the mass of the contents AND the container together.",
        "The contents alone are the net mass: take the container's mass (tare) away from the gross mass.",
      ],
      gross: [
        "Gross mass is the mass of the contents AND the container together.",
        "Add the net mass (contents) and the tare mass (container).",
      ],
      tare: [
        "Gross mass = net mass + tare mass.",
        "The tare is the part of the gross mass that is not the contents: subtract the net mass from the gross mass.",
      ],
    };
    return amount(q, {
      skill: "PROBLEM_SOLVING",
      type: "WORD_PROBLEM",
      stem: stems[ask],
      value: String(answer),
      unit: "kg",
      local,
      wrongs: [
        {
          value: String(ask === "gross" ? net - tare : gross + tare),
          tag: "OPERATION_CHOICE_ERROR",
        },
        { value: String(answer + 1), tag: "BASIC_FACT_ERROR" },
        { value: String(answer * 10), tag: "PLACE_VALUE_CONFUSION" },
        {
          value: String(ask === "tare" ? net : ask === "net" ? tare : gross),
          tag: "OPERATION_CHOICE_ERROR",
        },
      ],
      explanation: explanations[ask],
      hints: [...hintsBy[ask], "Check: net mass + tare mass should equal gross mass."],
    });
  },
});

export const massRounding = defineTemplate({
  id: "mea.mass-round",
  description: "Round a mass to the nearest 1 000 kg.",
  covers: (o) => scoped(o, { topic: MEA, strand: /^mass$/, text: /nearest 1 ?000 ?kg/i }),
  generate: ({ difficulty: d, rng, q, local }) => {
    const kg = rng.int(1200, byLevel(d, [4800, 6800, 8800, 9700, 9990]));
    const rounded = Math.round(kg / 1000) * 1000;
    const down = Math.floor(kg / 1000) * 1000;
    const up = down + 1000;
    const thing = local
      ? rng.pick(["maize", "cement", "sugar cane", "tobacco"])
      : rng.pick(["gravel", "flour", "coal"]);
    return amount(q, {
      skill: "APPLICATION",
      type: "WORD_PROBLEM",
      stem: `A lorry carries ${fmtInt(kg)} kg of ${thing}. What is this mass to the nearest 1 000 kg?`,
      value: String(rounded),
      unit: "kg",
      show: `${fmtInt(rounded)} kg`,
      local,
      wrongs: [
        { value: String(rounded === down ? up : down), tag: "ROUNDING_DIRECTION_ERROR" },
        { value: String(Math.round(kg / 100) * 100), tag: "PLACE_VALUE_CONFUSION" },
        { value: String(Math.round(kg / 10) * 10), tag: "PLACE_VALUE_CONFUSION" },
      ],
      explanation: `${fmtInt(kg)} kg is between ${fmtInt(down)} kg and ${fmtInt(up)} kg. The hundreds digit is ${Math.floor((kg % 1000) / 100)}, which is ${kg % 1000 >= 500 ? "5 or more, so round UP" : "less than 5, so round DOWN"}: ${fmtInt(rounded)} kg.`,
      hints: [
        "Find the two thousands that the mass lies between.",
        "Look at the hundreds digit. If it is 5 or more, round up. If it is less than 5, round down.",
      ],
    });
  },
});

// ── length ──────────────────────────────────────────────────────────────────────────────────────

export const rulerReading = defineTemplate({
  id: "mea.ruler-read",
  description: "Measure the length of a line against a ruler.",
  covers: (o) =>
    scoped(o, {
      topic: MEA,
      strand: /^length$/,
      text: /^measure length|^measure the length/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const rulerLength = o.grade === 3 ? 15 : 30;
    const nearestCm = /nearest cent/i.test(o.text);
    const offset = d <= 1 ? 0 : rng.int(1, 5);
    const precise = o.grade >= 5 && d >= 4;
    const lengthCm = rng.int(
      2,
      Math.min(rulerLength - offset - 1, byLevel(d, [8, 10, 14, 20, 24])),
    );
    const tenths = precise || nearestCm ? rng.int(1, 9) / 10 : 0;
    const end = offset + lengthCm + tenths;
    const exact = Math.round((lengthCm + tenths) * 10) / 10;
    const answerValue = nearestCm ? Math.round(exact) : exact;
    const picture: StemData = {
      kind: "ruler",
      unit: "cm",
      length: rulerLength,
      start: offset,
      end,
    };
    const stem = nearestCm
      ? "The line is shown against a ruler marked in centimetres. What is the length of the line to the nearest centimetre?"
      : precise
        ? "The line is shown against a ruler marked in centimetres and millimetres. What is the length of the line in centimetres?"
        : "The line is shown against a ruler marked in centimetres. What is the length of the line?";
    return amount(q, {
      skill: "KNOWLEDGE_COMPREHENSION",
      type: "VISUAL_DIAGRAM",
      stem,
      stemData: picture,
      value: trimmedDecimal(Math.round(answerValue * 10), 1),
      unit: "cm",
      wrongs: [
        ...(offset > 0
          ? [
              {
                value: trimmedDecimal(Math.round(Math.round(end) * 10), 1),
                tag: "RULER_START_ERROR",
              },
            ]
          : []),
        {
          value: trimmedDecimal(Math.round((answerValue + 1) * 10), 1),
          tag: "GRAPH_READING_ERROR",
        },
        {
          value: trimmedDecimal(Math.round((answerValue - 1) * 10), 1),
          tag: "GRAPH_READING_ERROR",
        },
        ...(precise
          ? [{ value: trimmedDecimal(Math.round(exact * 100), 1), tag: "UNIT_CONVERSION_ERROR" }]
          : []),
      ],
      explanation:
        offset > 0
          ? `The line starts at ${offset} cm and ends at ${trimmedDecimal(Math.round(end * 10), 1)} cm. Its length is ${trimmedDecimal(Math.round(end * 10), 1)} − ${offset} = ${trimmedDecimal(Math.round(exact * 10), 1)} cm${nearestCm ? `, which is ${answerValue} cm to the nearest centimetre` : ""}.`
          : `The line starts at 0 and ends at ${trimmedDecimal(Math.round(end * 10), 1)} cm, so its length is ${trimmedDecimal(Math.round(exact * 10), 1)} cm${nearestCm ? `, which is ${answerValue} cm to the nearest centimetre` : ""}.`,
      hints: [
        "Look at where the line STARTS on the ruler. Is it at 0?",
        offset > 0
          ? "The line does not start at 0, so read both ends and subtract: end mark − start mark."
          : "The line starts at 0, so the mark at the end of the line is its length.",
        precise || nearestCm
          ? "Use the small marks: each one is 1 millimetre (0.1 cm)."
          : "Read the nearest whole centimetre mark carefully.",
      ],
    });
  },
});

interface LengthPair {
  from: string;
  to: string;
  factor: number;
  grades: readonly number[];
}

const LENGTH_CONVERSIONS: LengthPair[] = [
  { from: "mm", to: "cm", factor: 10, grades: [4, 5] },
  { from: "cm", to: "m", factor: 100, grades: [4, 5] },
  { from: "m", to: "cm", factor: 100, grades: [4, 5] },
  { from: "cm", to: "mm", factor: 10, grades: [4, 5] },
  { from: "m", to: "km", factor: 1000, grades: [7] },
  { from: "km", to: "m", factor: 1000, grades: [7] },
];

export const lengthConversion = defineTemplate({
  id: "mea.length-convert",
  description: "Change between millimetres, centimetres, metres and kilometres.",
  covers: (o) =>
    scoped(o, {
      topic: MEA,
      strand: /^length$/,
      text: /convert units of length|metres and kilometres/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const pairs = LENGTH_CONVERSIONS.filter((p) => p.grades.includes(o.grade));
    const pair = rng.pick(pairs);
    // going to a BIGGER unit divides (250 cm → 2.5 m); going to a smaller unit multiplies
    const bigger = ["mm→cm", "cm→m", "m→km"].includes(`${pair.from}→${pair.to}`);
    const small = rng.int(2, byLevel(d, [9, 30, 60, 90, 99]));
    const half = d >= 3 && rng.chance(0.5) ? 0.5 : 0;
    const bigValue = small + half; // in the bigger unit
    const bigText = trimmedDecimal(Math.round(bigValue * 10), 1);
    const smallValue = Math.round(bigValue * pair.factor);
    const fromText = bigger ? fmtInt(smallValue) : bigText;
    const answerValue = bigger ? bigText : String(smallValue);
    const answerUnit = pair.to;
    const wrongs: Array<{ value: string; tag: string }> = bigger
      ? [
          { value: String(smallValue / (pair.factor / 10)), tag: "UNIT_CONVERSION_ERROR" },
          { value: String(smallValue / (pair.factor * 10)), tag: "UNIT_CONVERSION_ERROR" },
          { value: String(smallValue), tag: "UNIT_CONVERSION_ERROR" },
          { value: String(smallValue * pair.factor), tag: "UNIT_CONVERSION_ERROR" },
        ]
      : [
          { value: String(smallValue / 10), tag: "UNIT_CONVERSION_ERROR" },
          { value: String(smallValue * 10), tag: "UNIT_CONVERSION_ERROR" },
          { value: bigText, tag: "UNIT_CONVERSION_ERROR" },
          {
            value: String(Math.round((bigValue / pair.factor) * 100000) / 100000),
            tag: "UNIT_CONVERSION_ERROR",
          },
        ];
    return amount(q, {
      skill: "APPLICATION",
      type: "FILL_IN_THE_BLANK",
      stem: `${fmtDecimal(fromText)} ${pair.from} = ___ ${pair.to}`,
      value: answerValue,
      unit: answerUnit,
      show: `${fmtDecimal(answerValue)} ${answerUnit}`,
      strict: true,
      solutionKind: "unit-conversion",
      wrongs,
      explanation: bigger
        ? `${fmtInt(pair.factor)} ${pair.from} = 1 ${pair.to}, so ${fmtDecimal(fromText)} ${pair.from} ÷ ${fmtInt(pair.factor)} = ${fmtDecimal(answerValue)} ${pair.to}.`
        : `1 ${pair.from} = ${fmtInt(pair.factor)} ${pair.to}, so ${fmtDecimal(fromText)} ${pair.from} × ${fmtInt(pair.factor)} = ${fmtDecimal(answerValue)} ${pair.to}.`,
      hints: [
        "Remember: 1 cm = 10 mm, 1 m = 100 cm and 1 km = 1 000 m.",
        bigger
          ? "You are changing to a bigger unit, so the number gets smaller: divide."
          : "You are changing to a smaller unit, so the number gets bigger: multiply.",
      ],
    });
  },
});

const LENGTH_UNIT_ITEMS: Pick4[] = [
  {
    stem: "Which unit is best for measuring the length of a pencil?",
    correct: "centimetres",
    wrongs: ["kilometres", "metres", "grams"],
    explanation: "A pencil is short, so we measure its length in centimetres.",
    hints: ["Is a pencil very long or quite short?"],
  },
  {
    stem: "Which unit is best for measuring the length of a classroom?",
    correct: "metres",
    wrongs: ["millimetres", "kilometres", "litres"],
    explanation: "A classroom is a few metres long.",
    hints: ["Which unit is about the size of a big step?"],
  },
  {
    stem: "Which unit is best for measuring the distance from Harare to Mutare?",
    correct: "kilometres",
    wrongs: ["centimetres", "metres", "millimetres"],
    explanation: "Long distances between towns are measured in kilometres.",
    hints: ["Think about road signs: which unit do they use?"],
  },
  {
    stem: "Which unit is best for measuring the thickness of a coin?",
    correct: "millimetres",
    wrongs: ["metres", "kilometres", "kilograms"],
    explanation: "A coin is very thin, so its thickness is measured in millimetres.",
    hints: ["Is a coin thick or thin?"],
  },
  {
    stem: "Which of these is a unit for measuring length?",
    correct: "metre",
    wrongs: ["litre", "gram", "minute"],
    explanation:
      "The metre measures length. The litre measures capacity, the gram measures mass and the minute measures time.",
    hints: ["Each unit measures a different thing: length, capacity, mass or time."],
  },
];

export const lengthUnits = defineTemplate({
  id: "mea.length-units",
  description: "Choose the right unit of length.",
  covers: (o) => scoped(o, { topic: MEA, strand: /^length$/, text: /identify standard units/i }),
  generate: ({ rng, q }) => {
    const item = rng.pick(LENGTH_UNIT_ITEMS);
    return q.mcq({
      skill: "KNOWLEDGE_COMPREHENSION",
      stem: item.stem,
      correct: item.correct,
      wrongs: item.wrongs.map((answer) => ({ answer })),
      explanation: item.explanation,
      hints:
        item.hints.length >= 2
          ? item.hints
          : [...item.hints, "Cross out the units that are far too big or far too small."],
    });
  },
});

export const lengthNonStandard = defineTemplate({
  id: "mea.length-nonstandard",
  description: "Estimate lengths using hand spans, paces and other non-standard units.",
  covers: (o) =>
    scoped(o, { topic: MEA, strand: /^length$/, text: /non-standard units|spans and paces/i }),
  generate: ({ difficulty: d, rng, q, local }) => {
    const unit = rng.pick([
      { name: "hand span", cm: 18, plural: "hand spans" },
      { name: "foot length", cm: 25, plural: "foot lengths" },
      { name: "pace", cm: 75, plural: "paces" },
    ]);
    const thing =
      unit.name === "pace"
        ? local
          ? "the school yard"
          : "a hall"
        : local
          ? "a desk in a classroom"
          : "a table";
    const count = rng.int(3, byLevel(d, [8, 12, 16, 24, 40]));
    const cm = count * unit.cm;
    const inMetres = unit.name === "pace" || cm >= 200;
    const answer = inMetres ? trimmedDecimal(cm, 2) : String(cm);
    return amount(q, {
      skill: "APPLICATION",
      type: "WORD_PROBLEM",
      stem: `${thing.charAt(0).toUpperCase() + thing.slice(1)} is ${count} ${unit.plural} long. One ${unit.name} is about ${unit.cm} cm. Estimate its length in ${inMetres ? "metres" : "centimetres"}.`,
      value: answer,
      unit: inMetres ? "m" : "cm",
      show: `${fmtDecimal(answer)} ${inMetres ? "m" : "cm"}`,
      wrongs: [
        { value: String(count + unit.cm), tag: "OPERATION_CHOICE_ERROR" },
        { value: inMetres ? String(cm) : trimmedDecimal(cm, 2), tag: "UNIT_CONVERSION_ERROR" },
        { value: inMetres ? trimmedDecimal(cm, 1) : String(cm * 10), tag: "UNIT_CONVERSION_ERROR" },
      ],
      local,
      solutionKind: "unit-conversion",
      explanation: `${count} × ${unit.cm} cm = ${fmtInt(cm)} cm${inMetres ? ` = ${fmtDecimal(trimmedDecimal(cm, 2))} m` : ""}.`,
      hints: [
        `Each ${unit.name} is ${unit.cm} cm. The length is ${count} of them.`,
        "Multiply the number of units by the length of one unit.",
        inMetres
          ? "Change centimetres to metres: divide by 100."
          : "Write the answer in centimetres.",
      ],
    });
  },
});

export const lengthOperations = defineTemplate({
  id: "mea.length-operations",
  description: "Add, subtract, multiply and divide lengths.",
  covers: (o) =>
    scoped(o, { topic: MEA, strand: /^length$/, text: /operations involving length/i }),
  generate: ({ objective: o, difficulty: d, rng, q, local }) => {
    const name = rng.pick(NAMES);
    const maxM = o.grade <= 5 ? 100 : 1000;
    const kind = rng.pick(
      d <= 2 ? (["add", "times"] as const) : (["add", "times", "left", "pieces"] as const),
    );
    const a = rng.int(3, Math.min(maxM / 4, byLevel(d, [20, 40, 60, 120, 400])));
    const b = rng.int(2, Math.min(maxM / 4, byLevel(d, [15, 30, 50, 90, 300])));
    const thing = local
      ? rng.pick(["fence", "piece of cloth", "rope", "garden path"])
      : rng.pick(["fence", "ribbon", "rope", "cable"]);
    if (kind === "add") {
      return amount(q, {
        skill: "APPLICATION",
        type: "WORD_PROBLEM",
        stem: `${name} has a ${thing} ${a} m long and another ${thing} ${b} m long. What is their total length in metres?`,
        value: String(a + b),
        unit: "m",
        local,
        wrongs: [
          { value: String(Math.abs(a - b)), tag: "OPERATION_CHOICE_ERROR" },
          { value: String(a + b + 10), tag: "CARRYING_ERROR" },
          { value: String((a + b) * 100), tag: "UNIT_CONVERSION_ERROR" },
        ],
        explanation: `${a} m + ${b} m = ${a + b} m.`,
        hints: [
          "Joining two lengths means adding them.",
          "Both lengths are in metres, so just add the numbers.",
        ],
      });
    }
    if (kind === "times") {
      const n = rng.int(2, byLevel(d, [4, 6, 8, 9, 12]));
      return amount(q, {
        skill: "APPLICATION",
        type: "WORD_PROBLEM",
        stem: `A ${thing} is ${a} m long. ${name} needs ${n} of them laid end to end. What is the total length in metres?`,
        value: String(a * n),
        unit: "m",
        local,
        wrongs: [
          { value: String(a + n), tag: "OPERATION_CHOICE_ERROR" },
          { value: String(a * n + a), tag: "BASIC_FACT_ERROR" },
          { value: String(a * n * 10), tag: "UNIT_CONVERSION_ERROR" },
        ],
        explanation: `${n} × ${a} m = ${a * n} m.`,
        hints: ["The same length is used again and again, so multiply.", `Work out ${n} × ${a}.`],
      });
    }
    if (kind === "left") {
      const whole = a + b;
      return amount(q, {
        skill: "APPLICATION",
        type: "WORD_PROBLEM",
        stem: `A ${thing} is ${whole} m long. ${name} cuts off ${b} m. What length is left, in metres?`,
        value: String(a),
        unit: "m",
        local,
        wrongs: [
          { value: String(whole + b), tag: "OPERATION_CHOICE_ERROR" },
          { value: String(a + 1), tag: "BORROWING_ERROR" },
          { value: String(a - 1), tag: "BASIC_FACT_ERROR" },
        ],
        explanation: `${whole} m − ${b} m = ${a} m.`,
        hints: [
          "Cutting off a piece takes some length away: subtract.",
          "Subtract the length cut off from the whole length.",
        ],
      });
    }
    const pieceLen = rng.int(2, byLevel(d, [5, 8, 10, 12, 15]));
    const n = rng.int(3, byLevel(d, [6, 8, 10, 12, 15]));
    return q.numeric({
      skill: "APPLICATION",
      type: "WORD_PROBLEM",
      stem: `A ${thing} ${fmtInt(pieceLen * n)} m long is cut into equal pieces, each ${pieceLen} m long. How many pieces are there?`,
      answer: String(n),
      wrongs: [
        { answer: String(pieceLen * n - pieceLen), tag: "OPERATION_CHOICE_ERROR" },
        { answer: String(n + 1), tag: "BASIC_FACT_ERROR" },
        { answer: String(n - 1), tag: "BASIC_FACT_ERROR" },
      ],
      usesLocalContext: local,
      explanation: `${pieceLen * n} ÷ ${pieceLen} = ${n} pieces.`,
      hints: [
        "How many times does the length of one piece fit into the whole length?",
        "That is a division.",
      ],
    });
  },
});

// ── capacity and volume ─────────────────────────────────────────────────────────────────────────

export const capacityContainers = defineTemplate({
  id: "mea.capacity-containers",
  description: "Measure liquids using half-litre, quarter-litre and one-litre containers.",
  covers: (o) =>
    scoped(o, {
      topic: MEA,
      strand: /^volume-and-capacity$/,
      text: /half litre|1 litre containers/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q, local }) => {
    const useQuarter = o.grade >= 4 && rng.chance(0.5);
    const container = useQuarter
      ? { name: "quarter-litre cup", ml: 250, perLitre: 4 }
      : { name: "half-litre cup", ml: 500, perLitre: 2 };
    const litres = rng.int(1, byLevel(d, [3, 4, 6, 8, 10]));
    const cups = litres * container.perLitre;
    const name = rng.pick(NAMES);
    const liquid = local
      ? rng.pick(["water", "milk", "cooking oil"])
      : rng.pick(["water", "juice"]);
    if (rng.chance(0.5)) {
      return amount(q, {
        skill: "APPLICATION",
        type: "WORD_PROBLEM",
        stem: `${name} fills a jug using a ${container.name}. It takes ${cups} cupfuls to fill the jug with ${liquid}. How many litres does the jug hold?`,
        value: String(litres),
        unit: "l",
        local,
        wrongs: [
          { value: String(cups), tag: "UNIT_CONVERSION_ERROR" },
          { value: String(cups / 2), tag: "UNIT_CONVERSION_ERROR" },
          { value: String(litres + 1), tag: "BASIC_FACT_ERROR" },
        ],
        explanation: `${container.perLitre} ${container.name}s make 1 litre. ${cups} ÷ ${container.perLitre} = ${litres} litres.`,
        hints: [
          `How many ${container.name}s make 1 litre?`,
          "Share the cupfuls into groups of that size. Each group is one litre.",
        ],
      });
    }
    return q.numeric({
      skill: "APPLICATION",
      type: "WORD_PROBLEM",
      stem: `A bucket holds ${litres} litres of ${liquid}. How many ${container.name}s of ${liquid} can ${name} fill from the bucket?`,
      answer: String(cups),
      usesLocalContext: local,
      wrongs: [
        { answer: String(litres), tag: "UNIT_CONVERSION_ERROR" },
        { answer: String(cups * 2), tag: "UNIT_CONVERSION_ERROR" },
        { answer: String(cups + 1), tag: "BASIC_FACT_ERROR" },
      ],
      explanation: `1 litre fills ${container.perLitre} ${container.name}s. ${litres} × ${container.perLitre} = ${cups}.`,
      hints: [
        `How many ${container.name}s make 1 litre?`,
        `You need that many for each litre in the bucket: multiply by ${litres}.`,
      ],
    });
  },
});

export const capacityConversion = defineTemplate({
  id: "mea.capacity-convert",
  description: "Change between millilitres and litres.",
  covers: (o) =>
    scoped(o, {
      topic: MEA,
      strand: /^volume-and-capacity$/,
      text: /millilitres to litres|use units of capacity/i,
    }),
  generate: ({ difficulty: d, rng, q }) => {
    const litres = rng.int(1, byLevel(d, [5, 9, 20, 50, 99]));
    const tenths = d >= 2 ? rng.pick([0, 0.25, 0.5, 0.75, 0.1, 0.2, 0.4]) : 0;
    const l = litres + tenths;
    const lText = trimmedDecimal(Math.round(l * 100), 2);
    const ml = Math.round(l * 1000);
    if (rng.chance(0.5)) {
      return amount(q, {
        skill: "APPLICATION",
        type: "FILL_IN_THE_BLANK",
        stem: `${fmtDecimal(lText)} l = ___ ml`,
        value: String(ml),
        unit: "ml",
        show: `${fmtInt(ml)} ml`,
        strict: true,
        solutionKind: "unit-conversion",
        wrongs: [
          { value: String(ml / 10), tag: "UNIT_CONVERSION_ERROR" },
          { value: String(ml / 100), tag: "UNIT_CONVERSION_ERROR" },
          { value: String(ml * 10), tag: "UNIT_CONVERSION_ERROR" },
          { value: lText, tag: "UNIT_CONVERSION_ERROR" },
        ],
        explanation: `1 litre = 1 000 ml, so ${fmtDecimal(lText)} l × 1 000 = ${fmtInt(ml)} ml.`,
        hints: [
          "There are 1 000 millilitres in 1 litre.",
          "Changing to the smaller unit gives a bigger number: multiply by 1 000.",
        ],
      });
    }
    return amount(q, {
      skill: "APPLICATION",
      type: "FILL_IN_THE_BLANK",
      stem: `${fmtInt(ml)} ml = ___ l`,
      value: lText,
      unit: "l",
      show: `${fmtDecimal(lText)} l`,
      strict: true,
      solutionKind: "unit-conversion",
      wrongs: [
        { value: trimmedDecimal(ml, 2), tag: "UNIT_CONVERSION_ERROR" },
        { value: trimmedDecimal(ml, 1), tag: "UNIT_CONVERSION_ERROR" },
        { value: String(ml * 1000), tag: "UNIT_CONVERSION_ERROR" },
        { value: String(ml), tag: "UNIT_CONVERSION_ERROR" },
      ],
      explanation: `1 000 ml = 1 litre, so ${fmtInt(ml)} ml ÷ 1 000 = ${fmtDecimal(lText)} l.`,
      hints: [
        "There are 1 000 millilitres in 1 litre.",
        "Changing to the bigger unit gives a smaller number: divide by 1 000.",
      ],
    });
  },
});

export const jugReading = defineTemplate({
  id: "mea.jug-read",
  description: "Read the volume of liquid from a measuring jug.",
  covers: (o) =>
    scoped(o, {
      topic: MEA,
      strand: /^volume-and-capacity$/,
      text: /find capacity and volume of liquids|measure capacity and volume|measure volume of liquids/i,
      not: /containers/i,
    }),
  generate: ({ difficulty: d, rng, q }) => {
    const jug = rng.pick(
      d <= 2
        ? [
            { capacity: 1000, step: 100, label: 500 },
            { capacity: 1000, step: 250, label: 250 },
          ]
        : [
            { capacity: 1000, step: 50, label: 250 },
            { capacity: 2000, step: 100, label: 500 },
            { capacity: 500, step: 25, label: 100 },
          ],
    );
    let level = rng.int(1, jug.capacity / jug.step - 1) * jug.step;
    for (let tries = 0; tries < 20 && d >= 3 && level % jug.label === 0; tries++)
      level = rng.int(1, jug.capacity / jug.step - 1) * jug.step;
    const below = Math.floor(level / jug.label) * jug.label;
    return amount(q, {
      skill: "KNOWLEDGE_COMPREHENSION",
      type: "VISUAL_DIAGRAM",
      stem: "How much liquid is in the jug? Give your answer in millilitres.",
      stemData: {
        kind: "jug",
        capacity: jug.capacity,
        level,
        unit: "ml",
        step: jug.step,
        labelEvery: jug.label,
      },
      value: String(level),
      unit: "ml",
      show: `${fmtInt(level)} ml`,
      wrongs: [
        { value: String(below), tag: "GRAPH_READING_ERROR" },
        { value: String(level + jug.step), tag: "GRAPH_READING_ERROR" },
        { value: String(level - jug.step), tag: "GRAPH_READING_ERROR" },
        { value: String(level / 1000), tag: "UNIT_CONVERSION_ERROR" },
      ],
      explanation: `The liquid is ${(level - below) / jug.step} small marks above the mark ${below} ml. Each small mark is ${jug.step} ml, so the jug holds ${fmtInt(level)} ml.`,
      hints: [
        "Find the last numbered mark below the top of the liquid.",
        "Work out what each small mark is worth: find the gap between two numbered marks and count the small marks between them.",
        "Count the small marks above the numbered mark and add them on.",
      ],
    });
  },
});

export const volumeOfCuboid = defineTemplate({
  id: "mea.volume-cuboid",
  description: "Volume of cubes and cuboids.",
  covers: (o) =>
    scoped(o, {
      topic: MEA,
      strand: /^volume-and-capacity$/,
      text: /volume of cube|volume of regular|compute volume/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const cube = d <= 2 && rng.chance(0.5);
    const max = o.grade === 5 ? byLevel(d, [4, 6, 8, 10, 12]) : byLevel(d, [5, 8, 10, 15, 20]);
    const l = rng.int(2, max);
    const w = cube ? l : rng.int(2, max);
    const h = cube ? l : rng.int(2, max);
    const volume = l * w * h;
    const metres = o.grade === 7 && d >= 4 && rng.chance(0.5);
    if (metres) {
      const dims = [rng.pick([0.5, 1, 2]), rng.pick([0.5, 1]), rng.pick([0.2, 0.4, 0.5])];
      const vol = Math.round(dims[0]! * dims[1]! * dims[2]! * 1000) / 1000;
      return amount(q, {
        skill: "APPLICATION",
        type: "VISUAL_DIAGRAM",
        stem: "A tank is a cuboid. What is its volume in cubic metres?",
        stemData: {
          kind: "cuboid",
          length: dims[0]!,
          width: dims[1]!,
          height: dims[2]!,
          unit: "m",
        },
        value: trimmedDecimal(Math.round(vol * 1000), 3),
        unit: "m³",
        wrongs: [
          {
            value: trimmedDecimal(Math.round(dims[0]! * dims[1]! * 1000), 3),
            tag: "VOLUME_AREA_CONFUSION",
          },
          {
            value: trimmedDecimal(Math.round((dims[0]! + dims[1]! + dims[2]!) * 10), 1),
            tag: "VOLUME_AREA_CONFUSION",
          },
          { value: trimmedDecimal(Math.round(vol * 10000), 3), tag: "DECIMAL_PLACE_CONFUSION" },
        ],
        explanation: `Volume = length × width × height = ${dims[0]} × ${dims[1]} × ${dims[2]} = ${trimmedDecimal(Math.round(vol * 1000), 3)} m³.`,
        hints: [
          "Volume is length × width × height.",
          "Multiply the first two numbers, then multiply the answer by the third.",
        ],
      });
    }
    return amount(q, {
      skill: "APPLICATION",
      type: "VISUAL_DIAGRAM",
      stem: cube
        ? `The picture shows a cube with each edge ${l} cm long. What is its volume?`
        : "The picture shows a cuboid. What is its volume?",
      stemData: { kind: "cuboid", length: l, width: w, height: h, unit: "cm" },
      value: String(volume),
      unit: "cm³",
      show: `${fmtInt(volume)} cm³`,
      wrongs: [
        { value: String(l * w), tag: "VOLUME_AREA_CONFUSION" },
        { value: String(l + w + h), tag: "VOLUME_AREA_CONFUSION" },
        { value: String(2 * (l * w + w * h + l * h)), tag: "VOLUME_AREA_CONFUSION" },
        { value: String(volume + l), tag: "BASIC_FACT_ERROR" },
      ],
      explanation: `Volume = length × width × height = ${l} × ${w} × ${h} = ${fmtInt(volume)} cm³.`,
      hints: [
        "Volume tells how many 1 cm cubes fill the solid: layers of length × width, stacked as high as the height.",
        `First find one layer: ${l} × ${w}.`,
        "Then multiply by the number of layers (the height).",
      ],
    });
  },
});

export const volumeDisplacement = defineTemplate({
  id: "mea.volume-displacement",
  description: "Find the volume of an irregular object by displacement.",
  covers: (o) => scoped(o, { topic: MEA, strand: /^volume-and-capacity$/, text: /displacement/i }),
  generate: ({ difficulty: d, rng, q, local }) => {
    const before = rng.int(2, byLevel(d, [6, 10, 14, 18, 24])) * 50;
    const object = rng.int(1, byLevel(d, [4, 6, 9, 12, 16])) * 10 + (d >= 4 ? 5 : 0);
    const after = before + object;
    const thing = local
      ? rng.pick(["a stone", "a piece of iron ore", "a clay ball"])
      : rng.pick(["a stone", "a marble", "a metal key"]);
    return amount(q, {
      skill: "APPLICATION",
      type: "WORD_PROBLEM",
      stem: `A measuring jug has ${before} ml of water in it. ${thing.charAt(0).toUpperCase() + thing.slice(1)} is lowered into the water and the water level rises to ${after} ml. What is the volume of ${thing}?`,
      value: String(object),
      unit: "ml",
      show: `${object} ml`,
      local,
      wrongs: [
        { value: String(after + before), tag: "OPERATION_CHOICE_ERROR" },
        { value: String(after), tag: "OPERATION_CHOICE_ERROR" },
        { value: String(object + 10), tag: "BASIC_FACT_ERROR" },
      ],
      explanation: `The object pushes the water up by its own volume: ${after} ml − ${before} ml = ${object} ml.`,
      hints: [
        "When an object sinks, it pushes the water up. The rise in the water level is the volume of the object.",
        "Subtract the starting level from the final level.",
      ],
    });
  },
});

const VOLUME_UNIT_ITEMS: Pick4[] = [
  {
    stem: "Which unit is used to measure the capacity of a bottle of cooking oil?",
    correct: "litres",
    wrongs: ["centimetres", "kilograms", "square metres"],
    explanation: "Capacity (how much a container holds) is measured in litres and millilitres.",
    hints: ["Capacity is about liquids filling a container."],
  },
  {
    stem: "Which unit is used to measure the volume of a cuboid?",
    correct: "cubic centimetres (cm³)",
    wrongs: ["square centimetres (cm²)", "centimetres (cm)", "grams (g)"],
    explanation: "Volume is measured in cubic units such as cm³ and m³.",
    hints: ["Volume has three measurements multiplied together, so its unit has a small 3."],
  },
  {
    stem: "Which unit is used to measure the volume of a large water tank?",
    correct: "cubic metres (m³)",
    wrongs: ["square metres (m²)", "metres (m)", "kilograms (kg)"],
    explanation: "A large tank has a volume measured in cubic metres.",
    hints: ["A big container needs a big cubic unit."],
  },
  {
    stem: "Which unit is best for measuring the amount of medicine in a spoon?",
    correct: "millilitres",
    wrongs: ["litres", "kilometres", "tonnes"],
    explanation: "A spoonful is very small, so it is measured in millilitres.",
    hints: ["Is a spoonful a lot of liquid, or very little?"],
  },
  {
    stem: "How many millilitres are there in 1 litre?",
    correct: "1 000",
    wrongs: ["10", "100", "10 000"],
    explanation: "1 litre = 1 000 millilitres.",
    hints: ["The prefix milli- means one thousandth."],
  },
];

export const volumeUnits = defineTemplate({
  id: "mea.volume-units",
  description: "State the units of capacity and volume.",
  covers: (o) =>
    scoped(o, { topic: MEA, strand: /^volume-and-capacity$/, text: /state units of capacity/i }),
  generate: ({ rng, q }) => {
    const item = rng.pick(VOLUME_UNIT_ITEMS);
    return q.mcq({
      skill: "KNOWLEDGE_COMPREHENSION",
      stem: item.stem,
      correct: item.correct,
      wrongs: item.wrongs.map((answer) => ({ answer })),
      explanation: item.explanation,
      hints:
        item.hints.length >= 2
          ? item.hints
          : [...item.hints, "Cross out the units that measure a different kind of thing."],
    });
  },
});

export const measurementTemplates = [
  massWeights,
  massScale,
  massConversion,
  massUnitsAndEstimates,
  massComparison,
  massOperations,
  grossNetTare,
  massRounding,
  rulerReading,
  lengthConversion,
  lengthUnits,
  lengthNonStandard,
  lengthOperations,
  capacityContainers,
  capacityConversion,
  jugReading,
  volumeOfCuboid,
  volumeDisplacement,
  volumeUnits,
];

// kept for the geometry templates
export { anyScope, numberToWords };
