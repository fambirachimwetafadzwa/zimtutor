import { pickName, ROUTES } from "../context";
import { byLevel, defineTemplate, fmtDecimal, scoped, type Builders, type Wrong } from "../kit";
import { trimmedDecimal } from "../maths";
import type { Rng } from "../rng";
import type { Difficulty, GeneratedQuestion } from "../types";

/**
 * Rate: the amount for ONE unit (Grades 4–5 "rate of two measures"), the kinds of rate and the
 * formulae S = D ÷ T, D = S × T, T = D ÷ S (Grade 6), and distance, speed and time in context (Grade 7).
 */

const MEA = "MEA" as const;
const strand = /^rate/;

/** A number as text: whole numbers plain, otherwise up to two decimals ("2.5"). */
const num = (n: number): string => trimmedDecimal(Math.round(n * 100), 2);

// ── one rate problem, in a context ───────────────────────────────────────────────────────────────

interface Frame {
  id: string;
  local: boolean;
  /** Range of the rate (the amount for one) and of the count (how many ones). */
  rate: [number, number];
  count: [number, number];
  /** The rate may be a half (2.5): the count is then even. */
  halves?: boolean;
  /** Units, when the answer is marked with a unit (speed). */
  units?: { rate: string; total: string; count: string };
  given: (total: number, count: number, name: string) => string;
  askRate: (name: string) => string;
  givenRate: (rate: number, name: string) => string;
  askTotal: (count: number, name: string) => string;
  askCount: (total: number, name: string) => string;
}

const BASIC_FRAMES: Frame[] = [
  {
    id: "bus",
    local: false,
    rate: [30, 90],
    count: [2, 6],
    units: { rate: "km/h", total: "km", count: "h" },
    given: (t, c) => `A bus travels ${t} km in ${c} hours at the same speed all the way.`,
    askRate: () => "How many kilometres does it travel in 1 hour?",
    givenRate: (r) => `A bus travels ${r} km in every hour.`,
    askTotal: (c) => `How far does it travel in ${c} hours?`,
    askCount: (t) => `How many hours does it take to travel ${t} km?`,
  },
  {
    id: "tap",
    local: false,
    rate: [3, 15],
    count: [3, 12],
    given: (t, c) => `A tap fills ${t} litres of water in ${c} minutes.`,
    askRate: () => "How many litres does it fill in 1 minute?",
    givenRate: (r) => `A tap fills ${r} litres of water every minute.`,
    askTotal: (c) => `How many litres does it fill in ${c} minutes?`,
    askCount: (t) => `How many minutes does it take to fill ${t} litres?`,
  },
  {
    id: "reading",
    local: false,
    rate: [4, 20],
    count: [3, 9],
    given: (t, c, n) =>
      `${n} reads ${t} pages of a story book in ${c} days, the same number each day.`,
    askRate: (n) => `How many pages does ${n} read in 1 day?`,
    givenRate: (r, n) => `${n} reads ${r} pages of a story book every day.`,
    askTotal: (c, n) => `How many pages does ${n} read in ${c} days?`,
    askCount: (t, n) => `How many days does ${n} need to read ${t} pages?`,
  },
  {
    id: "rice",
    local: false,
    rate: [2, 9],
    count: [2, 12],
    given: (t, c) => `${c} kg of rice cost $${t}.`,
    askRate: () => "How many dollars does 1 kg of rice cost?",
    givenRate: (r) => `Rice costs $${r} for every kilogram.`,
    askTotal: (c) => `How many dollars do ${c} kg of rice cost?`,
    askCount: (t) => `How many kilograms of rice can be bought for $${t}?`,
  },
  {
    id: "wage",
    local: false,
    rate: [2, 12],
    count: [3, 12],
    given: (t, c, n) => `${n} is paid $${t} for working ${c} hours.`,
    askRate: (n) => `How many dollars is ${n} paid for 1 hour?`,
    givenRate: (r, n) => `${n} is paid $${r} for every hour of work.`,
    askTotal: (c, n) => `How many dollars is ${n} paid for ${c} hours?`,
    askCount: (t, n) => `How many hours must ${n} work to earn $${t}?`,
  },
  {
    id: "walk",
    local: false,
    rate: [40, 80],
    count: [3, 10],
    given: (t, c, n) => `${n} walks ${t} metres in ${c} minutes at a steady pace.`,
    askRate: (n) => `How many metres does ${n} walk in 1 minute?`,
    givenRate: (r, n) => `${n} walks ${r} metres in every minute.`,
    askTotal: (c, n) => `How far does ${n} walk in ${c} minutes?`,
    askCount: (t, n) => `How many minutes does ${n} take to walk ${t} metres?`,
  },
  {
    id: "pump",
    local: true,
    rate: [4, 20],
    count: [3, 10],
    given: (t, c) => `A hand pump at the borehole fills ${t} buckets in ${c} minutes.`,
    askRate: () => "How many buckets does it fill in 1 minute?",
    givenRate: (r) => `A hand pump at the borehole fills ${r} buckets every minute.`,
    askTotal: (c) => `How many buckets does it fill in ${c} minutes?`,
    askCount: (t) => `How many minutes does it take to fill ${t} buckets?`,
  },
  {
    id: "maize",
    local: true,
    rate: [5, 20],
    count: [2, 9],
    given: (t, c) => `A farmer harvests ${t} bags of maize from ${c} hectares.`,
    askRate: () => "How many bags does the farmer harvest from 1 hectare?",
    givenRate: (r) => `A farmer harvests ${r} bags of maize from every hectare.`,
    askTotal: (c) => `How many bags does the farmer harvest from ${c} hectares?`,
    askCount: (t) => `How many hectares does the farmer need to harvest ${t} bags?`,
  },
  {
    id: "eggs",
    local: true,
    rate: [2, 6],
    count: [3, 12],
    given: (t, c) => `${c} hens lay ${t} eggs in one day. Every hen lays the same number of eggs.`,
    askRate: () => "How many eggs does 1 hen lay in one day?",
    givenRate: (r) => `Every hen on the farm lays ${r} eggs in one day.`,
    askTotal: (c) => `How many eggs do ${c} hens lay in one day?`,
    askCount: (t) => `How many hens lay ${t} eggs in one day?`,
  },
];

