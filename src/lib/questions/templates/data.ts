import { pickName } from "../context";
import { byLevel, defineTemplate, fmtInt, scoped, type Builders, type Wrong } from "../kit";
import { trimmedDecimal } from "../maths";
import type { Rng } from "../rng";
import type { Difficulty, GeneratedQuestion, StemData } from "../types";

/**
 * Data handling (the Relationships topic): collecting data, tally charts, tables, ready reckoners,
 * bar and column graphs, pictographs, pie charts and jagged line graphs, and using graphs to solve
 * problems on measures. The Content column of the syllabus decides which graphs appear in which grade.
 */

const REL = "REL" as const;
const strand = /^data-handling/;

/** A number as text: whole numbers plain, otherwise up to two decimals. */
const num = (n: number): string => trimmedDecimal(Math.round(n * 100), 2);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ── data sets ───────────────────────────────────────────────────────────────────────────────────

/** Unordered categories with a count each (a survey). */
interface CategorySet {
  id: string;
  local: boolean;
  title: string;
  categoryLabel: string;
  valueLabel: string;
  noun: string;
  categories: string[];
  /** "12 learners chose mango." */
  phrase: (category: string, n: number) => string;
  /** The start of a story that ends with a list of answers: "Rudo asked 12 learners … and wrote:" */
  listIntro: (person: string, total: number) => string;
  /** The symbol a pictograph draws. */
  symbol: string;
  /** The smallest scale step that suits the numbers. */
  minStep: number;
}

const CATEGORY_SETS: CategorySet[] = [
  {
    id: "fruit",
    local: false,
    title: "Favourite fruit of the learners",
    categoryLabel: "Fruit",
    valueLabel: "Number of learners",
    noun: "learners",
    categories: ["mango", "orange", "banana", "guava", "apple", "pawpaw"],
    phrase: (c, n) => `${n} ${n === 1 ? "learner" : "learners"} chose ${c}`,
    listIntro: (p, n) =>
      `${p} asked ${n} learners which fruit they like best and wrote down their answers:`,
    symbol: "☺",
    minStep: 1,
  },
  {
    id: "transport",
    local: false,
    title: "How the learners come to school",
    categoryLabel: "Way of travelling",
    valueLabel: "Number of learners",
    noun: "learners",
    categories: ["on foot", "by bus", "by bicycle", "by kombi", "by car"],
    phrase: (c, n) => `${n} ${n === 1 ? "learner comes" : "learners come"} ${c}`,
    listIntro: (p, n) =>
      `${p} asked ${n} learners how they come to school and wrote down their answers:`,
    symbol: "☺",
    minStep: 1,
  },
  {
    id: "sport",
    local: false,
    title: "Favourite sport of the learners",
    categoryLabel: "Sport",
    valueLabel: "Number of learners",
    noun: "learners",
    categories: ["football", "netball", "athletics", "volleyball", "cricket", "hockey"],
    phrase: (c, n) => `${n} ${n === 1 ? "learner" : "learners"} chose ${c}`,
    listIntro: (p, n) =>
      `${p} asked ${n} learners which sport they like best and wrote down their answers:`,
    symbol: "☺",
    minStep: 1,
  },
  {
    id: "subject",
    local: false,
    title: "Favourite subject of the learners",
    categoryLabel: "Subject",
    valueLabel: "Number of learners",
    noun: "learners",
    categories: ["mathematics", "English", "science", "art", "music", "agriculture"],
    phrase: (c, n) => `${n} ${n === 1 ? "learner" : "learners"} chose ${c}`,
    listIntro: (p, n) =>
      `${p} asked ${n} learners which subject they like best and wrote down their answers:`,
    symbol: "☺",
    minStep: 1,
  },
  {
    id: "crops",
    local: true,
    title: "Bags of crops harvested on a farm",
    categoryLabel: "Crop",
    valueLabel: "Number of bags",
    noun: "bags",
    categories: ["maize", "sorghum", "groundnuts", "round nuts", "cowpeas", "sunflower"],
    phrase: (c, n) => `${n} ${n === 1 ? "bag" : "bags"} of ${c} were harvested`,
    listIntro: (_p, n) => `A farmer wrote down the crop in each of ${n} bags that were harvested:`,
    symbol: "▣",
    minStep: 5,
  },
  {
    id: "animals",
    local: true,
    title: "Animals on a farm",
    categoryLabel: "Animal",
    valueLabel: "Number of animals",
    noun: "animals",
    categories: ["cattle", "goats", "sheep", "hens", "ducks", "donkeys"],
    phrase: (c, n) => `the farm has ${n} ${c}`,
    listIntro: (p, n) =>
      `${p} counted ${n} animals on a farm and wrote down the kind of each animal:`,
    symbol: "●",
    minStep: 2,
  },
  {
    id: "tuckshop",
    local: true,
    title: "Items sold at the tuck shop in one day",
    categoryLabel: "Item",
    valueLabel: "Number sold",
    noun: "items",
    categories: ["bread", "sweets", "biscuits", "juice", "eggs", "pies"],
    phrase: (c, n) => `${n} ${c} were sold`,
    listIntro: (_p, n) => `The tuck shop wrote down each of the ${n} items that were sold today:`,
    symbol: "◆",
    minStep: 2,
  },
];