/** Richer kinds of rate for Grades 6–7: speed, fuel use, pay, flow, price and output. */
const TYPE_FRAMES: Frame[] = [
  {
    id: "speed",
    local: false,
    rate: [40, 110],
    count: [2, 8],
    units: { rate: "km/h", total: "km", count: "h" },
    given: (t, c) => `A car travels ${t} km in ${c} hours. Its speed does not change.`,
    askRate: () => "What is its speed in kilometres per hour (km/h)?",
    givenRate: (r) => `A car travels at a steady speed of ${r} km/h.`,
    askTotal: (c) => `How far does it travel in ${c} hours?`,
    askCount: (t) => `How many hours does it take to travel ${t} km?`,
  },
  {
    id: "fuel",
    local: false,
    rate: [8, 18],
    count: [4, 40],
    given: (t, c) => `A car uses ${c} litres of petrol to travel ${t} km.`,
    askRate: () => "How many kilometres does it travel on 1 litre of petrol?",
    givenRate: (r) => `A car travels ${r} km on every litre of petrol.`,
    askTotal: (c) => `How far can it travel on ${c} litres of petrol?`,
    askCount: (t) => `How many litres of petrol does it need to travel ${t} km?`,
  },
  {
    id: "pay",
    local: false,
    rate: [8, 30],
    count: [3, 20],
    given: (t, c, n) => `${n} earns $${t} in ${c} days. The pay is the same each day.`,
    askRate: (n) => `How many dollars does ${n} earn in 1 day?`,
    givenRate: (r, n) => `${n} earns $${r} every day.`,
    askTotal: (c, n) => `How many dollars does ${n} earn in ${c} days?`,
    askCount: (t, n) => `How many days must ${n} work to earn $${t}?`,
  },
  {
    id: "flow",
    local: false,
    rate: [10, 80],
    count: [3, 30],
    given: (t, c) => `A pipe fills a tank with ${t} litres of water in ${c} minutes.`,
    askRate: () => "How many litres of water flow into the tank each minute?",
    givenRate: (r) => `A pipe fills a tank at a rate of ${r} litres every minute.`,
    askTotal: (c) => `How many litres flow into the tank in ${c} minutes?`,
    askCount: (t) => `How many minutes does the pipe take to put ${t} litres into the tank?`,
  },
  {
    id: "typing",
    local: false,
    rate: [15, 60],
    count: [2, 10],
    given: (t, c, n) => `${n} types ${t} words in ${c} minutes at a steady pace.`,
    askRate: (n) => `How many words does ${n} type in 1 minute?`,
    givenRate: (r, n) => `${n} types ${r} words every minute.`,
    askTotal: (c, n) => `How many words does ${n} type in ${c} minutes?`,
    askCount: (t, n) => `How many minutes does ${n} need to type ${t} words?`,
  },
  {
    id: "price",
    local: false,
    rate: [2, 9],
    count: [4, 16],
    halves: true,
    given: (t, c) => `${c} kg of tomatoes cost $${t}.`,
    askRate: () => "How many dollars does 1 kg of tomatoes cost?",
    givenRate: (r) => `Tomatoes cost $${num(r)} for every kilogram.`,
    askTotal: (c) => `How many dollars do ${c} kg of tomatoes cost?`,
    askCount: (t) => `How many kilograms of tomatoes can be bought for $${t}?`,
  },
  {
    id: "bakery",
    local: true,
    rate: [20, 120],
    count: [2, 8],
    given: (t, c) => `A bakery makes ${t} loaves of bread in ${c} hours.`,
    askRate: () => "How many loaves does the bakery make in 1 hour?",
    givenRate: (r) => `A bakery makes ${r} loaves of bread every hour.`,
    askTotal: (c) => `How many loaves does the bakery make in ${c} hours?`,
    askCount: (t) => `How many hours does the bakery need to make ${t} loaves?`,
  },
  {
    id: "maize-milling",
    local: true,
    rate: [12, 60],
    count: [3, 10],
    given: (t, c) => `A grinding mill grinds ${t} kg of maize in ${c} hours.`,
    askRate: () => "How many kilograms of maize does the mill grind in 1 hour?",
    givenRate: (r) => `A grinding mill grinds ${r} kg of maize every hour.`,
    askTotal: (c) => `How many kilograms of maize does the mill grind in ${c} hours?`,
    askCount: (t) => `How many hours does the mill need to grind ${t} kg of maize?`,
  },
];

type RateMode = "rate" | "total" | "count";

function rateProblem(
  rng: Rng,
  q: Builders,
  frame: Frame,
  d: Difficulty,
  mode: RateMode,
  local: boolean,
): GeneratedQuestion {
  const name = pickName(rng);
  const scale = byLevel(d, [0.3, 0.5, 0.7, 0.9, 1]);
  const upTo = (range: [number, number]) =>
    Math.max(range[0], Math.round(range[0] + (range[1] - range[0]) * scale));
  const half = frame.halves === true && d >= 4;
  let rate = rng.int(frame.rate[0], upTo(frame.rate));
  let count = rng.int(frame.count[0], upTo(frame.count));
  if (half) {
    rate += 0.5;
    if (count % 2 === 1) count += 1;
  }
  if (rate === count) count += 1;
  const total = rate * count;
  const common = { skill: "APPLICATION" as const, usesLocalContext: frame.local && local };
  const stemOf = (parts: string[]) => parts.join(" ");

  const answerFor = (
    value: number,
    unit: string | undefined,
    wrongs: Array<{ value: number; tag?: string }>,
    base: {
      stem: string;
      explanation: string;
      hints: string[];
    },
  ): GeneratedQuestion => {
    const wrongList: Wrong[] = wrongs
      .filter((w) => w.value > 0 && Math.abs(w.value - value) > 1e-9)
      .map((w) => ({ answer: num(w.value), ...(w.tag ? { tag: w.tag } : {}) }));
    if (unit)
      return q.unit({
        ...common,
        ...base,
        type: "WORD_PROBLEM",
        value: num(value),
        unit,
        unitOptional: true,
        strictUnit: false,
        answerText: `${fmtDecimal(num(value))} ${unit}`,
        wrongs: wrongList,
      });
    return q.numeric({
      ...common,
      ...base,
      type: "WORD_PROBLEM",
      answer: num(value),
      wrongs: wrongList,
    });
  };

  const ONE =
    "A rate tells how much there is for ONE unit: for one hour, one minute, one kilogram …";
  if (mode === "rate") {
    return answerFor(
      rate,
      frame.units?.rate,
      [
        { value: total },
        { value: count },
        { value: total - count, tag: "OPERATION_CHOICE_ERROR" },
        { value: total + count, tag: "OPERATION_CHOICE_ERROR" },
        { value: total * count, tag: "OPERATION_CHOICE_ERROR" },
        { value: rate + 1 },
      ],
      {
        stem: stemOf([frame.given(total, count, name), frame.askRate(name)]),
        explanation: `Rate = total ÷ number = ${num(total)} ÷ ${count} = ${num(rate)}.`,
        hints: [
          ONE,
          "To find the amount for one, share the total equally: use division.",
          `Divide ${num(total)} by ${count}.`,
        ],
      },
    );
  }
  if (mode === "total") {
    return answerFor(
      total,
      frame.units?.total,
      [
        { value: rate },
        { value: count },
        { value: rate + count, tag: "OPERATION_CHOICE_ERROR" },
        { value: total + rate },
        { value: total - rate },
      ],
      {
        stem: stemOf([frame.givenRate(rate, name), frame.askTotal(count, name)]),
        explanation: `Total = rate × number = ${num(rate)} × ${count} = ${num(total)}.`,
        hints: [
          ONE,
          "For many ones, repeat the amount for one that many times: use multiplication.",
          `Multiply ${num(rate)} by ${count}.`,
        ],
      },
    );
  }
  return answerFor(
    count,
    frame.units?.count,
    [
      { value: rate },
      { value: total },
      { value: total - rate, tag: "OPERATION_CHOICE_ERROR" },
      { value: total * rate, tag: "OPERATION_CHOICE_ERROR" },
      { value: count + 1 },
    ],
    {
      stem: stemOf([frame.givenRate(rate, name), frame.askCount(total, name)]),
      explanation: `Number = total ÷ rate = ${num(total)} ÷ ${num(rate)} = ${count}.`,
      hints: [
        ONE,
        "Find how many times the amount for one fits into the total: use division.",
        `Divide ${num(total)} by ${num(rate)}.`,
      ],
    },
  );
}

const pickFrame = (rng: Rng, frames: Frame[], local: boolean): Frame => {
  const wanted = frames.filter((f) => f.local === local);
  return rng.pick(wanted.length > 0 ? wanted : frames);
};

export const rateBasic = defineTemplate({
  id: "mea.rate-basic",
  description: "Relate two quantities as a rate: the amount for one, the total, and how many.",
  covers: (o) => scoped(o, { topic: MEA, strand, text: /relate two (?:measures|quantities)/i }),
  generate: ({ objective: o, difficulty: d, rng, q, local }) => {
    const modes: RateMode[] = d <= 2 ? ["rate", "total"] : ["rate", "total", "count"];
    const mode = rng.pick(modes);
    if (o.grade >= 5 && d >= 3 && rng.chance(0.35)) return bestBuy(rng, q);
    return rateProblem(rng, q, pickFrame(rng, BASIC_FRAMES, local), d, mode, local);
  },
});