/** Ordered labels (days, months, weeks) with a measured value each. */
interface SeriesSet {
  id: string;
  local: boolean;
  title: string;
  categoryLabel: string;
  valueLabel: string;
  unit: string;
  labels: string[];
  steps: number[];
  /** The values keep rising (growth). */
  growth?: boolean;
  /** The values add up to something meaningful (growth heights do not). */
  additive?: boolean;
  /** How the unit can be changed: for problems on measures. */
  convert?: {
    fromOne: string;
    fromMany: string;
    toOne: string;
    toMany: string;
    factor: number;
    direction: "multiply" | "divide";
  };
  /** "On Monday 25 books were borrowed." */
  phrase: (label: string, n: number) => string;
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const SERIES_SETS: SeriesSet[] = [
  {
    id: "library",
    local: false,
    title: "Books borrowed from the school library",
    categoryLabel: "Day",
    valueLabel: "Number of books",
    unit: "books",
    labels: WEEKDAYS,
    steps: [2, 5, 10],
    phrase: (l, n) => `${n} books were borrowed on ${l}`,
  },
  {
    id: "absent",
    local: false,
    title: "Learners absent from school",
    categoryLabel: "Day",
    valueLabel: "Number of learners",
    unit: "learners",
    labels: WEEKDAYS,
    steps: [1, 2, 5],
    phrase: (l, n) => `${n} learners were absent on ${l}`,
  },
  {
    id: "water",
    local: false,
    title: "Water used at the school each day",
    categoryLabel: "Day",
    valueLabel: "Water used (litres)",
    unit: "litres",
    labels: WEEKDAYS,
    steps: [50, 100],
    convert: {
      fromOne: "litre",
      fromMany: "litres",
      toOne: "millilitre",
      toMany: "millilitres",
      factor: 1000,
      direction: "multiply",
    },
    phrase: (l, n) => `${n} litres of water were used on ${l}`,
  },
  {
    id: "maize-sold",
    local: true,
    title: "Maize sold at the market",
    categoryLabel: "Day",
    valueLabel: "Maize sold (kg)",
    unit: "kg",
    labels: WEEKDAYS,
    steps: [10, 20, 50],
    convert: {
      fromOne: "kilogram",
      fromMany: "kilograms",
      toOne: "gram",
      toMany: "grams",
      factor: 1000,
      direction: "multiply",
    },
    phrase: (l, n) => `${n} kg of maize were sold on ${l}`,
  },
  {
    id: "rainfall",
    local: true,
    title: "Rainfall each month",
    categoryLabel: "Month",
    valueLabel: "Rainfall (mm)",
    unit: "mm",
    labels: ["November", "December", "January", "February", "March", "April"],
    steps: [10, 20, 50],
    convert: {
      fromOne: "millimetre",
      fromMany: "millimetres",
      toOne: "centimetre",
      toMany: "centimetres",
      factor: 10,
      direction: "divide",
    },
    phrase: (l, n) => `${n} mm of rain fell in ${l}`,
  },
  {
    id: "growth",
    local: true,
    title: "Height of a maize plant",
    categoryLabel: "Week",
    valueLabel: "Height (cm)",
    unit: "cm",
    labels: ["Week 1", "Week 2", "Week 3", "Week 4", "Week 5", "Week 6"],
    steps: [10, 20],
    growth: true,
    additive: false,
    convert: {
      fromOne: "centimetre",
      fromMany: "centimetres",
      toOne: "millimetre",
      toMany: "millimetres",
      factor: 10,
      direction: "multiply",
    },
    phrase: (l, n) => `the plant was ${n} cm tall in ${l}`,
  },
];

const STEPS_BY_GRADE: Record<number, number[]> = {
  3: [1, 2, 5],
  4: [1, 2, 5, 10],
  5: [2, 5, 10, 20],
  6: [5, 10, 20, 50],
  7: [5, 10, 20, 50, 100],
};

function pickStep(rng: Rng, allowed: number[], grade: number, minStep = 1): number {
  const byGrade = STEPS_BY_GRADE[grade] ?? [1, 2, 5];
  const both = allowed.filter((s) => byGrade.includes(s) && s >= minStep);
  if (both.length > 0) return rng.pick(both);
  const near = allowed.filter((s) => s >= minStep);
  return rng.pick(near.length > 0 ? near : allowed);
}

/**
 * `n` distinct values that are whole numbers of steps (from Difficulty 4 also half steps, which a
 * learner reads half way between two lines). Growth data is sorted upwards.
 */
function makeValues(
  rng: Rng,
  n: number,
  step: number,
  d: Difficulty,
  options: { growth?: boolean } = {},
): number[] {
  const half = d >= 4 && step % 2 === 0;
  const unit = half ? step / 2 : step;
  const factor = half ? 2 : 1;
  const top = Math.max(n + 2, byLevel(d, [8, 9, 10, 10, 10])) * factor;
  for (let tries = 0; tries < 300; tries++) {
    const raw = Array.from({ length: n }, () => rng.int(factor, top));
    if (new Set(raw).size !== n) continue;
    const ordered = options.growth ? [...raw].sort((a, b) => a - b) : raw;
    return ordered.map((v) => v * unit);
  }
  throw new Error("makeValues: could not make distinct values");
}

const axisMax = (values: number[], step: number): number =>
  Math.ceil(Math.max(...values) / step) * step;

interface Chart {
  title: string;
  categoryLabel: string;
  valueLabel: string;
  noun: string;
  unit?: string;
  rows: Array<{ label: string; value: number }>;
  step: number;
  max: number;
  local: boolean;
  phrase: (label: string, n: number) => string;
  symbol: string;
  convert?: SeriesSet["convert"];
  series: boolean;
  /** The values may be added up. */
  additive: boolean;
}

function categoryChart(
  rng: Rng,
  grade: number,
  d: Difficulty,
  local: boolean,
  count?: number,
): Chart {
  const pool = CATEGORY_SETS.filter((s) => s.local === local);
  const set = rng.pick(pool.length > 0 ? pool : CATEGORY_SETS);
  const n =
    count ?? rng.int(Math.min(4, set.categories.length), Math.min(6, set.categories.length));
  const step = pickStep(rng, [1, 2, 5, 10, 20, 50, 100], grade, set.minStep);
  const labels = rng.sample(set.categories, n);
  const values = makeValues(rng, n, step, d);
  return {
    title: set.title,
    categoryLabel: set.categoryLabel,
    valueLabel: set.valueLabel,
    noun: set.noun,
    rows: labels.map((label, i) => ({ label: cap(label), value: values[i]! })),
    step,
    max: axisMax(values, step),
    local: set.local,
    phrase: set.phrase,
    symbol: set.symbol,
    series: false,
    additive: true,
  };
}

function pickSeries(
  rng: Rng,
  local: boolean,
  keep: (s: SeriesSet) => boolean = () => true,
): SeriesSet {
  const all = SERIES_SETS.filter(keep);
  const pool = all.filter((s) => s.local === local);
  return rng.pick(pool.length > 0 ? pool : all);
}

function seriesChart(
  rng: Rng,
  grade: number,
  d: Difficulty,
  set: SeriesSet,
  count?: number,
): Chart {
  const n = Math.min(count ?? set.labels.length, set.labels.length);
  const step = pickStep(rng, set.steps, grade);
  const values = makeValues(rng, n, step, d, { growth: set.growth === true });
  return {
    title: set.title,
    categoryLabel: set.categoryLabel,
    valueLabel: set.valueLabel,
    noun: set.unit,
    unit: set.unit,
    rows: set.labels.slice(0, n).map((label, i) => ({ label, value: values[i]! })),
    step,
    max: axisMax(values, step),
    local: set.local,
    phrase: set.phrase,
    symbol: "●",
    ...(set.convert ? { convert: set.convert } : {}),
    series: true,
    additive: set.additive !== false,
  };
}

/** `n` distinct whole numbers from lo to hi. */
function distinctInts(rng: Rng, n: number, lo: number, hi: number): number[] {
  const all = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  return rng.sample(all, n);
}

const extremes = (rows: Chart["rows"]) => {
  const sorted = [...rows].sort((a, b) => a.value - b.value);
  return { least: sorted[0]!, greatest: sorted[sorted.length - 1]! };
};

/** Wrong readings of a bar: its neighbours and the next or previous line on the scale. */
function readingWrongs(rows: Chart["rows"], index: number, step: number): Wrong[] {
  const value = rows[index]!.value;
  const out: Array<{ value: number; tag?: string }> = [];
  const neighbours = [rows[index - 1], rows[index + 1]].filter(Boolean);
  for (const n of neighbours) out.push({ value: n!.value, tag: "GRAPH_READING_ERROR" });
  out.push({ value: value + step, tag: "GRAPH_READING_ERROR" });
  out.push({ value: value - step, tag: "GRAPH_READING_ERROR" });
  // counting the lines instead of reading what each line stands for
  if (step > 1) out.push({ value: value / step, tag: "GRAPH_READING_ERROR" });
  return out
    .filter((w) => w.value > 0 && Math.abs(w.value - value) > 1e-9)
    .map((w) => ({ answer: num(w.value), ...(w.tag ? { tag: w.tag } : {}) }));
}

/** Make a few different wrong labels (other categories). */
const otherLabels = (rows: Chart["rows"], not: string): Wrong[] =>
  rows.filter((r) => r.label !== not).map((r) => ({ answer: r.label }));

const GRAPH_READING_HINTS = [
  "Find the label on the graph first. Then follow the bar from the label to its end.",
  "Read the number on the scale where the bar ends. Check what each line on the scale is worth.",
];

// ── collecting data ─────────────────────────────────────────────────────────────────────────────

interface Knowledge {
  minGrade: number;
  stem: string;
  correct: string;
  wrongs: string[];
  explanation: string;
  hints: string[];
}

const COLLECTING: Knowledge[] = [
  {
    minGrade: 3,
    stem: "Rudo wants to find out which fruit the learners in her class like best. What should she do?",
    correct: "Ask each learner and write down their answer",
    wrongs: [
      "Guess which fruit is the most popular",
      "Ask only her best friend",
      "Count the chairs in the classroom",
    ],
    explanation:
      "To collect data we ask the people we want to know about (or look at all of them) and write down every answer.",
    hints: [
      "Data is information that we collect: it must come from the learners themselves.",
      "Which choice finds out what ALL the learners like?",
    ],
  },
  {
    minGrade: 3,
    stem: "Which tool helps us to keep count while we collect data?",
    correct: "A tally chart",
    wrongs: ["A ruler", "A clock", "A compass"],
    explanation:
      "A tally chart lets us make a mark for every answer we collect, so that we can count them afterwards.",
    hints: [
      "Think of a way of making a mark each time you see or hear an answer.",
      "Which choice is used for counting marks?",
    ],
  },
  {
    minGrade: 3,
    stem: "Which of these can we collect data about by counting?",
    correct: "The number of learners in each class",
    wrongs: [
      "What a learner is thinking",
      "How tall a plant will be next year",
      "The story in a book",
    ],
    explanation:
      "We can count how many learners are in each class, so this is data that we can collect.",
    hints: [
      "Data can be collected by counting or by asking.",
      "Which choice can really be counted today?",
    ],
  },
  {
    minGrade: 3,
    stem: "We want to know how many learners walk to school. Who should we ask?",
    correct: "The learners of the school",
    wrongs: ["The teachers' families only", "People in another town", "Nobody: we can guess"],
    explanation: "The learners are the people who know how they come to school, so we ask them.",
    hints: [
      "Who has the information we want?",
      "Data must come from the people or things we want to know about.",
    ],
  },
  {
    minGrade: 3,
    stem: "After collecting data, where can we record it so that it is easy to read?",
    correct: "In a table or tally chart",
    wrongs: ["On a map of the village", "In a drawing of a house", "Nowhere: we remember it"],
    explanation:
      "A table or a tally chart keeps the data in order so that we can read and count it.",
    hints: [
      "Think about how to keep the data tidy so it can be counted again.",
      "Which choice keeps numbers and names in rows?",
    ],
  },
  {
    minGrade: 4,
    stem: "Tendai counted the vehicles that passed the school gate in 30 minutes and made a mark for each one. What did he do?",
    correct: "He collected data by counting and used tally marks",
    wrongs: [
      "He drew a pie chart",
      "He wrote a story about vehicles",
      "He measured the length of the road",
    ],
    explanation: "Counting things and making a mark for each one is collecting data with a tally.",
    hints: [
      "Making a mark for each vehicle is a way of keeping count.",
      "What do we call the marks we make in groups of five?",
    ],
  },
  {
    minGrade: 4,
    stem: "Which question could you ask to collect data about the favourite colour of the learners in a class?",
    correct: "Which colour do you like best: red, blue, green or yellow?",
    wrongs: ["How old are you?", "Do you like school?", "What time do you wake up?"],
    explanation:
      "This question asks about colours and gives clear choices, so the answers can be counted.",
    hints: [
      "The question must ask about the thing we want to know: colour.",
      "It helps when the question gives choices that can be counted.",
    ],
  },
  {
    minGrade: 5,
    stem: "A survey is a way of collecting data. In a survey we …",
    correct: "ask a group of people the same questions and record their answers",
    wrongs: [
      "ask each person a different question",
      "only look at one person's answer",
      "draw a graph before we have any answers",
    ],
    explanation:
      "In a survey everybody in the group is asked the same questions, so the answers can be counted and compared.",
    hints: [
      "To compare answers fairly, every person must be asked the same thing.",
      "Think about what a survey is for: finding out about a group of people.",
    ],
  },
  {
    minGrade: 5,
    stem: "Which is the best question for a survey about the favourite sport of learners?",
    correct: "Which sport do you like best: football, netball, athletics or volleyball?",
    wrongs: [
      "What do you think about school?",
      "Is football the best sport in the world?",
      "Do you play sport and do you have shoes?",
    ],
    explanation:
      "A good survey question asks about one thing and gives clear choices. The other questions are vague, leading, or ask two things at once.",
    hints: [
      "A good survey question is about only one thing and is easy to answer.",
      "It should not push the person to give a certain answer.",
    ],
  },
  {
    minGrade: 6,
    stem: "A class wants to find out how all the learners of the school travel to school. What is the best way to collect the data?",
    correct: "Ask a number of learners from every class the same question and tally the answers",
    wrongs: [
      "Ask only the learners in one class and say it is the same for all",
      "Ask the teachers what they think",
      "Look at the school gate for a minute",
    ],
    explanation:
      "To learn about the whole school we ask learners from all the classes the same question and record each answer.",
    hints: [
      "The data must represent every part of the school, not just one class.",
      "Everyone asked must get the same question.",
    ],
  },
  {
    minGrade: 6,
    stem: "Statistical data is organised so that it is easy to read. Which of these organises raw data best?",
    correct: "A frequency table that shows how many times each answer occurred",
    wrongs: [
      "A long list in the order the answers came in",
      "A list of the names only",
      "A drawing of the learners",
    ],
    explanation:
      "A frequency table shows each answer and how often it occurred, so the data is easy to read.",
    hints: [
      "Think about how to show how many of each answer there are.",
      "Which choice counts the answers for us?",
    ],
  },
];

export const collectData = defineTemplate({
  id: "rel.collect",
  description:
    "Why and how data is collected: asking, counting, tally marks, survey questions, recording.",
  covers: (o) => scoped(o, { topic: REL, strand, text: /collect/i }),
  generate: ({ objective: o, rng, q }) => {
    const bank = COLLECTING.filter((k) => k.minGrade <= o.grade);
    const pick = rng.pick(bank);
    return q.mcq({
      skill: "KNOWLEDGE_COMPREHENSION",
      stem: pick.stem,
      correct: pick.correct,
      wrongs: pick.wrongs.map((answer) => ({ answer })),
      explanation: pick.explanation,
      hints: pick.hints,
    });
  },
});

// ── tally charts ────────────────────────────────────────────────────────────────────────────────

export const tallyChart = defineTemplate({
  id: "rel.tally",
  description: "Tally charts: counting tallies, tallying a list of answers, and reading totals.",
  covers: (o) => scoped(o, { topic: REL, strand, text: /tally/i }),
  generate: ({ difficulty: d, rng, q, local }) => {
    const pool = CATEGORY_SETS.filter((s) => s.local === local);
    const set = rng.pick(pool.length > 0 ? pool : CATEGORY_SETS);
    const modes: Array<"one" | "list" | "read" | "total" | "most" | "difference"> = ["one", "list"];
    if (d >= 2) modes.push("read", "most");
    if (d >= 3) modes.push("total", "difference");
    const mode = rng.pick(modes);
    const cats = rng.sample(set.categories, rng.int(3, Math.min(5, set.categories.length)));
    const top = byLevel(d, [8, 10, 14, 18, 24]);

    if (mode === "one") {
      const n = rng.int(3, top);
      const label = cap(cats[0]!);
      return q.numeric({
        skill: "KNOWLEDGE_COMPREHENSION",
        type: "VISUAL_DIAGRAM",
        stem: "The tally chart shows one row of tally marks. Each group of four marks with a line across it stands for 5. What number does the tally show?",
        stemData: { kind: "tally", title: set.title, rows: [{ label, count: n }] },
        answer: String(n),
        wrongs: [
          { answer: String(Math.floor(n / 5) + (n % 5)), tag: "GRAPH_READING_ERROR" },
          { answer: String(n + 5) },
          { answer: String(n - 1) },
          { answer: String(n + 1) },
        ].filter((w) => Number(w.answer) > 0),
        explanation: `Count the groups of five first: ${Math.floor(n / 5)} × 5 = ${Math.floor(n / 5) * 5}. Then count the marks left over: ${n % 5}. Altogether ${n}.`,
        hints: [
          "Each group of marks with a line across it stands for 5.",
          "Count in fives for the full groups, then add on the single marks.",
        ],
        usesLocalContext: set.local,
      });
    }
    if (mode === "list") {
      const total = byLevel(d, [10, 12, 15, 18, 22]);
      const choices = cats.slice(0, 3);
      const answers = Array.from({ length: total }, () => rng.pick(choices));
      const countOf = (c: string) => answers.filter((a) => a === c).length;
      // ask about an answer that was given at least twice, so that the tally is worth making
      const askable = choices.filter((c) => countOf(c) >= 2);
      const asked = askable.length > 0 ? rng.pick(askable) : choices[0]!;
      const count = countOf(asked);
      const person = pickName(rng);
      return q.numeric({
        skill: "APPLICATION",
        type: "DATA_INTERPRETATION",
        stem: `${set.listIntro(person, total)} ${answers.join(", ")}. Make a tally of the answers. How many times did the answer "${asked}" occur?`,
        answer: String(count),
        wrongs: [
          { answer: String(count + 1), tag: "GRAPH_READING_ERROR" },
          { answer: String(count - 1), tag: "GRAPH_READING_ERROR" },
          ...choices.filter((c) => c !== asked).map((c) => ({ answer: String(countOf(c)) })),
        ].filter((w) => Number(w.answer) > 0),
        explanation: `Going through the list and making a tally mark for each "${asked}" gives ${count} marks.`,
        hints: [
          `Go through the answers one at a time. Make a tally mark each time you see "${asked}".`,
          "Strike out each answer as you count it so that you do not count it twice.",
        ],
        usesLocalContext: set.local,
      });
    }
    // charts with several rows
    const counts = distinctInts(rng, cats.length, 2, top);
    const rows = cats.map((c, i) => ({ label: cap(c), count: counts[i]! }));
    const picture: StemData = { kind: "tally", title: set.title, rows };
    const common = {
      skill: "APPLICATION" as const,
      type: "VISUAL_DIAGRAM" as const,
      stemData: picture,
      usesLocalContext: set.local,
    };
    const ranking = [...rows].sort((a, b) => a.count - b.count);
    const most = ranking[ranking.length - 1]!;
    if (mode === "read") {
      const row = rng.pick(rows);
      return q.numeric({
        ...common,
        stem: `Look at the tally chart. What number does the tally show for ${row.label.toLowerCase()}?`,
        answer: String(row.count),
        wrongs: [
          ...rows
            .filter((r) => r !== row)
            .map((r) => ({ answer: String(r.count), tag: "GRAPH_READING_ERROR" })),
          { answer: String(row.count + 5) },
          { answer: String(row.count - 1) },
        ].filter((w) => Number(w.answer) > 0),
        explanation: `${row.label} has ${Math.floor(row.count / 5)} full groups of 5 and ${row.count % 5} more marks: ${row.count}.`,
        hints: [
          "Find the row for the answer you want.",
          "Count the groups of five first, then the single marks.",
        ],
      });
    }
    if (mode === "most") {
      return q.mcq({
        ...common,
        stem: "Look at the tally chart. Which answer has the most tally marks?",
        correct: most.label,
        wrongs: rows.filter((r) => r.label !== most.label).map((r) => ({ answer: r.label })),
        explanation: `${most.label} has ${most.count} tally marks, more than any other row.`,
        hints: [
          "Count the tally marks in each row.",
          "Compare the totals. The row with the greatest total has the most.",
        ],
      });
    }
    if (mode === "total") {
      const total = rows.reduce((a, r) => a + r.count, 0);
      return q.numeric({
        ...common,
        stem: "Look at the tally chart. How many marks are there altogether?",
        answer: String(total),
        wrongs: [
          { answer: String(total - ranking[0]!.count), tag: "GRAPH_READING_ERROR" },
          { answer: String(total + 5) },
          { answer: String(most.count) },
        ].filter((w) => Number(w.answer) > 0),
        explanation: `Add the rows: ${rows.map((r) => r.count).join(" + ")} = ${total}.`,
        hints: ["Find the total of each row first.", "Then add all the totals together."],
      });
    }
    const [a, b] = rng.sample(rows, 2);
    const diff = Math.abs(a!.count - b!.count);
    const bigger = a!.count > b!.count ? a! : b!;
    const smaller = bigger === a ? b! : a!;
    return q.numeric({
      ...common,
      stem: `Look at the tally chart. How many more marks does ${bigger.label.toLowerCase()} have than ${smaller.label.toLowerCase()}?`,
      answer: String(diff),
      wrongs: [
        { answer: String(a!.count + b!.count), tag: "OPERATION_CHOICE_ERROR" },
        { answer: String(bigger.count) },
        { answer: String(smaller.count) },
      ].filter((w) => Number(w.answer) > 0 && Number(w.answer) !== diff),
      explanation: `${bigger.label}: ${bigger.count}, ${smaller.label}: ${smaller.count}. ${bigger.count} − ${smaller.count} = ${diff}.`,
      hints: [
        "Count the marks in the two rows.",
        "To find how many more, take the smaller total away from the bigger total.",
      ],
    });
  },
});

// ── tables ──────────────────────────────────────────────────────────────────────────────────────

function twoWayTable(rng: Rng, d: Difficulty, grade: number) {
  const set = rng.pick(SERIES_SETS.filter((s) => s.unit === "books" || s.unit === "learners"));
  const columns = rng
    .sample(["Class A", "Class B", "Class C", "Class D"], byLevel(d, [2, 3, 3, 3, 4]))
    .sort();
  const step = pickStep(rng, [1, 2, 5], grade);
  const days = set.labels.slice(0, byLevel(d, [3, 4, 5, 5, 5]));
  const cells = days.map(() => makeValues(rng, columns.length, step, 3 as Difficulty));
  return { set, columns, days, cells };
}

export const tables = defineTemplate({
  id: "rel.table",
  description: "Read and use tables: one-way frequency tables and two-way tables with totals.",
  covers: (o) => scoped(o, { topic: REL, strand, text: /\btables?\b/i }),
  generate: ({ objective: o, difficulty: d, rng, q, local }) => {
    const grade = o.grade;
    const twoWay = grade >= 4 && d >= 3 && rng.chance(0.5);
    if (!twoWay) {
      const chart = categoryChart(rng, grade, d, local, undefined);
      const picture: StemData = {
        kind: "table",
        caption: chart.title,
        headers: [chart.categoryLabel, chart.valueLabel],
        rows: chart.rows.map((r) => [r.label, String(r.value)]),
      };
      const { least, greatest } = extremes(chart.rows);
      const modes: Array<"read" | "greatest" | "least" | "total" | "difference" | "statement"> = [
        "read",
        "greatest",
      ];
      if (d >= 2) modes.push("least", "statement");
      if (d >= 3) modes.push("total", "difference");
      const mode = rng.pick(modes);
      const common = {
        skill: "KNOWLEDGE_COMPREHENSION" as const,
        type: "DATA_INTERPRETATION" as const,
        stemData: picture,
        usesLocalContext: chart.local,
      };
      if (mode === "read") {
        const index = rng.int(0, chart.rows.length - 1);
        const row = chart.rows[index]!;
        return q.numeric({
          ...common,
          stem: `Look at the table. What number is shown for ${row.label.toLowerCase()}?`,
          answer: String(row.value),
          wrongs: readingWrongs(chart.rows, index, chart.step),
          explanation: `In the row for ${row.label.toLowerCase()}, the table shows ${row.value}.`,
          hints: [
            `Find the row for ${row.label.toLowerCase()} in the first column.`,
            "Read across the row to the number in the second column.",
          ],
        });
      }
      if (mode === "greatest" || mode === "least") {
        const target = mode === "greatest" ? greatest : least;
        return q.mcq({
          ...common,
          stem: `Look at the table. Which ${chart.categoryLabel.toLowerCase()} has the ${mode === "greatest" ? "greatest" : "smallest"} number?`,
          correct: target.label,
          wrongs: otherLabels(chart.rows, target.label),
          explanation: `${target.label} has ${target.value}, which is the ${mode === "greatest" ? "greatest" : "smallest"} number in the table.`,
          hints: [
            "Look down the column of numbers.",
            `Find the ${mode === "greatest" ? "biggest" : "smallest"} number, then read the name in the same row.`,
          ],
        });
      }
      if (mode === "statement") {
        const [a, b] = rng.sample(chart.rows, 2);
        const greater = a!.value > b!.value;
        return q.trueFalse({
          skill: "KNOWLEDGE_COMPREHENSION",
          stemData: picture,
          stem: `Look at the table. True or false: the number for ${a!.label.toLowerCase()} is greater than the number for ${b!.label.toLowerCase()}.`,
          value: greater,
          falseTag: "GRAPH_READING_ERROR",
          explanation: `${a!.label} is ${a!.value} and ${b!.label} is ${b!.value}, so the statement is ${greater ? "true" : "false"}.`,
          hints: ["Find both rows in the table.", "Compare the two numbers: which one is greater?"],
          usesLocalContext: chart.local,
        });
      }
      if (mode === "total") {
        const total = chart.rows.reduce((a, r) => a + r.value, 0);
        return q.numeric({
          ...common,
          stem: `Look at the table. How many ${chart.noun} are there altogether?`,
          answer: String(total),
          wrongs: [
            { answer: String(total - least.value), tag: "GRAPH_READING_ERROR" },
            { answer: String(total - greatest.value), tag: "GRAPH_READING_ERROR" },
            { answer: String(greatest.value) },
            { answer: String(total + chart.step) },
          ].filter((w) => Number(w.answer) > 0),
          explanation: `Add all the numbers: ${chart.rows.map((r) => r.value).join(" + ")} = ${total}.`,
          hints: ["Every row of the table counts.", "Add the numbers in the second column."],
        });
      }
      const [a, b] = rng.sample(chart.rows, 2);
      const bigger = a!.value > b!.value ? a! : b!;
      const smaller = bigger === a ? b! : a!;
      const diff = bigger.value - smaller.value;
      return q.numeric({
        ...common,
        skill: "APPLICATION",
        stem: `Look at the table. How many more are there for ${bigger.label.toLowerCase()} than for ${smaller.label.toLowerCase()}?`,
        answer: String(diff),
        wrongs: [
          { answer: String(a!.value + b!.value), tag: "OPERATION_CHOICE_ERROR" },
          { answer: String(bigger.value) },
          { answer: String(smaller.value) },
        ].filter((w) => Number(w.answer) > 0 && Number(w.answer) !== diff),
        explanation: `${bigger.label}: ${bigger.value}. ${smaller.label}: ${smaller.value}. ${bigger.value} − ${smaller.value} = ${diff}.`,
        hints: [
          "Find the two numbers in the table.",
          "To find how many more, take the smaller number away from the bigger one.",
        ],
      });
    }

    // a two-way table
    const t = twoWayTable(rng, d, grade);
    const headers = ["Day", ...t.columns];
    const picture: StemData = {
      kind: "table",
      caption: `${t.set.title} by class`,
      headers,
      rows: t.days.map((day, i) => [day, ...t.cells[i]!.map(String)]),
    };
    const common = {
      skill: "APPLICATION" as const,
      type: "DATA_INTERPRETATION" as const,
      stemData: picture,
    };
    const library = t.set.unit === "books";
    // how each question is worded for the two data sets
    const askCell = (day: string, cls: string) =>
      library
        ? `How many books were borrowed on ${day} by ${cls}?`
        : `How many learners from ${cls} were absent on ${day}?`;
    const askRow = (day: string) =>
      library
        ? `How many books were borrowed on ${day} by all the classes together?`
        : `How many learners were absent on ${day} from all the classes together?`;
    const askColumn = (cls: string) =>
      library
        ? `How many books were borrowed by ${cls} on the days shown altogether?`
        : `How many learners from ${cls} were absent on the days shown altogether?`;
    const askMost = library
      ? "On which day were the most books borrowed by all the classes together?"
      : "On which day were the most learners absent from all the classes together?";
    const modes: Array<"cell" | "row" | "column" | "most-day"> = ["cell", "row"];
    if (d >= 3) modes.push("column", "most-day");
    const mode = rng.pick(modes);
    const dayIndex = rng.int(0, t.days.length - 1);
    const colIndex = rng.int(0, t.columns.length - 1);
    if (mode === "cell") {
      const value = t.cells[dayIndex]![colIndex]!;
      return q.numeric({
        ...common,
        stem: `Look at the table. ${askCell(t.days[dayIndex]!, t.columns[colIndex]!)}`,
        answer: String(value),
        wrongs: [
          ...t.cells[dayIndex]!.filter((_, i) => i !== colIndex).map((v) => ({
            answer: String(v),
            tag: "GRAPH_READING_ERROR",
          })),
          ...t.cells
            .filter((_, i) => i !== dayIndex)
            .map((r) => ({ answer: String(r[colIndex]!), tag: "GRAPH_READING_ERROR" })),
        ].filter((w) => Number(w.answer) !== value && Number(w.answer) > 0),
        explanation: `Row ${t.days[dayIndex]}, column ${t.columns[colIndex]}: ${value}.`,
        hints: [
          `Find the row for ${t.days[dayIndex]} and the column for ${t.columns[colIndex]}.`,
          "The number you want is where the row and the column meet.",
        ],
      });
    }
    if (mode === "row") {
      const total = t.cells[dayIndex]!.reduce((a, b) => a + b, 0);
      return q.numeric({
        ...common,
        stem: `Look at the table. ${askRow(t.days[dayIndex]!)}`,
        answer: String(total),
        wrongs: [
          { answer: String(total - t.cells[dayIndex]![0]!), tag: "GRAPH_READING_ERROR" },
          { answer: String(t.cells[dayIndex]![colIndex]!), tag: "GRAPH_READING_ERROR" },
          { answer: String(total + t.cells[dayIndex]![0]!) },
        ].filter((w) => Number(w.answer) > 0 && Number(w.answer) !== total),
        explanation: `Add the row for ${t.days[dayIndex]}: ${t.cells[dayIndex]!.join(" + ")} = ${total}.`,
        hints: [`Look only at the row for ${t.days[dayIndex]}.`, "Add the numbers in that row."],
      });
    }
    if (mode === "column") {
      const total = t.cells.reduce((a, r) => a + r[colIndex]!, 0);
      return q.numeric({
        ...common,
        stem: `Look at the table. ${askColumn(t.columns[colIndex]!)}`,
        answer: String(total),
        wrongs: [
          { answer: String(total - t.cells[0]![colIndex]!), tag: "GRAPH_READING_ERROR" },
          { answer: String(t.cells[dayIndex]![colIndex]!), tag: "GRAPH_READING_ERROR" },
          { answer: String(total + t.cells[0]![colIndex]!) },
        ].filter((w) => Number(w.answer) > 0 && Number(w.answer) !== total),
        explanation: `Add the column for ${t.columns[colIndex]}: ${t.cells.map((r) => r[colIndex]).join(" + ")} = ${total}.`,
        hints: [
          `Look only at the column for ${t.columns[colIndex]}.`,
          "Add the numbers in that column.",
        ],
      });
    }
    // which day had the most (all classes together)
    const totals = t.cells.map((r) => r.reduce((a, b) => a + b, 0));
    const bestTotal = Math.max(...totals);
    if (totals.filter((x) => x === bestTotal).length === 1) {
      const best = totals.indexOf(bestTotal);
      return q.mcq({
        ...common,
        stem: `Look at the table. ${askMost}`,
        correct: t.days[best]!,
        wrongs: t.days
          .filter((_, i) => i !== best)
          .map((answer) => ({ answer, tag: "GRAPH_READING_ERROR" })),
        explanation: `Row totals: ${t.days.map((day, i) => `${day} ${totals[i]}`).join(", ")}. ${t.days[best]} has the most.`,
        hints: [
          "Find the total for every day (add each row).",
          "Compare the totals to find the greatest.",
        ],
      });
    }
    const total = t.cells[dayIndex]!.reduce((a, b) => a + b, 0);
    return q.numeric({
      ...common,
      stem: `Look at the table. ${askRow(t.days[dayIndex]!)}`,
      answer: String(total),
      wrongs: [{ answer: String(t.cells[dayIndex]![0]!) }, { answer: String(total + 1) }].filter(
        (w) => Number(w.answer) !== total,
      ),
      explanation: `Add the row for ${t.days[dayIndex]}: ${t.cells[dayIndex]!.join(" + ")} = ${total}.`,
      hints: [`Look only at the row for ${t.days[dayIndex]}.`, "Add the numbers in that row."],
    });
  },
});

// ── ready reckoners ─────────────────────────────────────────────────────────────────────────────

export const readyReckoner = defineTemplate({
  id: "rel.ready-reckoner",
  description:
    "Ready reckoners: look up a price, a quantity or a fare in a table, and use it for amounts that are not listed.",
  covers: (o) => scoped(o, { topic: REL, strand, text: /ready reckoners?/i }),
  generate: ({ difficulty: d, rng, q, local }) => {
    const kind = local && d >= 2 ? rng.pick(["kombi", "price"] as const) : "price";
    const person = pickName(rng);
    if (kind === "kombi") {
      const bands = rng.int(4, 5);
      const base = rng.int(1, 2);
      const width = rng.pick([5, 10]);
      const fares = Array.from({ length: bands }, (_, i) => base + i);
      const rows = fares.map((fare, i) => [`${i * width + 1} – ${(i + 1) * width}`, `$${fare}`]);
      const picture: StemData = {
        kind: "table",
        caption: "Kombi fares from the town centre",
        headers: ["Distance (km)", "Fare"],
        rows,
      };
      const common = {
        skill: "APPLICATION" as const,
        type: "DATA_INTERPRETATION" as const,
        stemData: picture,
        usesLocalContext: true,
      };
      const band = rng.int(0, bands - 1);
      const distance = band * width + rng.int(1, width);
      const mode = d <= 2 ? "lookup" : rng.pick(["lookup", "two", "greatest"] as const);
      if (mode === "lookup") {
        return q.numeric({
          ...common,
          stem: `The ready reckoner shows kombi fares. How many dollars does ${person} pay to travel ${distance} km?`,
          answer: String(fares[band]),
          wrongs: [
            ...fares
              .filter((_, i) => i !== band)
              .map((f) => ({ answer: String(f), tag: "GRAPH_READING_ERROR" })),
            { answer: String(distance), tag: "GRAPH_READING_ERROR" },
          ].filter((w) => Number(w.answer) !== fares[band]),
          explanation: `${distance} km is in the band ${rows[band]![0]} km, so the fare is $${fares[band]}.`,
          hints: [
            "Find the band that contains the distance. The distance is not always listed exactly.",
            "Read the fare in the same row as that band.",
          ],
        });
      }
      if (mode === "two") {
        const second = rng.int(0, bands - 1);
        const secondDistance = second * width + rng.int(1, width);
        const total = fares[band]! + fares[second]!;
        return q.numeric({
          ...common,
          stem: `Use the ready reckoner. ${person} travels ${distance} km and a friend travels ${secondDistance} km. How many dollars do they pay altogether?`,
          answer: String(total),
          wrongs: [
            { answer: String(distance + secondDistance), tag: "GRAPH_READING_ERROR" },
            { answer: String(fares[band]), tag: "GRAPH_READING_ERROR" },
            { answer: String(total + 1) },
          ].filter((w) => Number(w.answer) !== total),
          explanation: `${distance} km: $${fares[band]}. ${secondDistance} km: $${fares[second]}. Together: $${total}.`,
          hints: [
            "Find the fare for each journey in the table separately.",
            "Then add the two fares.",
          ],
        });
      }
      const money = fares[band]!;
      const furthest = (band + 1) * width;
      return q.numeric({
        ...common,
        stem: `Use the ready reckoner. What is the greatest distance in kilometres that ${person} can travel for $${money}?`,
        answer: String(furthest),
        wrongs: [
          { answer: String(furthest - width + 1), tag: "GRAPH_READING_ERROR" },
          { answer: String(money), tag: "GRAPH_READING_ERROR" },
          ...(band + 1 < bands
            ? [{ answer: String(furthest + width), tag: "GRAPH_READING_ERROR" }]
            : []),
        ],
        explanation: `$${money} pays for the band ${rows[band]![0]} km, so the greatest distance is ${furthest} km.`,
        hints: [
          "Find the row of the table with that fare.",
          "The greatest distance is the last number of the band.",
        ],
      });
    }

    // a price list
    const item = rng.pick([
      { what: "sugar", unit: "kg", header: "Mass of sugar (kg)" },
      { what: "rice", unit: "kg", header: "Mass of rice (kg)" },
      { what: "cloth", unit: "metres", header: "Length of cloth (m)" },
      { what: "cooking oil", unit: "litres", header: "Amount of oil (litres)" },
    ]);
    const price = rng.int(2, byLevel(d, [5, 6, 8, 9, 12]));
    const maxQty = byLevel(d, [6, 8, 8, 10, 10]);
    const rows = Array.from({ length: maxQty }, (_, i) => [String(i + 1), `$${price * (i + 1)}`]);
    const picture: StemData = {
      kind: "table",
      caption: `Cost of ${item.what}`,
      headers: [item.header, "Cost"],
      rows,
    };
    const common = {
      skill: "APPLICATION" as const,
      type: "DATA_INTERPRETATION" as const,
      stemData: picture,
    };
    const modes: Array<"cost" | "quantity" | "combine"> =
      d <= 2 ? ["cost", "quantity"] : ["cost", "quantity", "combine"];
    const mode = rng.pick(modes);
    if (mode === "cost") {
      const qty = rng.int(2, maxQty);
      return q.numeric({
        ...common,
        stem: `Use the ready reckoner to find the cost of ${qty} ${item.unit} of ${item.what}. Give your answer in dollars.`,
        answer: String(price * qty),
        wrongs: [
          { answer: String(price * (qty - 1)), tag: "GRAPH_READING_ERROR" },
          { answer: String(price * (qty + 1)), tag: "GRAPH_READING_ERROR" },
          { answer: String(qty), tag: "GRAPH_READING_ERROR" },
        ].filter((w) => Number(w.answer) > 0),
        explanation: `In the row for ${qty} ${item.unit}, the cost is $${price * qty}.`,
        hints: [`Find ${qty} in the first column.`, "Read across to the cost in the same row."],
      });
    }
    if (mode === "quantity") {
      const qty = rng.int(2, maxQty);
      return q.numeric({
        ...common,
        stem: `${person} has $${price * qty}. Use the ready reckoner to find how many ${item.unit} of ${item.what} ${person} can buy.`,
        answer: String(qty),
        wrongs: [
          { answer: String(qty - 1), tag: "GRAPH_READING_ERROR" },
          { answer: String(qty + 1), tag: "GRAPH_READING_ERROR" },
          { answer: String(price * qty), tag: "GRAPH_READING_ERROR" },
        ].filter((w) => Number(w.answer) > 0),
        explanation: `The cost $${price * qty} is in the row for ${qty} ${item.unit}.`,
        hints: [
          `Find $${price * qty} in the second column.`,
          "Read the amount in the first column in the same row.",
        ],
      });
    }
    // an amount that is not listed: add two listed amounts
    const a = rng.int(2, maxQty);
    const b = rng.int(2, maxQty);
    const total = (a + b) * price;
    return q.numeric({
      ...common,
      skill: "PROBLEM_SOLVING",
      stem: `The ready reckoner does not list ${a + b} ${item.unit}. Use it to find the cost of ${a + b} ${item.unit} of ${item.what} by adding two amounts that are listed.`,
      answer: String(total),
      wrongs: [
        { answer: String(price * a), tag: "GRAPH_READING_ERROR" },
        { answer: String(price * b), tag: "GRAPH_READING_ERROR" },
        { answer: String(a + b) },
      ].filter((w) => Number(w.answer) !== total),
      explanation: `${a} ${item.unit} cost $${price * a} and ${b} ${item.unit} cost $${price * b}. Together: $${price * a} + $${price * b} = $${total}.`,
      hints: [
        `The table has no row for ${a + b}. Split ${a + b} into two amounts that are in the table.`,
        `For example, use ${a} and ${b}. Read the cost of each from the table.`,
        "Add the two costs.",
      ],
    });
  },
});

// ── bar graphs and column graphs ────────────────────────────────────────────────────────────────

function barPicture(chart: Chart, orientation: "vertical" | "horizontal"): StemData {
  return {
    kind: "bar-chart",
    title: chart.title,
    xLabel: chart.categoryLabel,
    yLabel: chart.valueLabel,
    bars: chart.rows.map((r) => ({ label: r.label, value: r.value })),
    max: chart.max,
    step: chart.step,
    orientation,
  };
}

export const barGraphs = defineTemplate({
  id: "rel.bar-graph",
  description:
    "Read bar graphs and column graphs: values on a scale, greatest and least, differences, totals and what the axes show.",
  covers: (o) => scoped(o, { topic: REL, strand, text: /bar graphs?|column graphs?/i }),
  generate: ({ objective: o, difficulty: d, rng, q, local }) => {
    const grade = o.grade;
    const t = o.text.toLowerCase();
    const orientation: "vertical" | "horizontal" =
      /column/.test(t) && !/bar graph/.test(t)
        ? "vertical"
        : /bar graph/.test(t) && !/column/.test(t)
          ? "horizontal"
          : rng.pick(["vertical", "horizontal"] as const);
    const graphName = orientation === "vertical" ? "column graph" : "bar graph";
    const chart =
      rng.chance(0.4) && grade >= 4
        ? seriesChart(rng, grade, d, pickSeries(rng, local))
        : categoryChart(rng, grade, d, local);
    const picture = barPicture(chart, orientation);
    const common = {
      type: "DATA_INTERPRETATION" as const,
      stemData: picture,
      usesLocalContext: chart.local,
    };
    const { least, greatest } = extremes(chart.rows);
    const unitWord = chart.series ? chart.unit! : chart.noun;

    if (/represent/.test(t)) {
      const modes: Array<"height" | "columns" | "tallest"> = ["height", "columns", "tallest"];
      const mode = rng.pick(modes);
      const table: StemData = {
        kind: "table",
        caption: chart.title,
        headers: [chart.categoryLabel, chart.valueLabel],
        rows: chart.rows.map((r) => [r.label, String(r.value)]),
      };
      const common2 = {
        type: "DATA_INTERPRETATION" as const,
        stemData: table,
        usesLocalContext: chart.local,
      };
      if (mode === "columns") {
        return q.numeric({
          ...common2,
          skill: "APPLICATION",
          stem: "The table shows data that will be drawn as a column graph. How many columns will the graph have?",
          answer: String(chart.rows.length),
          wrongs: [
            { answer: String(chart.rows.length + 1) },
            { answer: String(chart.rows.length - 1) },
            { answer: String(chart.rows.reduce((a, r) => a + r.value, 0)) },
          ].filter((w) => Number(w.answer) > 0 && Number(w.answer) !== chart.rows.length),
          explanation: `There is one column for each row of the table: ${chart.rows.length} columns.`,
          hints: [
            "A column graph has one column for each category.",
            "Count the rows in the table.",
          ],
        });
      }
      if (mode === "tallest") {
        return q.mcq({
          ...common2,
          skill: "APPLICATION",
          stem: "The table shows data that will be drawn as a column graph. Which column will be the tallest?",
          correct: greatest.label,
          wrongs: otherLabels(chart.rows, greatest.label),
          explanation: `${greatest.label} has the greatest value (${greatest.value}), so its column will be the tallest.`,
          hints: [
            "The taller the column, the greater the number.",
            "Find the greatest number in the table.",
          ],
        });
      }
      const row = rng.pick(chart.rows);
      return q.numeric({
        ...common2,
        skill: "APPLICATION",
        stem: `The table shows data that will be drawn as a column graph with a scale that goes up in steps of ${chart.step}. Up to which number on the scale must the column for ${row.label.toLowerCase()} reach?`,
        answer: String(row.value),
        wrongs: [
          { answer: String(row.value / chart.step), tag: "GRAPH_READING_ERROR" },
          { answer: String(row.value + chart.step), tag: "GRAPH_READING_ERROR" },
          { answer: String(row.value - chart.step), tag: "GRAPH_READING_ERROR" },
        ].filter((w) => Number(w.answer) > 0 && Number(w.answer) !== row.value),
        explanation: `The column for ${row.label.toLowerCase()} must reach ${row.value} on the scale.`,
        hints: [
          "The height of a column is the number in the table.",
          `Each step on the scale is worth ${chart.step}.`,
        ],
      });
    }

    const modes: Array<
      "read" | "greatest" | "least" | "difference" | "total" | "scale" | "axis" | "statement"
    > = ["read", "greatest"];
    if (d >= 2) modes.push("least", "axis", "difference");
    if (d >= 3) modes.push("scale", "statement");
    if (d >= 3 && chart.additive) modes.push("total");
    const mode = rng.pick(modes);

    if (mode === "read") {
      const index = rng.int(0, chart.rows.length - 1);
      const row = chart.rows[index]!;
      return q.numeric({
        ...common,
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Look at the ${graphName}. ${chart.series ? `What is the value for ${row.label}?` : `How many ${unitWord} are shown for ${row.label.toLowerCase()}?`}`,
        answer: String(row.value),
        wrongs: readingWrongs(chart.rows, index, chart.step),
        explanation: `The ${orientation === "vertical" ? "column" : "bar"} for ${row.label} ends at ${row.value} on the scale.`,
        hints: GRAPH_READING_HINTS,
      });
    }
    if (mode === "greatest" || mode === "least") {
      const target = mode === "greatest" ? greatest : least;
      return q.mcq({
        ...common,
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Look at the ${graphName}. Which ${chart.categoryLabel.toLowerCase()} has the ${mode === "greatest" ? (orientation === "vertical" ? "tallest column" : "longest bar") : orientation === "vertical" ? "shortest column" : "shortest bar"}?`,
        correct: target.label,
        wrongs: otherLabels(chart.rows, target.label),
        explanation: `${target.label} has the ${mode === "greatest" ? "greatest" : "smallest"} value (${target.value}).`,
        hints: [
          `Compare the ${orientation === "vertical" ? "heights of the columns" : "lengths of the bars"}.`,
          `Find the ${mode === "greatest" ? (orientation === "vertical" ? "tallest" : "longest") : "shortest"} one and read its label.`,
        ],
      });
    }
    if (mode === "axis") {
      const askCategory = rng.chance(0.5);
      const correct = askCategory ? chart.categoryLabel : chart.valueLabel;
      const wrong = askCategory ? chart.valueLabel : chart.categoryLabel;
      return q.mcq({
        ...common,
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Look at the ${graphName}. What do the labels ${orientation === "vertical" ? "along the bottom" : "down the side"} show?`,
        correct: askCategory ? correct : wrong,
        wrongs: [
          { answer: askCategory ? wrong : correct },
          { answer: "The title of the graph" },
          { answer: "The scale of the graph" },
        ],
        explanation: `The labels ${orientation === "vertical" ? "along the bottom" : "down the side"} name the ${chart.categoryLabel.toLowerCase()}. The scale shows ${chart.valueLabel.toLowerCase()}.`,
        hints: [
          "The scale shows numbers. The labels under or beside the bars are names.",
          "Which words tell you what each bar is about?",
        ],
      });
    }
    if (mode === "difference") {
      const [a, b] = rng.sample(chart.rows, 2);
      const bigger = a!.value > b!.value ? a! : b!;
      const smaller = bigger === a ? b! : a!;
      const diff = bigger.value - smaller.value;
      return q.numeric({
        ...common,
        skill: "APPLICATION",
        stem: chart.series
          ? `Look at the ${graphName}. How much more is the value for ${bigger.label} than the value for ${smaller.label}?`
          : `Look at the ${graphName}. How many more ${unitWord} are shown for ${bigger.label.toLowerCase()} than for ${smaller.label.toLowerCase()}?`,
        answer: String(diff),
        wrongs: [
          { answer: String(a!.value + b!.value), tag: "OPERATION_CHOICE_ERROR" },
          { answer: String(bigger.value), tag: "GRAPH_READING_ERROR" },
          { answer: String(smaller.value), tag: "GRAPH_READING_ERROR" },
          { answer: String(diff / chart.step), tag: "GRAPH_READING_ERROR" },
        ].filter((w) => Number(w.answer) > 0 && Number(w.answer) !== diff),
        explanation: `${bigger.label}: ${bigger.value}. ${smaller.label}: ${smaller.value}. ${bigger.value} − ${smaller.value} = ${diff}.`,
        hints: [
          "Read the value of each of the two bars.",
          "To find how many more, take the smaller value away from the bigger one.",
        ],
      });
    }
    if (mode === "total") {
      const total = chart.rows.reduce((a, r) => a + r.value, 0);
      return q.numeric({
        ...common,
        skill: "APPLICATION",
        stem: `Look at the ${graphName}. What is the total of all the ${orientation === "vertical" ? "columns" : "bars"}?`,
        answer: String(total),
        wrongs: [
          { answer: String(total - least.value), tag: "GRAPH_READING_ERROR" },
          { answer: String(total - greatest.value), tag: "GRAPH_READING_ERROR" },
          { answer: String(greatest.value), tag: "GRAPH_READING_ERROR" },
          { answer: String(total / chart.step), tag: "GRAPH_READING_ERROR" },
        ].filter((w) => Number(w.answer) > 0 && Number(w.answer) !== total),
        explanation: `Read every ${orientation === "vertical" ? "column" : "bar"} and add: ${chart.rows.map((r) => r.value).join(" + ")} = ${total}.`,
        hints: [
          `Read the value of every ${orientation === "vertical" ? "column" : "bar"}.`,
          "Do not forget any of them. Then add the values.",
        ],
      });
    }
    if (mode === "scale") {
      return q.numeric({
        ...common,
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Look at the scale of the ${graphName}. What is the difference between two neighbouring lines on the scale?`,
        answer: String(chart.step),
        wrongs: [
          { answer: String(chart.step * 2), tag: "GRAPH_READING_ERROR" },
          { answer: "1", tag: "GRAPH_READING_ERROR" },
          { answer: String(chart.max), tag: "GRAPH_READING_ERROR" },
          { answer: String(Math.max(1, chart.step / 2)), tag: "GRAPH_READING_ERROR" },
        ].filter((w) => Number(w.answer) > 0 && Number(w.answer) !== chart.step),
        explanation: `The scale goes up in steps of ${chart.step}.`,
        hints: [
          "Look at two neighbouring numbers printed on the scale.",
          "Take the smaller number away from the bigger one.",
        ],
      });
    }
    // statement
    const [a, b] = rng.sample(chart.rows, 2);
    const aBigger = a!.value > b!.value;
    return q.trueFalse({
      skill: "ANALYSIS",
      stemData: picture,
      stem: `Look at the ${graphName}. True or false: the value for ${a!.label.toLowerCase()} is greater than the value for ${b!.label.toLowerCase()}.`,
      value: aBigger,
      falseTag: "GRAPH_READING_ERROR",
      explanation: `${a!.label} is ${a!.value} and ${b!.label} is ${b!.value}, so the statement is ${aBigger ? "true" : "false"}.`,
      hints: [
        "Read the value of each of the two bars.",
        "Compare the two values: which one is greater?",
      ],
      usesLocalContext: chart.local,
    });
  },
});

// ── pictographs ─────────────────────────────────────────────────────────────────────────────────

export const pictographs = defineTemplate({
  id: "rel.pictograph",
  version: 2,
  description:
    "Read pictographs where one symbol stands for more than one: counts, totals, differences, the key.",
  covers: (o) => scoped(o, { topic: REL, strand, text: /pictographs?/i }),
  generate: ({ difficulty: d, rng, q, local }) => {
    const pool = CATEGORY_SETS.filter((s) => s.local === local);
    const set = rng.pick(pool.length > 0 ? pool : CATEGORY_SETS);
    const each = rng.pick(
      byLevel<number[]>(d, [
        [2, 5],
        [2, 5],
        [2, 5, 10],
        [5, 10],
        [5, 10, 20],
      ]),
    );
    const n = rng.int(4, Math.min(6, set.categories.length));
    const labels = rng.sample(set.categories, n);
    // distinct symbol counts keep "most" and "least" unambiguous
    const counts = distinctInts(rng, n, 1, Math.max(n, 9));
    const rows = labels.map((label, i) => ({
      label: cap(label),
      count: counts[i]!,
      total: counts[i]! * each,
    }));
    const picture: StemData = {
      kind: "pictograph",
      title: set.title, // the picture prints its own key line (symbol and value)
      symbol: set.symbol,
      each,
      rows: rows.map((r) => ({ label: r.label, count: r.count })),
    };
    const common = {
      type: "DATA_INTERPRETATION" as const,
      stemData: picture,
      usesLocalContext: set.local,
    };
    const noun = set.noun;
    const sorted = [...rows].sort((a, b) => a.total - b.total);
    const most = sorted[sorted.length - 1]!;
    const least = sorted[0]!;
    const modes: Array<"read" | "key" | "most" | "total" | "difference" | "least"> = [
      "read",
      "key",
    ];
    if (d >= 2) modes.push("most", "least");
    if (d >= 3) modes.push("total", "difference");
    const mode = rng.pick(modes);

    if (mode === "key") {
      return q.numeric({
        ...common,
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Look at the pictograph. How many ${noun} does one symbol stand for?`,
        answer: String(each),
        wrongs: [
          { answer: "1", tag: "GRAPH_READING_ERROR" },
          { answer: String(each * 2), tag: "GRAPH_READING_ERROR" },
          { answer: String(rows[0]!.count), tag: "GRAPH_READING_ERROR" },
        ].filter((w) => Number(w.answer) !== each),
        explanation: `The key says that one symbol stands for ${each} ${noun}.`,
        hints: [
          "Look for the key of the pictograph, which says what one symbol is worth.",
          "Read the number that is next to the symbol.",
        ],
      });
    }
    if (mode === "read") {
      const row = rng.pick(rows);
      return q.numeric({
        ...common,
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Look at the pictograph. How many ${noun} are shown for ${row.label.toLowerCase()}?`,
        answer: String(row.total),
        wrongs: [
          { answer: String(row.count), tag: "GRAPH_READING_ERROR" },
          { answer: String(row.count + each), tag: "GRAPH_READING_ERROR" },
          { answer: String(row.total - each), tag: "GRAPH_READING_ERROR" },
          { answer: String(row.count + each + each) },
        ].filter((w) => Number(w.answer) > 0 && Number(w.answer) !== row.total),
        explanation: `${row.label} has ${row.count} symbols. Each symbol stands for ${each}, so ${row.count} × ${each} = ${row.total}.`,
        hints: [
          "Count the symbols in the row.",
          "Each symbol is worth more than 1: use the key to find the value of one symbol.",
        ],
      });
    }
    if (mode === "most" || mode === "least") {
      const target = mode === "most" ? most : least;
      return q.mcq({
        ...common,
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Look at the pictograph. Which row has the ${mode === "most" ? "most" : "fewest"} symbols?`,
        correct: target.label,
        wrongs: rows.filter((r) => r.label !== target.label).map((r) => ({ answer: r.label })),
        explanation: `${target.label} has ${target.count} symbols, which is the ${mode === "most" ? "most" : "fewest"}.`,
        hints: ["Count the symbols in each row.", "Compare the counts."],
      });
    }
    if (mode === "total") {
      const total = rows.reduce((a, r) => a + r.total, 0);
      const symbols = rows.reduce((a, r) => a + r.count, 0);
      return q.numeric({
        ...common,
        skill: "APPLICATION",
        stem: `Look at the pictograph. How many ${noun} are shown altogether?`,
        answer: String(total),
        wrongs: [
          { answer: String(symbols), tag: "GRAPH_READING_ERROR" },
          { answer: String(total - least.total), tag: "GRAPH_READING_ERROR" },
          { answer: String(total + each) },
        ].filter((w) => Number(w.answer) > 0 && Number(w.answer) !== total),
        explanation: `${symbols} symbols × ${each} = ${total}.`,
        hints: [
          "Count all the symbols in the graph.",
          "Then use the key: multiply the number of symbols by the value of one symbol.",
        ],
      });
    }
    const [a, b] = rng.sample(rows, 2);
    const bigger = a!.total > b!.total ? a! : b!;
    const smaller = bigger === a ? b! : a!;
    const diff = bigger.total - smaller.total;
    return q.numeric({
      ...common,
      skill: "APPLICATION",
      stem: `Look at the pictograph. How many more ${noun} are shown for ${bigger.label.toLowerCase()} than for ${smaller.label.toLowerCase()}?`,
      answer: String(diff),
      wrongs: [
        { answer: String(bigger.count - smaller.count), tag: "GRAPH_READING_ERROR" },
        { answer: String(bigger.total + smaller.total), tag: "OPERATION_CHOICE_ERROR" },
        { answer: String(bigger.total), tag: "GRAPH_READING_ERROR" },
      ].filter((w) => Number(w.answer) > 0 && Number(w.answer) !== diff),
      explanation: `${bigger.label}: ${bigger.count} × ${each} = ${bigger.total}. ${smaller.label}: ${smaller.count} × ${each} = ${smaller.total}. ${bigger.total} − ${smaller.total} = ${diff}.`,
      hints: [
        "Find the value of each of the two rows by using the key.",
        "Take the smaller value away from the bigger one.",
      ],
    });
  },
});

// ── pie charts ──────────────────────────────────────────────────────────────────────────────────

/**
 * Percent shares in multiples of 10 (5 from Difficulty 4) that add up to 100, with one biggest and
 * one smallest slice so that "which slice is the biggest / smallest" has a single answer.
 */
function percentShares(rng: Rng, n: number, d: Difficulty): number[] {
  const unit = d <= 3 ? 10 : 5;
  const parts = 100 / unit;
  for (let tries = 0; tries < 500; tries++) {
    const cuts = new Set<number>();
    while (cuts.size < n - 1) cuts.add(rng.int(1, parts - 1));
    const edges = [0, ...[...cuts].sort((a, b) => a - b), parts];
    const shares = edges.slice(1).map((edge, i) => (edge - edges[i]!) * unit);
    const sorted = [...shares].sort((a, b) => a - b);
    if (sorted[0]! < sorted[1]! && sorted[n - 1]! > sorted[n - 2]!) return shares;
  }
  throw new Error("percentShares: could not make shares");
}

export const pieCharts = defineTemplate({
  id: "rel.pie-chart",
  description:
    "Pie charts: identify one, its slices, the biggest and smallest slice, percentages, fractions and amounts; dividing a circle to show data.",
  covers: (o) => scoped(o, { topic: REL, strand, text: /pie charts?|divide a circle/i }),
  generate: ({ objective: o, difficulty: d, rng, q, local }) => {
    const grade = o.grade;
    const t = o.text.toLowerCase();
    const pool = CATEGORY_SETS.filter((s) => s.local === local && s.id !== "animals");
    const set = rng.pick(pool.length > 0 ? pool : CATEGORY_SETS);

    if (/divide a circle/.test(t)) return divideCircle(rng, q, set);

    const n = rng.int(3, Math.min(5, set.categories.length));
    const labels = rng.sample(set.categories, n).map(cap);
    // Grade 4 meets pie charts without numbers on them; later grades read percentages, Grade 7 also degrees
    const valueLabel: "none" | "percent" | "degrees" =
      grade <= 4 ? "none" : grade === 7 ? rng.pick(["percent", "degrees"] as const) : "percent";
    const shares = percentShares(rng, n, d);
    const picture: StemData = {
      kind: "pie-chart",
      title: set.title,
      slices: labels.map((label, i) => ({
        label,
        value: valueLabel === "degrees" ? (shares[i]! * 360) / 100 : shares[i]!,
      })),
      valueLabel,
    };
    const common = {
      type: "DATA_INTERPRETATION" as const,
      stemData: picture,
      usesLocalContext: set.local,
    };
    const rows = labels.map((label, i) => ({ label, value: shares[i]! }));
    const { greatest, least } = extremes(rows);
    const modes: Array<
      "identify" | "count" | "biggest" | "smallest" | "percent" | "amount" | "fraction"
    > = ["identify", "count", "biggest"];
    if (d >= 2) modes.push("smallest");
    if (valueLabel !== "none") modes.push("percent", "percent");
    if (valueLabel !== "none" && d >= 3) modes.push("amount", "fraction");
    const mode = rng.pick(modes);

    if (mode === "identify") return identifyPie(q, picture, set.local);
    if (mode === "count")
      return q.numeric({
        ...common,
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: "Look at the pie chart. How many slices (sections) does it have?",
        answer: String(n),
        wrongs: [
          { answer: String(n + 1) },
          { answer: String(n - 1) },
          { answer: "100", tag: "GRAPH_READING_ERROR" },
        ].filter((w) => Number(w.answer) !== n && Number(w.answer) > 0),
        explanation: `The circle is divided into ${n} slices, one for each of ${labels.join(", ")}.`,
        hints: ["Each slice is one section of the circle.", "Count the slices one at a time."],
      });
    if (mode === "biggest" || mode === "smallest") {
      const target = mode === "biggest" ? greatest : least;
      return q.mcq({
        ...common,
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Look at the pie chart. Which slice is the ${mode === "biggest" ? "biggest" : "smallest"}?`,
        correct: target.label,
        wrongs: otherLabels(rows, target.label),
        explanation: `The slice for ${target.label} takes up the ${mode === "biggest" ? "most" : "least"} of the circle.`,
        hints: [
          "A bigger share of the circle means a bigger slice.",
          "Compare the sizes of the slices.",
        ],
      });
    }
    const pick = rng.pick(rows);
    if (mode === "percent") {
      const degreesOf = (pick.value * 360) / 100;
      return q.numeric({
        ...common,
        skill: valueLabel === "degrees" ? "APPLICATION" : "KNOWLEDGE_COMPREHENSION",
        stem:
          valueLabel === "degrees"
            ? `Look at the pie chart. The slices are marked in degrees. What percentage of the whole circle is the slice for ${pick.label.toLowerCase()}?`
            : `Look at the pie chart. What percentage does the slice for ${pick.label.toLowerCase()} show?`,
        answer: String(pick.value),
        wrongs:
          valueLabel === "degrees"
            ? [
                { answer: String(degreesOf), tag: "GRAPH_READING_ERROR" },
                { answer: String(Math.round((degreesOf / 180) * 100)), tag: "ANGLE_SUM_ERROR" },
              ].filter((w) => Number(w.answer) !== pick.value)
            : rows
                .filter((r) => r.label !== pick.label)
                .map((r) => ({ answer: String(r.value), tag: "GRAPH_READING_ERROR" })),
        explanation:
          valueLabel === "degrees"
            ? `The whole circle is 360°. ${degreesOf}° is ${degreesOf}/360 = ${pick.value}% of the circle.`
            : `The label on the ${pick.label.toLowerCase()} slice says ${pick.value}%.`,
        hints:
          valueLabel === "degrees"
            ? [
                "The whole circle is 360°, which is 100%.",
                "Write the slice's angle as a fraction of 360° and change it to a percentage.",
              ]
            : [
                "Find the slice for the answer you want.",
                "Read the percentage printed on that slice.",
              ],
      });
    }
    if (mode === "amount") {
      const total = rng.pick([40, 60, 80, 100, 120, 200, 400]);
      const amount = (pick.value * total) / 100;
      const person = pickName(rng);
      return q.numeric({
        ...common,
        skill: "PROBLEM_SOLVING",
        stem: `The pie chart shows how ${person} spends $${total}. How many dollars does ${person} spend on ${pick.label.toLowerCase()}?`,
        answer: String(amount),
        wrongs: [
          { answer: String(pick.value), tag: "PERCENT_CONVERSION_ERROR" },
          { answer: String(total - amount) },
          { answer: String(amount + 10) },
        ].filter((w) => Number(w.answer) > 0 && Number(w.answer) !== amount),
        explanation: `${pick.label} is ${pick.value}% of $${total}: ${pick.value}/100 × ${total} = $${amount}.`,
        hints: [
          "Read the percentage for the slice.",
          `Find that percentage of $${total}: share $${total} into 100 parts, or use a fraction.`,
        ],
      });
    }
    // the slice as a fraction of the whole circle
    const g = gcd(pick.value, 100);
    return q.fraction({
      ...common,
      type: "VISUAL_DIAGRAM",
      skill: "APPLICATION",
      stem: `Look at the pie chart. What fraction of the whole circle is the slice for ${pick.label.toLowerCase()}? Give your answer in its simplest form.`,
      value: `${pick.value / g}/${100 / g}`,
      lowestTerms: true,
      answerHint: "Write a fraction, like 1/4",
      wrongs: [
        { answer: `${pick.value}/${pick.value + 100}`, tag: "PART_WHOLE_CONFUSION" },
        { answer: `100/${pick.value}`, tag: "FRACTION_NOTATION_CONFUSION" },
      ],
      explanation: `${pick.value}% = ${pick.value}/100 = ${pick.value / g}/${100 / g}.`,
      hints: [
        "A percentage is a number out of 100.",
        "Write the percentage over 100, then make the fraction simpler.",
      ],
    });
  },
});

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function identifyPie(q: Builders, picture: StemData, local: boolean): GeneratedQuestion {
  return q.mcq({
    skill: "KNOWLEDGE_COMPREHENSION",
    type: "DATA_INTERPRETATION",
    stem: "What kind of graph is this?",
    stemData: picture,
    correct: "pie chart",
    wrongs: [{ answer: "bar graph" }, { answer: "line graph" }, { answer: "pictograph" }],
    explanation:
      "A pie chart is a circle that is divided into slices. Each slice shows a part of the whole.",
    hints: [
      "Look at the shape of the graph: is it a circle, or does it have bars or a line?",
      "A graph that divides a circle into slices has a special name.",
    ],
    usesLocalContext: local,
  });
}

/** Dividing a circle into equal sections, one for each person asked (no picture: the learner draws it). */
function divideCircle(rng: Rng, q: Builders, set: CategorySet): GeneratedQuestion {
  const total = rng.pick([4, 8, 10, 12]);
  const first = rng.int(1, total - 2);
  const second = rng.int(1, total - first - 1);
  const counts = rng.shuffle([first, second, total - first - second]);
  const parts = rng.sample(set.categories, 3);
  const target = rng.int(0, 2);
  const ask = rng.pick(["slices", "fraction"] as const);
  const person = pickName(rng);
  const info = parts.map((p, i) => `${counts[i]} chose ${p}`).join(", ");
  const intro = `${person} asked ${total} people about their favourite ${set.categoryLabel.toLowerCase()}: ${info}.`;
  if (ask === "slices")
    return q.numeric({
      skill: "APPLICATION",
      type: "WORD_PROBLEM",
      stem: `${intro} ${person} draws a circle and divides it into ${total} equal slices, one slice for each person. How many slices should be coloured for ${parts[target]}?`,
      answer: String(counts[target]),
      wrongs: [
        { answer: String(total), tag: "GRAPH_READING_ERROR" },
        { answer: String(counts[target]! + 1) },
        { answer: String(counts[(target + 1) % 3]), tag: "GRAPH_READING_ERROR" },
      ].filter((w) => Number(w.answer) !== counts[target] && Number(w.answer) > 0),
      explanation: `Each person gets one slice. ${counts[target]} people chose ${parts[target]}, so ${counts[target]} slices are coloured for ${parts[target]}.`,
      hints: [
        "The circle has one equal slice for each person who was asked.",
        `How many people chose ${parts[target]}? That is the number of slices for it.`,
      ],
      usesLocalContext: set.local,
    });
  const g = gcd(counts[target]!, total);
  return q.fraction({
    skill: "APPLICATION",
    type: "WORD_PROBLEM",
    stem: `${intro} ${person} draws a pie chart. What fraction of the circle should be coloured for ${parts[target]}? Give your answer in its simplest form.`,
    value: `${counts[target]! / g}/${total / g}`,
    lowestTerms: true,
    answerHint: "Write a fraction, like 1/4",
    wrongs: [
      { answer: `${counts[target]}/${counts[(target + 1) % 3]}`, tag: "PART_WHOLE_CONFUSION" },
      { answer: `${total}/${counts[target]}`, tag: "FRACTION_NOTATION_CONFUSION" },
    ],
    explanation: `${counts[target]} out of ${total} people chose ${parts[target]}, so ${counts[target]}/${total}${g > 1 ? ` = ${counts[target]! / g}/${total / g}` : ""} of the circle is coloured.`,
    hints: [
      "The whole circle stands for all the people who were asked.",
      "The fraction is the number who chose it over the number of all the people.",
    ],
    usesLocalContext: set.local,
  });
}

// ── jagged line graphs ──────────────────────────────────────────────────────────────────────────

export const lineGraphs = defineTemplate({
  id: "rel.line-graph",
  description:
    "Jagged line graphs: read values, find the highest and lowest points, differences and the biggest rise or fall.",
  covers: (o) => scoped(o, { topic: REL, strand, text: /jagged line graphs?/i }),
  generate: ({ objective: o, difficulty: d, rng, q, local }) => {
    const chart = seriesChart(rng, o.grade, d, pickSeries(rng, local), rng.int(5, 6));
    const picture: StemData = {
      kind: "line-graph",
      title: chart.title,
      xLabel: chart.categoryLabel,
      yLabel: chart.valueLabel,
      points: chart.rows.map((r) => ({ label: r.label, value: r.value })),
      max: chart.max,
      step: chart.step,
    };
    const common = {
      type: "DATA_INTERPRETATION" as const,
      stemData: picture,
      usesLocalContext: chart.local,
    };
    const rows = chart.rows;
    const { least, greatest } = extremes(rows);
    const changes = rows.slice(1).map((r, i) => ({
      from: rows[i]!.label,
      to: r.label,
      change: r.value - rows[i]!.value,
    }));
    const modes: Array<"read" | "highest" | "lowest" | "difference" | "rise" | "trend"> = [
      "read",
      "highest",
    ];
    if (d >= 2) modes.push("lowest", "trend");
    if (d >= 3) modes.push("difference", "rise");
    const mode = rng.pick(modes);

    if (mode === "read") {
      const index = rng.int(0, rows.length - 1);
      const row = rows[index]!;
      return q.numeric({
        ...common,
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Look at the line graph. What is the value for ${row.label}?`,
        answer: String(row.value),
        wrongs: readingWrongs(rows, index, chart.step),
        explanation: `At ${row.label} the point of the graph is at ${row.value} on the scale.`,
        hints: [
          `Find ${row.label} along the bottom of the graph and go up to the point.`,
          "Read across from the point to the scale. Check what each line on the scale is worth.",
        ],
      });
    }
    if (mode === "highest" || mode === "lowest") {
      const target = mode === "highest" ? greatest : least;
      return q.mcq({
        ...common,
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Look at the line graph. Which ${chart.categoryLabel.toLowerCase()} has the ${mode === "highest" ? "highest" : "lowest"} point?`,
        correct: target.label,
        wrongs: otherLabels(rows, target.label),
        explanation: `The ${mode === "highest" ? "highest" : "lowest"} point is at ${target.label}, with a value of ${target.value}.`,
        hints: [
          `Look for the ${mode === "highest" ? "highest" : "lowest"} point on the line.`,
          "Read the label under that point.",
        ],
      });
    }
    if (mode === "trend") {
      const pick = rng.int(0, changes.length - 1);
      const c = changes[pick]!;
      const word = c.change > 0 ? "went up" : "went down";
      return q.mcq({
        ...common,
        skill: "ANALYSIS",
        stem: `Look at the line graph. What happened to the value between ${c.from} and ${c.to}?`,
        correct: word,
        wrongs: [
          { answer: c.change > 0 ? "went down" : "went up", tag: "GRAPH_READING_ERROR" },
          { answer: "stayed the same", tag: "GRAPH_READING_ERROR" },
        ],
        explanation: `The line ${c.change > 0 ? "rises" : "falls"} from ${rows[pick]!.value} at ${c.from} to ${rows[pick + 1]!.value} at ${c.to}, so the value ${word}.`,
        hints: [
          `Find ${c.from} and ${c.to} on the graph.`,
          "If the line goes up from the first point to the second, the value went up.",
        ],
      });
    }
    if (mode === "difference") {
      const [a, b] = rng.sample(rows, 2);
      const bigger = a!.value > b!.value ? a! : b!;
      const smaller = bigger === a ? b! : a!;
      const diff = bigger.value - smaller.value;
      return q.numeric({
        ...common,
        skill: "APPLICATION",
        stem: `Look at the line graph. What is the difference between the value for ${bigger.label} and the value for ${smaller.label}?`,
        answer: String(diff),
        wrongs: [
          { answer: String(a!.value + b!.value), tag: "OPERATION_CHOICE_ERROR" },
          { answer: String(bigger.value), tag: "GRAPH_READING_ERROR" },
          { answer: String(smaller.value), tag: "GRAPH_READING_ERROR" },
        ].filter((w) => Number(w.answer) > 0 && Number(w.answer) !== diff),
        explanation: `${bigger.label}: ${bigger.value}. ${smaller.label}: ${smaller.value}. ${bigger.value} − ${smaller.value} = ${diff}.`,
        hints: [
          "Read the value at each of the two points.",
          "The difference is the bigger value take away the smaller value.",
        ],
      });
    }
    // the biggest rise between neighbouring points
    const rises = changes.map((c) => c.change);
    const best = Math.max(...rises);
    if (best > 0 && rises.filter((r) => r === best).length === 1) {
      const c = changes[rises.indexOf(best)]!;
      return q.mcq({
        ...common,
        skill: "ANALYSIS",
        stem: "Look at the line graph. Between which two neighbouring points did the value go up the most?",
        correct: `${c.from} to ${c.to}`,
        wrongs: changes
          .filter((x) => x !== c)
          .map((x) => ({ answer: `${x.from} to ${x.to}`, tag: "GRAPH_READING_ERROR" })),
        explanation: `The value rose by ${best} between ${c.from} and ${c.to}, which is more than between any other two neighbouring points.`,
        hints: [
          "For each pair of neighbouring points, see how much the line goes up.",
          "The steepest climb is the biggest rise.",
        ],
      });
    }
    const index = rng.int(0, rows.length - 1);
    const row = rows[index]!;
    return q.numeric({
      ...common,
      skill: "KNOWLEDGE_COMPREHENSION",
      stem: `Look at the line graph. What is the value for ${row.label}?`,
      answer: String(row.value),
      wrongs: readingWrongs(rows, index, chart.step),
      explanation: `At ${row.label} the point of the graph is at ${row.value} on the scale.`,
      hints: [
        `Find ${row.label} along the bottom of the graph and go up to the point.`,
        "Read across from the point to the scale.",
      ],
    });
  },
});

// ── problems on measures using graphs ───────────────────────────────────────────────────────────

export const graphProblems = defineTemplate({
  id: "rel.graph-problems",
  description:
    "Use graphs to solve problems on measures and in life situations: changing units after reading a graph, totals, and shares of an amount.",
  covers: (o) =>
    scoped(o, {
      topic: REL,
      strand,
      text: /solve problems on measures|use statistical graphs in life situations/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q, local }) => {
    const grade = o.grade;
    const modes: Array<"convert" | "total" | "pie-share" | "line-change"> = ["convert", "total"];
    if (grade >= 7) modes.push("pie-share", "line-change");
    const mode = rng.pick(modes);

    if (mode === "pie-share") {
      const person = pickName(rng);
      const total = rng.pick([60, 80, 100, 120, 200]);
      const items = rng.sample(["food", "books", "savings", "transport", "clothes"], 3);
      const shares = rng.pick([
        [50, 30, 20],
        [40, 40, 20],
        [50, 25, 25],
        [60, 30, 10],
      ]);
      const picture: StemData = {
        kind: "pie-chart",
        title: `How ${person} spends $${total} a month`,
        slices: items.map((label, i) => ({ label: cap(label), value: shares[i]! })),
        valueLabel: "percent",
      };
      const i = rng.int(0, 2);
      const amount = (shares[i]! * total) / 100;
      const j = (i + 1) % 3;
      const wantsSavings = rng.chance(0.4) && i !== j;
      if (wantsSavings) {
        const other = (shares[j]! * total) / 100;
        const together = amount + other;
        return q.numeric({
          skill: "PROBLEM_SOLVING",
          type: "DATA_INTERPRETATION",
          stem: `The pie chart shows how ${person} spends $${total} a month. How many dollars does ${person} spend on ${items[i]} and ${items[j]} together?`,
          stemData: picture,
          answer: String(together),
          wrongs: [
            { answer: String(amount), tag: "GRAPH_READING_ERROR" },
            { answer: String(shares[i]! + shares[j]!), tag: "PERCENT_CONVERSION_ERROR" },
            { answer: String(total - together) },
          ].filter((w) => Number(w.answer) > 0 && Number(w.answer) !== together),
          explanation: `${cap(items[i]!)}: ${shares[i]}% of $${total} = $${amount}. ${cap(items[j]!)}: ${shares[j]}% of $${total} = $${other}. Together: $${together}.`,
          hints: [
            "Find the amount for each slice: take the percentage of the total.",
            "Then add the two amounts.",
          ],
        });
      }
      return q.numeric({
        skill: "PROBLEM_SOLVING",
        type: "DATA_INTERPRETATION",
        stem: `The pie chart shows how ${person} spends $${total} a month. How many dollars does ${person} spend on ${items[i]}?`,
        stemData: picture,
        answer: String(amount),
        wrongs: [
          { answer: String(shares[i]), tag: "PERCENT_CONVERSION_ERROR" },
          { answer: String(total - amount) },
          { answer: String(amount * 2) },
        ].filter((w) => Number(w.answer) > 0 && Number(w.answer) !== amount),
        explanation: `${shares[i]}% of $${total} = ${shares[i]}/100 × ${total} = $${amount}.`,
        hints: [
          "Read the percentage for the slice.",
          "Find that percentage of the total amount of money.",
        ],
      });
    }

    // a conversion needs a series with units that can be changed (kg → g, mm → cm, litres → ml)
    const set = pickSeries(rng, local, (x) =>
      mode === "convert" ? x.convert !== undefined : x.additive !== false,
    );
    const chart = seriesChart(rng, grade, d, set, rng.int(4, 5));
    const picture = barPicture(chart, rng.pick(["vertical", "horizontal"] as const));
    const rows = chart.rows;
    if (mode === "line-change") {
      const growth = SERIES_SETS.find((s) => s.id === "growth")!;
      const gChart = seriesChart(rng, grade, d, growth, 6);
      const gRows = gChart.rows;
      const gPicture: StemData = {
        kind: "line-graph",
        title: growth.title,
        xLabel: growth.categoryLabel,
        yLabel: growth.valueLabel,
        points: gRows.map((r) => ({ label: r.label, value: r.value })),
        max: gChart.max,
        step: gChart.step,
      };
      const first = rng.int(0, 2);
      const last = rng.int(3, 5);
      const gained = gRows[last]!.value - gRows[first]!.value;
      return q.numeric({
        skill: "PROBLEM_SOLVING",
        type: "DATA_INTERPRETATION",
        stem: `The line graph shows the height of a maize plant each week. By how many centimetres did the plant grow between ${gRows[first]!.label} and ${gRows[last]!.label}?`,
        stemData: gPicture,
        answer: String(gained),
        wrongs: [
          { answer: String(gRows[last]!.value), tag: "GRAPH_READING_ERROR" },
          {
            answer: String(gRows[last]!.value + gRows[first]!.value),
            tag: "OPERATION_CHOICE_ERROR",
          },
          { answer: String(gained + gChart.step), tag: "GRAPH_READING_ERROR" },
        ].filter((w) => Number(w.answer) > 0 && Number(w.answer) !== gained),
        explanation: `${gRows[last]!.label}: ${gRows[last]!.value} cm. ${gRows[first]!.label}: ${gRows[first]!.value} cm. ${gRows[last]!.value} − ${gRows[first]!.value} = ${gained} cm.`,
        hints: [
          "Read the height at each of the two weeks.",
          "To find how much it grew, take the earlier height away from the later height.",
        ],
        usesLocalContext: true,
      });
    }
    if (mode === "convert" && chart.convert) {
      const index = rng.int(0, rows.length - 1);
      const row = rows[index]!;
      const { fromOne, fromMany, toOne, toMany, factor, direction } = chart.convert;
      const answer = direction === "multiply" ? row.value * factor : row.value / factor;
      const wrongList = [
        { answer: num(row.value), tag: "UNIT_CONVERSION_ERROR" },
        {
          answer: num(
            direction === "multiply" ? row.value * factor * 10 : row.value / (factor * 10),
          ),
          tag: "UNIT_CONVERSION_ERROR",
        },
        {
          answer: num(direction === "multiply" ? row.value / factor : row.value * factor),
          tag: "UNIT_CONVERSION_ERROR",
        },
        ...readingWrongs(rows, index, chart.step).map((w) => ({
          answer: num(Number(w.answer) * (direction === "multiply" ? factor : 1 / factor)),
          tag: "GRAPH_READING_ERROR",
        })),
      ].filter((w) => Number(w.answer) > 0 && w.answer !== num(answer));
      return q.numeric({
        skill: "PROBLEM_SOLVING",
        type: "DATA_INTERPRETATION",
        stem: `The graph shows ${chart.title.toLowerCase()}, measured in ${chart.unit}. What is the value for ${row.label} in ${toMany}?`,
        stemData: picture,
        answer: num(answer),
        wrongs: wrongList,
        explanation: `The graph shows ${row.value} ${chart.unit} for ${row.label}. ${
          direction === "multiply"
            ? `1 ${fromOne} = ${fmtInt(factor)} ${toMany}, so ${row.value} × ${fmtInt(factor)}`
            : `${fmtInt(factor)} ${fromMany} = 1 ${toOne}, so ${row.value} ÷ ${fmtInt(factor)}`
        } = ${fmtInt(Math.round(answer * 100) / 100)} ${toMany}.`,
        hints: [
          `First read the value for ${row.label} from the graph (it is in ${chart.unit}).`,
          direction === "multiply"
            ? `Changing to the smaller unit gives a bigger number: multiply by ${fmtInt(factor)}.`
            : `Changing to the bigger unit gives a smaller number: divide by ${fmtInt(factor)}.`,
        ],
        usesLocalContext: chart.local,
      });
    }
    // total over the period
    const total = rows.reduce((a, r) => a + r.value, 0);
    return q.numeric({
      skill: "PROBLEM_SOLVING",
      type: "DATA_INTERPRETATION",
      stem: `The graph shows ${chart.title.toLowerCase()}. Find the total for all the ${chart.categoryLabel.toLowerCase()}s shown. Give your answer in ${chart.unit}.`,
      stemData: picture,
      answer: String(total),
      wrongs: [
        { answer: String(total - rows[0]!.value), tag: "GRAPH_READING_ERROR" },
        { answer: String(total / chart.step), tag: "GRAPH_READING_ERROR" },
        { answer: String(Math.max(...rows.map((r) => r.value))), tag: "GRAPH_READING_ERROR" },
      ].filter((w) => Number(w.answer) > 0 && Number(w.answer) !== total),
      explanation: `Read every value and add: ${rows.map((r) => r.value).join(" + ")} = ${total} ${chart.unit}.`,
      hints: [
        "Read the value of every day, week or month on the graph.",
        "Then add all the values together.",
      ],
      usesLocalContext: chart.local,
    });
  },
});

export const dataTemplates = [
  collectData,
  tallyChart,
  tables,
  readyReckoner,
  barGraphs,
  pictographs,
  pieCharts,
  lineGraphs,
  graphProblems,
];