/** Two offers for the same goods: which one costs less for one? */
function bestBuy(rng: Rng, q: Builders): GeneratedQuestion {
  const goods = rng.pick([
    { thing: "sugar", unit: "kg" },
    { thing: "rice", unit: "kg" },
    { thing: "cooking oil", unit: "litres" },
    { thing: "flour", unit: "kg" },
  ]);
  const rateA = rng.int(2, 8);
  let rateB = rng.int(2, 8);
  if (rateB === rateA) rateB = rateA + 1;
  const countA = rng.int(2, 6);
  const countB = rng.int(2, 6) + (rng.chance(0.5) ? 0 : 1);
  const totalA = rateA * countA;
  const totalB = rateB * countB;
  const cheaper = rateA < rateB ? "Shop A" : "Shop B";
  return q.mcq({
    skill: "ANALYSIS",
    stem: `Shop A sells ${countA} ${goods.unit} of ${goods.thing} for $${totalA}. Shop B sells ${countB} ${goods.unit} of ${goods.thing} for $${totalB}. Which shop sells ${goods.thing} for less money per ${goods.unit === "kg" ? "kilogram" : "litre"}?`,
    correct: cheaper,
    wrongs: [
      { answer: cheaper === "Shop A" ? "Shop B" : "Shop A" },
      { answer: "They cost the same" },
    ],
    explanation: `Shop A: $${totalA} ÷ ${countA} = $${rateA} for 1 ${goods.unit === "kg" ? "kg" : "litre"}. Shop B: $${totalB} ÷ ${countB} = $${rateB} for 1 ${goods.unit === "kg" ? "kg" : "litre"}. ${cheaper} costs less for one.`,
    hints: [
      "Compare the price of ONE kilogram (or one litre) in each shop, not the total prices.",
      "Share each total by the amount bought to find the price for one.",
    ],
  });
}

// ── identifying rates ───────────────────────────────────────────────────────────────────────────

interface Pick {
  stem: string;
  correct: string;
  wrongs: string[];
  explanation: string;
  hints: string[];
}

const RATE_PICKS: Pick[] = [
  {
    stem: "Which of these measurements is a rate?",
    correct: "60 kilometres per hour",
    wrongs: ["60 kilometres", "60 minutes", "60 kilograms"],
    explanation:
      "A rate compares two different quantities (here distance and time): 60 kilometres for every 1 hour.",
    hints: [
      "A rate has two parts joined by the word per, or by the sign / .",
      "Look for the choice that compares two different kinds of measure.",
    ],
  },
  {
    stem: "Which of these measurements is a rate?",
    correct: "5 litres per minute",
    wrongs: ["5 litres", "5 minutes", "5 metres"],
    explanation: "5 litres per minute compares an amount of water with a time: it is a rate.",
    hints: [
      "A rate has two parts joined by the word per.",
      "A single measurement like 5 litres is not a rate: it does not compare two quantities.",
    ],
  },
  {
    stem: "Which unit measures speed?",
    correct: "km/h",
    wrongs: ["km", "kg", "litres"],
    explanation:
      "Speed compares distance with time, so it is measured in kilometres per hour (km/h).",
    hints: [
      "Speed tells how far something goes in one unit of time.",
      "Look for the unit that has a distance and a time in it.",
    ],
  },
  {
    stem: "Which unit could measure the rate at which a tap fills a bucket?",
    correct: "litres per minute",
    wrongs: ["litres", "minutes", "kilograms per litre"],
    explanation:
      "The tap's rate compares the water (litres) with the time (minutes): litres per minute.",
    hints: [
      "Think about what is being compared when a tap fills a bucket.",
      "A rate needs two different quantities: an amount and a time.",
    ],
  },
  {
    stem: "A pay rate of $4 per hour means …",
    correct: "the worker earns $4 for each hour of work",
    wrongs: [
      "the worker works for 4 hours",
      "the worker earns $4 in total",
      "the worker earns $1 for each 4 hours",
    ],
    explanation: "$4 per hour means $4 for every 1 hour worked.",
    hints: ["The word per means for each, or for every.", "Read it as: $4 for each one hour."],
  },
  {
    stem: "A rate always compares …",
    correct: "two different quantities, like distance and time",
    wrongs: [
      "two lengths measured in the same unit",
      "two numbers that are always equal",
      "a number with itself",
    ],
    explanation:
      "A rate compares two different kinds of quantity, such as distance and time or money and mass.",
    hints: [
      "Think about the rates you know: speed, price per kilogram, pay per hour.",
      "In each of them, two different quantities are compared.",
    ],
  },
  {
    stem: "Which of these is NOT a rate?",
    correct: "12 kilograms",
    wrongs: ["12 kilometres per hour", "12 dollars per kilogram", "12 words per minute"],
    explanation: "12 kilograms is just a mass. The others compare two different quantities.",
    hints: [
      "A rate has two parts joined by per.",
      "Look for the choice that has only one measure in it.",
    ],
  },
];

export const rateIdentify = defineTemplate({
  id: "mea.rate-identify",
  description: "Identify measurements that are rates and match rates to what they measure.",
  covers: (o) => scoped(o, { topic: MEA, strand, text: /identify measurements of rate/i }),
  generate: ({ difficulty: d, rng, q }) => {
    if (d >= 3 && rng.chance(0.3)) {
      const pairs: Record<string, string> = {
        "kilometres per hour": "speed of a vehicle",
        "litres per minute": "how fast a tap fills",
        "dollars per hour": "how much a worker is paid",
        "kilometres per litre": "how far a car goes on fuel",
      };
      return q.matching({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: "Match each rate to what it measures.",
        pairs,
        explanation:
          "Each rate compares two quantities: distance and time (speed), water and time (flow), money and time (pay), distance and fuel (fuel use).",
        hints: [
          "Look at the two quantities in each rate: what is being compared?",
          "Start with the one you are surest about.",
        ],
      });
    }
    const pick = rng.pick(RATE_PICKS);
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

export const rateTypes = defineTemplate({
  id: "mea.rate-types",
  description: "Calculate different types of rate: speed, fuel use, pay, flow, price and output.",
  covers: (o) => scoped(o, { topic: MEA, strand, text: /different types of rate|calculate rate/i }),
  generate: ({ difficulty: d, rng, q, local }) => {
    const mode = rng.pick<RateMode>(
      d <= 2 ? ["rate", "rate", "total"] : ["rate", "total", "count"],
    );
    return rateProblem(rng, q, pickFrame(rng, TYPE_FRAMES, local), d, mode, local);
  },
});

// ── distance, speed and time ────────────────────────────────────────────────────────────────────

interface Vehicle {
  name: string;
  speeds: number[];
  verb: string;
  /** The longest journey that is believable at these speeds, in hours. */
  maxHours: number;
}

const VEHICLES: Vehicle[] = [
  { name: "bus", speeds: [50, 60, 70, 80, 90, 100], verb: "travels", maxHours: 6 },
  { name: "car", speeds: [60, 70, 80, 90, 100, 110], verb: "travels", maxHours: 6 },
  { name: "kombi", speeds: [50, 60, 70, 80, 90], verb: "travels", maxHours: 6 },
  { name: "truck", speeds: [40, 50, 60, 70, 80], verb: "travels", maxHours: 6 },
  { name: "train", speeds: [60, 70, 80, 90, 100], verb: "travels", maxHours: 8 },
  { name: "cyclist", speeds: [10, 12, 15, 16, 18, 20, 24], verb: "rides", maxHours: 4 },
  { name: "runner", speeds: [8, 10, 12, 14], verb: "runs", maxHours: 2 },
];
const BUS = VEHICLES[0]!;

/** Routes with a speed that gives a whole or half hour: [route, speed, hours]. */
const ROUTE_TRIPS = ROUTES.flatMap((route) =>
  [40, 45, 50, 55, 60, 65, 70, 75, 80, 90, 100, 110]
    .map((speed) => ({ route, speed, hours: route.km / speed }))
    .filter((t) => Number.isInteger(t.hours * 2) && t.hours >= 1.5 && t.hours <= 8),
);

const hoursText = (hours: number): string =>
  Number.isInteger(hours)
    ? `${hours} ${hours === 1 ? "hour" : "hours"}`
    : `${Math.floor(hours)} hours 30 minutes`;

const FORMULA_SETS: Record<
  "speed" | "distance" | "time",
  { right: string; wrong: string[]; hints: string[]; explanation: string }
> = {
  speed: {
    right: "speed = distance ÷ time",
    wrong: ["speed = distance × time", "speed = time ÷ distance", "speed = distance + time"],
    explanation:
      "Speed is the distance covered in ONE unit of time, so we share the distance by the time: speed = distance ÷ time.",
    hints: [
      "Speed tells how far something goes in ONE hour (or one second).",
      "To find the amount for one, share the total equally: which operation is that?",
    ],
  },
  distance: {
    right: "distance = speed × time",
    wrong: ["distance = speed ÷ time", "distance = time ÷ speed", "distance = speed + time"],
    explanation:
      "Speed is the distance in ONE hour. In several hours the distance is repeated that many times: distance = speed × time.",
    hints: [
      "The speed is the distance covered in one hour.",
      "To cover several hours, repeat that distance for each hour: which operation is that?",
    ],
  },
  time: {
    right: "time = distance ÷ speed",
    wrong: ["time = distance × speed", "time = speed ÷ distance", "time = distance − speed"],
    explanation:
      "Time is the number of hours: how many times the speed (distance in one hour) fits into the distance: time = distance ÷ speed.",
    hints: [
      "Count how many hours are needed: how many times does the distance for one hour fit into the whole distance?",
      "Finding how many times one amount fits into another is division.",
    ],
  },
};

export const speedDistanceTime = defineTemplate({
  id: "mea.speed-distance-time",
  description:
    "Distance, speed and time: S = D ÷ T, D = S × T, T = D ÷ S, with whole and half hours, minutes and routes.",
  covers: (o) =>
    scoped(o, {
      topic: MEA,
      strand,
      text: /distance, speed and time|different types of rate|use of the formula/i,
      not: /apply rate/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q, local }) => {
    const grade = o.grade;
    const relate = /relate/i.test(o.text);
    if (relate && d <= 3 && rng.chance(0.6)) return formulaQuestion(rng, q);
    if (relate && d >= 4 && rng.chance(0.3)) return proportionQuestion(rng, q);

    const find = rng.pick(["speed", "distance", "time"] as const);
    const trip =
      local && find !== "distance" && d >= 3 && ROUTE_TRIPS.length > 0
        ? rng.pick(ROUTE_TRIPS)
        : null;
    const vehicle = trip ? BUS : rng.pick(VEHICLES);
    const speed = trip ? trip.speed : rng.pick(vehicle.speeds);
    // half hours appear in Grade 7 (and on routes); Grade 6 keeps whole hours
    const useHalf = !trip && grade >= 7 && d >= 4 && speed % 2 === 0 && rng.chance(0.5);
    const longest = Math.max(2, Math.min(byLevel(d, [3, 4, 5, 6, 8]), vehicle.maxHours));
    const hours = trip ? trip.hours : rng.int(2, longest) + (useHalf ? 0.5 : 0);
    const distance = trip ? trip.route.km : speed * hours;
    const place = trip ? ` from ${trip.route.from} to ${trip.route.to} (${distance} km)` : "";
    const time = hoursText(hours);
    const halfNote = !Number.isInteger(hours)
      ? " Give your answer in hours as a decimal (for example 2.5)."
      : "";
    const commonUnit = { unitOptional: true, strictUnit: false } as const;
    const common = {
      skill: "APPLICATION" as const,
      type: "WORD_PROBLEM" as const,
      usesLocalContext: trip !== null,
    };
    const tidy = (wrongs: Array<{ value: number; tag?: string }>, correct: number): Wrong[] =>
      wrongs
        .filter(
          (w) => Number.isFinite(w.value) && w.value > 0 && Math.abs(w.value - correct) > 1e-9,
        )
        .map((w) => ({ answer: num(w.value), ...(w.tag ? { tag: w.tag } : {}) }));

    if (find === "speed") {
      const wholeHoursOnly = Math.floor(hours);
      return q.unit({
        ...common,
        ...commonUnit,
        stem: `A ${vehicle.name} ${vehicle.verb}${place || ` ${distance} km`} in ${time}. What is the average speed of the ${vehicle.name} in kilometres per hour?`,
        value: num(speed),
        unit: "km/h",
        answerText: `${num(speed)} km/h`,
        wrongs: tidy(
          [
            { value: distance * hours, tag: "RATE_FORMULA_ERROR" },
            { value: distance + hours, tag: "RATE_FORMULA_ERROR" },
            { value: hours / distance, tag: "RATE_FORMULA_ERROR" },
            ...(Number.isInteger(hours)
              ? []
              : [
                  { value: distance / wholeHoursOnly, tag: "TIME_CONVERSION_ERROR" },
                  { value: distance / (wholeHoursOnly + 0.3), tag: "TIME_CONVERSION_ERROR" },
                ]),
          ],
          speed,
        ),
        explanation: `Speed = distance ÷ time = ${distance} ÷ ${num(hours)} = ${num(speed)} km/h.`,
        hints: [
          "Speed tells how far something goes in ONE hour.",
          "To find the distance for one hour, share the distance equally between the hours.",
          Number.isInteger(hours)
            ? `Divide ${distance} by ${hours}.`
            : "First write the time in hours: 30 minutes is half an hour. Then divide the distance by the time.",
        ],
      });
    }
    if (find === "distance") {
      return q.unit({
        ...common,
        ...commonUnit,
        stem: `A ${vehicle.name} ${vehicle.verb} at an average speed of ${speed} km/h for ${time}. How far does it go?`,
        value: num(distance),
        unit: "km",
        answerText: `${num(distance)} km`,
        wrongs: tidy(
          [
            { value: speed / hours, tag: "RATE_FORMULA_ERROR" },
            { value: speed + hours, tag: "RATE_FORMULA_ERROR" },
            { value: hours / speed, tag: "RATE_FORMULA_ERROR" },
            ...(Number.isInteger(hours)
              ? []
              : [{ value: speed * Math.floor(hours), tag: "TIME_CONVERSION_ERROR" }]),
          ],
          distance,
        ),
        explanation: `Distance = speed × time = ${speed} × ${num(hours)} = ${num(distance)} km.`,
        hints: [
          "The speed tells how far the vehicle goes in ONE hour.",
          "For several hours, repeat that distance once for each hour.",
          Number.isInteger(hours)
            ? `Multiply ${speed} by ${hours}.`
            : "30 minutes is half an hour, so the time is a whole number of hours and a half. Multiply the speed by the time in hours.",
        ],
      });
    }
    return q.unit({
      ...common,
      ...commonUnit,
      stem: `A ${vehicle.name} ${vehicle.verb}${place || ` ${distance} km`} at an average speed of ${speed} km/h. How many hours does the journey take?${halfNote}`,
      value: num(hours),
      unit: "h",
      answerText: `${num(hours)} hours`,
      wrongs: tidy(
        [
          { value: distance * speed, tag: "RATE_FORMULA_ERROR" },
          { value: speed / distance, tag: "RATE_FORMULA_ERROR" },
          { value: distance - speed, tag: "RATE_FORMULA_ERROR" },
          { value: distance + speed, tag: "RATE_FORMULA_ERROR" },
        ],
        hours,
      ),
      explanation: `Time = distance ÷ speed = ${distance} ÷ ${speed} = ${num(hours)} hours.`,
      hints: [
        "The speed tells how far the vehicle goes in ONE hour.",
        "Count how many hours are needed: how many times does the distance for one hour fit into the whole distance?",
        `Divide ${distance} by ${speed}.`,
      ],
    });
  },
});

function formulaQuestion(rng: Rng, q: Builders): GeneratedQuestion {
  const find = rng.pick(["speed", "distance", "time"] as const);
  const set = FORMULA_SETS[find];
  return q.mcq({
    skill: "KNOWLEDGE_COMPREHENSION",
    stem: `Which formula can be used to find the ${find} of a moving object?`,
    correct: set.right,
    wrongs: set.wrong.map((answer) => ({ answer, tag: "RATE_FORMULA_ERROR" })),
    keepEqualValues: true,
    explanation: set.explanation,
    hints: set.hints,
  });
}

function proportionQuestion(rng: Rng, q: Builders): GeneratedQuestion {
  const factor = rng.pick([2, 3]);
  const same = rng.pick(["speed", "time"] as const);
  const changed = same === "speed" ? "time" : "speed";
  const word = factor === 2 ? "twice" : "three times";
  const stem =
    same === "speed"
      ? `A cyclist rides at a steady speed. If the cyclist rides for ${word} as long, the distance covered is …`
      : `A car travels for 2 hours. If the car's speed is ${word} as fast, the distance covered in the same 2 hours is …`;
  return q.mcq({
    skill: "ANALYSIS",
    stem,
    correct: `${word} as far`,
    wrongs: [
      { answer: `${factor === 2 ? "half" : "a third"} as far`, tag: "RATE_FORMULA_ERROR" },
      { answer: "the same distance", tag: "RATE_FORMULA_ERROR" },
      { answer: `${factor} km further`, tag: "RATE_FORMULA_ERROR" },
    ],
    explanation: `Distance = speed × time. When the ${changed} is multiplied by ${factor} and the ${same} stays the same, the distance is also multiplied by ${factor}: ${word} as far.`,
    hints: [
      "Distance is found by multiplying the speed by the time.",
      `If one of the two numbers is multiplied by ${factor} and the other stays the same, what happens to the product?`,
    ],
  });
}

// ── applying rate ───────────────────────────────────────────────────────────────────────────────

const clockText = (hour: number, minute: number): string =>
  `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

export const rateApply = defineTemplate({
  id: "mea.rate-apply",
  description:
    "Apply rate: journey times and speed, two-stage journeys, comparing speeds, changing units of time, fuel.",
  covers: (o) => scoped(o, { topic: MEA, strand, text: /apply rate/i }),
  generate: ({ difficulty: d, rng, q, local }) => {
    const modes: Array<"journey" | "stages" | "compare" | "per-hour" | "fuel" | "average"> = [
      "journey",
      "compare",
      "fuel",
    ];
    if (d >= 2) modes.push("stages", "per-hour");
    if (d >= 4) modes.push("average");
    const mode = rng.pick(modes);
    const name = pickName(rng);

    if (mode === "journey" && ROUTE_TRIPS.length > 0) {
      const trip = rng.pick(ROUTE_TRIPS);
      const depHour = rng.int(5, 12);
      const depMinute = rng.pick([0, 15, 30, 45]);
      const startMinutes = depHour * 60 + depMinute;
      const endMinutes = startMinutes + trip.hours * 60;
      const arrive = clockText(Math.floor(endMinutes / 60) % 24, endMinutes % 60);
      return q.unit({
        skill: "PROBLEM_SOLVING",
        type: "WORD_PROBLEM",
        stem: `A bus leaves ${trip.route.from} at ${clockText(depHour, depMinute)} and arrives in ${trip.route.to} at ${arrive}. The distance is ${trip.route.km} km. What is the average speed of the bus in kilometres per hour?`,
        value: num(trip.speed),
        unit: "km/h",
        unitOptional: true,
        strictUnit: false,
        answerText: `${num(trip.speed)} km/h`,
        wrongs: [
          {
            answer: num(trip.route.km / (endMinutes - startMinutes)),
            tag: "TIME_CONVERSION_ERROR",
          },
          { answer: num(trip.route.km * trip.hours), tag: "RATE_FORMULA_ERROR" },
          // 3 h 30 min read as 3.30 hours
          {
            answer: num(trip.route.km / (Math.floor(trip.hours) + (trip.hours % 1 ? 0.3 : 0))),
            tag: "TIME_CONVERSION_ERROR",
          },
        ].filter((w) => Number(w.answer) > 0 && Number(w.answer) !== trip.speed),
        explanation: `The journey takes from ${clockText(depHour, depMinute)} to ${arrive}: ${num(trip.hours)} hours. Speed = distance ÷ time = ${trip.route.km} ÷ ${num(trip.hours)} = ${num(trip.speed)} km/h.`,
        hints: [
          "First work out how long the journey takes, in hours.",
          "Then use speed = distance ÷ time.",
        ],
        usesLocalContext: true,
      });
    }
    if (mode === "stages") {
      const s1 = rng.pick([12, 15, 16, 18, 20]);
      const s2 = rng.pick([8, 10, 12, 14]);
      const t1 = rng.int(2, 4);
      const t2 = rng.int(1, 3);
      const total = s1 * t1 + s2 * t2;
      return q.unit({
        skill: "PROBLEM_SOLVING",
        type: "WORD_PROBLEM",
        stem: `${name} cycles at ${s1} km/h for ${t1} hours and then at ${s2} km/h for ${t2} ${t2 === 1 ? "hour" : "hours"}. How far does ${name} cycle altogether?`,
        value: String(total),
        unit: "km",
        unitOptional: true,
        strictUnit: false,
        answerText: `${total} km`,
        wrongs: [
          { answer: String(s1 * t1) },
          { answer: String(s2 * t2) },
          { answer: String((s1 + s2) * (t1 + t2)), tag: "RATE_FORMULA_ERROR" },
          { answer: String(s1 + s2 + t1 + t2), tag: "RATE_FORMULA_ERROR" },
        ],
        explanation: `First part: ${s1} × ${t1} = ${s1 * t1} km. Second part: ${s2} × ${t2} = ${s2 * t2} km. Altogether: ${s1 * t1} + ${s2 * t2} = ${total} km.`,
        hints: [
          "Work out the distance for each part of the journey separately.",
          "Distance = speed × time for each part, then add the two distances.",
        ],
      });
    }
    if (mode === "compare") {
      const speedA = rng.pick([40, 50, 60, 75, 80]);
      const hoursA = rng.int(2, 5);
      let speedB = rng.pick([45, 55, 60, 70, 90]);
      if (speedB === speedA) speedB += 5;
      let hoursB = rng.int(2, 5);
      if (hoursB === hoursA) hoursB = hoursA === 5 ? 4 : hoursA + 1;
      const kmA = speedA * hoursA;
      const kmB = speedB * hoursB;
      const faster = speedA > speedB ? "the car" : "the bus";
      return q.mcq({
        skill: "ANALYSIS",
        stem: `A car travels ${kmA} km in ${hoursA} hours. A bus travels ${kmB} km in ${hoursB} hours. Which vehicle has the greater average speed?`,
        correct: faster === "the car" ? "the car" : "the bus",
        wrongs: [
          { answer: faster === "the car" ? "the bus" : "the car", tag: "RATE_FORMULA_ERROR" },
          { answer: "they have the same speed" },
        ],
        explanation: `Car: ${kmA} ÷ ${hoursA} = ${speedA} km/h. Bus: ${kmB} ÷ ${hoursB} = ${speedB} km/h. ${faster === "the car" ? "The car" : "The bus"} is faster.`,
        hints: [
          "Do not compare the distances: compare how far each goes in ONE hour.",
          "Find each speed by sharing the distance by the time.",
        ],
      });
    }
    if (mode === "per-hour") {
      const perMinute = rng.int(3, 15);
      const minutes = rng.pick([2, 3, 4, 5, 6]);
      const made = perMinute * minutes;
      const perHour = perMinute * 60;
      return q.numeric({
        skill: "PROBLEM_SOLVING",
        type: "WORD_PROBLEM",
        stem: `A machine packs ${made} packets in ${minutes} minutes. At the same rate, how many packets does it pack in 1 hour?`,
        answer: String(perHour),
        wrongs: [
          { answer: String(perMinute), tag: "TIME_CONVERSION_ERROR" },
          { answer: String(perMinute * 100), tag: "TIME_CONVERSION_ERROR" },
          { answer: String(made * 60), tag: "TIME_CONVERSION_ERROR" },
          { answer: String(made) },
        ],
        explanation: `In 1 minute the machine packs ${made} ÷ ${minutes} = ${perMinute} packets. There are 60 minutes in an hour: ${perMinute} × 60 = ${perHour} packets.`,
        hints: [
          "First find how many packets the machine packs in ONE minute.",
          "There are 60 minutes in 1 hour (not 100).",
        ],
      });
    }
    if (mode === "average") {
      const combos: Array<{ s1: number; s2: number; t2: number }> = [];
      for (const s1 of [60, 80, 90])
        for (const s2 of [30, 40, 45])
          for (const t2 of [1, 3])
            if ((s1 * 2 + s2 * t2) % (2 + t2) === 0) combos.push({ s1, s2, t2 });
      const { s1, s2, t2 } = rng.pick(combos);
      const t1 = 2;
      const total = s1 * t1 + s2 * t2;
      const time = t1 + t2;
      const average = total / time;
      return q.unit({
        skill: "PROBLEM_SOLVING",
        type: "WORD_PROBLEM",
        stem: `A driver travels at ${s1} km/h for ${t1} hours and then at ${s2} km/h for ${t2} ${t2 === 1 ? "hour" : "hours"}. What is the average speed for the whole journey?`,
        value: String(average),
        unit: "km/h",
        unitOptional: true,
        strictUnit: false,
        answerText: `${average} km/h`,
        wrongs: [
          { answer: num((s1 + s2) / 2), tag: "RATE_FORMULA_ERROR" },
          { answer: String(total), tag: "RATE_FORMULA_ERROR" },
          { answer: String(s1 * t1) },
        ].filter((w) => Number(w.answer) !== average),
        explanation: `Total distance = ${s1} × ${t1} + ${s2} × ${t2} = ${total} km. Total time = ${time} hours. Average speed = ${total} ÷ ${time} = ${average} km/h.`,
        hints: [
          "Find the total distance and the total time for the whole journey.",
          "Average speed = total distance ÷ total time. It is not the average of the two speeds.",
        ],
      });
    }
    // fuel
    const kmPerLitre = rng.pick([8, 10, 12, 14, 15, 16]);
    const litres = rng.int(3, 9) * (kmPerLitre % 2 === 0 ? 5 : 4);
    const distance = kmPerLitre * litres;
    const ask = rng.pick(["litres", "distance"] as const);
    return q.numeric({
      skill: "PROBLEM_SOLVING",
      type: "WORD_PROBLEM",
      stem:
        ask === "litres"
          ? `A ${local ? "kombi" : "car"} travels ${kmPerLitre} km on every litre of fuel. How many litres of fuel does it need for a journey of ${distance} km?`
          : `A ${local ? "kombi" : "car"} travels ${kmPerLitre} km on every litre of fuel. How far can it travel on ${litres} litres?`,
      answer: String(ask === "litres" ? litres : distance),
      wrongs:
        ask === "litres"
          ? [
              { answer: String(distance * kmPerLitre), tag: "OPERATION_CHOICE_ERROR" },
              { answer: String(distance - kmPerLitre), tag: "OPERATION_CHOICE_ERROR" },
              { answer: String(kmPerLitre) },
            ]
          : [
              { answer: String(Math.round(litres / kmPerLitre)), tag: "OPERATION_CHOICE_ERROR" },
              { answer: String(litres + kmPerLitre), tag: "OPERATION_CHOICE_ERROR" },
              { answer: String(kmPerLitre) },
            ],
      explanation:
        ask === "litres"
          ? `Litres needed = distance ÷ distance for one litre = ${distance} ÷ ${kmPerLitre} = ${litres}.`
          : `Distance = ${kmPerLitre} km per litre × ${litres} litres = ${distance} km.`,
      hints:
        ask === "litres"
          ? [
              "The rate tells how far the vehicle goes on ONE litre.",
              "Find how many times that distance fits into the whole journey: use division.",
            ]
          : [
              "The rate tells how far the vehicle goes on ONE litre.",
              "For several litres, repeat that distance once for each litre: use multiplication.",
            ],
      usesLocalContext: local,
    });
  },
});

export const rateTemplates = [rateBasic, rateIdentify, rateTypes, speedDistanceTime, rateApply];
