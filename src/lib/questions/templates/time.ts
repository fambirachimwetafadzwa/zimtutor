import { numberToWords, ordinalNumeral } from "../../marking/words";
import { byLevel, defineTemplate, scoped, type Wrong } from "../kit";
import type { Rng } from "../rng";
import type { Difficulty } from "../types";

/**
 * Time: reading the clock, days, months and seasons, units and estimates, conversions, 12- and
 * 24-hour notation, time taken, and adding and subtracting times. Clock readings follow the grade:
 * hour, half hour and quarter hour (G3), five minutes (G4), any minute (G5 to G7).
 */

const MEA = "MEA" as const;
const pad = (n: number): string => String(n).padStart(2, "0");

// ── reading the clock ───────────────────────────────────────────────────────────────────────────

/** The ways a learner may write a clock time (digital and in words). All are normalised by the marker. */
export function timeAnswers(h: number, m: number): string[] {
  const nextHour = (h % 12) + 1;
  const hw = numberToWords(h);
  const nw = numberToWords(nextHour);
  const out = new Set<string>([`${h}:${pad(m)}`, `${pad(h)}:${pad(m)}`, `${h}.${pad(m)}`]);
  if (m === 0) {
    for (const v of [`${h} o'clock`, `${h} oclock`, `${hw} o'clock`, `${hw} oclock`]) out.add(v);
  } else if (m === 30) {
    for (const v of [
      `half past ${h}`,
      `half past ${hw}`,
      `30 minutes past ${h}`,
      `thirty minutes past ${hw}`,
    ])
      out.add(v);
  } else if (m === 15) {
    for (const v of [
      `quarter past ${h}`,
      `quarter past ${hw}`,
      `15 minutes past ${h}`,
      `fifteen minutes past ${hw}`,
    ])
      out.add(v);
  } else if (m === 45) {
    for (const v of [
      `quarter to ${nextHour}`,
      `quarter to ${nw}`,
      `15 minutes to ${nextHour}`,
      `fifteen minutes to ${nw}`,
    ])
      out.add(v);
  } else if (m % 5 === 0 && m < 30) {
    for (const v of [
      `${m} past ${h}`,
      `${m} minutes past ${h}`,
      `${numberToWords(m)} past ${hw}`,
      `${numberToWords(m)} minutes past ${hw}`,
    ])
      out.add(v);
  } else if (m % 5 === 0) {
    const to = 60 - m;
    for (const v of [
      `${to} to ${nextHour}`,
      `${to} minutes to ${nextHour}`,
      `${numberToWords(to)} to ${nw}`,
      `${numberToWords(to)} minutes to ${nw}`,
    ])
      out.add(v);
  }
  return [...out];
}

function clockMinutes(rng: Rng, grade: number, difficulty: Difficulty): number {
  if (grade === 3) return rng.pick([0, 15, 30, 45]);
  if (grade === 4 || difficulty <= 3) return rng.int(0, 11) * 5;
  return rng.int(0, 59);
}

export const clockReading = defineTemplate({
  id: "mea.clock-read",
  description: "Read the time from an analogue clock.",
  covers: (o) =>
    scoped(o, {
      topic: MEA,
      strand: /^time$/,
      text: /^(?:tell time|tell time to)/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const h = rng.int(1, 12);
    const m = clockMinutes(rng, o.grade, d);
    const text = `${h}:${pad(m)}`;
    const stemData = { kind: "clock" as const, hour: h, minute: m };
    const nextHour = (h % 12) + 1;
    const useChoices = (o.grade === 3 && d <= 2) || (o.grade === 4 && d <= 2) || d === 1;
    const hints = [
      "Look at the short hand first. It shows the hour: which number has it just passed (or reached)?",
      "Now look at the long hand. Each number on the clock face is 5 minutes: count in fives.",
      m === 0
        ? "When the long hand points straight up at 12, it is exactly on the hour."
        : m === 30
          ? "When the long hand points straight down at 6, it is half past the hour."
          : "Say the hour first, then the minutes.",
    ];
    const explanation = `The short hand is ${m > 0 && m < 60 ? "just past" : "on"} ${h}, and the long hand shows ${m} minutes. The time is ${text}.`;
    if (useChoices) {
      const wrongs: Wrong[] = [];
      const swapped =
        m % 5 === 0 && m / 5 >= 1 ? `${m / 5}:${pad(h * 5 === 60 ? 0 : h * 5)}` : null;
      if (swapped && swapped !== text) wrongs.push({ answer: swapped, tag: "CLOCK_READING_ERROR" });
      if (m > 30) wrongs.push({ answer: `${nextHour}:${pad(m)}`, tag: "CLOCK_READING_ERROR" });
      if (m >= 5)
        wrongs.push({ answer: `${h}:${pad(Math.floor(m / 5))}`, tag: "CLOCK_READING_ERROR" });
      wrongs.push({ answer: `${h}:${pad((m + 30) % 60)}` });
      wrongs.push({ answer: `${(h % 12) + 1}:${pad(m)}` });
      return q.mcq({
        skill: "KNOWLEDGE_COMPREHENSION",
        type: "VISUAL_DIAGRAM",
        stem: "What time does the clock show?",
        stemData,
        correct: text,
        wrongs,
        explanation,
        hints,
      });
    }
    const wrongs: Wrong[] = [];
    if (m >= 5)
      wrongs.push({ answer: `${h}:${pad(Math.floor(m / 5))}`, tag: "CLOCK_READING_ERROR" });
    if (m > 30) wrongs.push({ answer: `${nextHour}:${pad(m)}`, tag: "CLOCK_READING_ERROR" });
    return q.text({
      skill: "KNOWLEDGE_COMPREHENSION",
      type: "VISUAL_DIAGRAM",
      stem: "What time does the clock show?",
      stemData,
      accepted: timeAnswers(h, m),
      answerHint:
        o.grade <= 4
          ? "Write the time with a colon between the hour and the minutes, or in words."
          : "Write the time with a colon between the hour and the minutes.",
      wrongs,
      explanation,
      hints,
    });
  },
});

// ── days, months, seasons, units and estimates ──────────────────────────────────────────────────

const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;
const MONTHS = [
  ["January", 31],
  ["February", 28],
  ["March", 31],
  ["April", 30],
  ["May", 31],
  ["June", 30],
  ["July", 31],
  ["August", 31],
  ["September", 30],
  ["October", 31],
  ["November", 30],
  ["December", 31],
] as const;
const SEASONS = ["summer", "autumn", "winter", "spring"] as const;

interface Item {
  stem: string;
  correct: string;
  wrongs: string[];
  /** Accepted typed answers (default: the correct answer). */
  typed?: string[];
  explanation: string;
  hints: string[];
}

const wrap = <T>(list: readonly T[], i: number): T =>
  list[((i % list.length) + list.length) % list.length]!;

function calendarItems(rng: Rng, kinds: Array<"days" | "months" | "seasons">): Item[] {
  const items: Item[] = [];
  if (kinds.includes("days")) {
    const i = rng.int(0, 6);
    const day = DAYS[i]!;
    const others = DAYS.filter((x) => x !== wrap(DAYS, i + 1));
    items.push({
      stem: `Which day comes after ${day}?`,
      correct: wrap(DAYS, i + 1),
      wrongs: rng.sample(others, 3),
      explanation: `The days of the week in order are Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday. After ${day} comes ${wrap(DAYS, i + 1)}.`,
      hints: [
        "Say the days of the week in order, starting from Monday.",
        `Find ${day} in the list, then go to the next day.`,
      ],
    });
    const j = rng.int(0, 6);
    items.push({
      stem: `Which day comes before ${DAYS[j]}?`,
      correct: wrap(DAYS, j - 1),
      wrongs: rng.sample(
        DAYS.filter((x) => x !== wrap(DAYS, j - 1)),
        3,
      ),
      explanation: `The day before ${DAYS[j]} is ${wrap(DAYS, j - 1)}.`,
      hints: [
        "Say the days of the week in order, starting from Monday.",
        `Find ${DAYS[j]} and go back one day.`,
      ],
    });
    items.push({
      stem: "How many days are there in one week?",
      correct: "7",
      wrongs: ["5", "6", "10"],
      typed: ["7", "seven"],
      explanation: "There are 7 days in a week: Monday to Sunday.",
      hints: ["Count the days from Monday to Sunday."],
    });
  }
  if (kinds.includes("months")) {
    const i = rng.int(0, 11);
    items.push({
      stem: `Which month comes after ${MONTHS[i]![0]}?`,
      correct: wrap(MONTHS, i + 1)[0],
      wrongs: rng.sample(
        MONTHS.filter((m) => m[0] !== wrap(MONTHS, i + 1)[0]).map((m) => m[0]),
        3,
      ),
      explanation: `The months in order are January, February, March, April, May, June, July, August, September, October, November, December. After ${MONTHS[i]![0]} comes ${wrap(MONTHS, i + 1)[0]}.`,
      hints: [
        "Say the months of the year in order, starting from January.",
        `Find ${MONTHS[i]![0]}, then go to the next month.`,
      ],
    });
    const k = rng.int(1, 11);
    items.push({
      stem: `Which month comes just before ${MONTHS[k]![0]}?`,
      correct: MONTHS[k - 1]![0],
      wrongs: rng.sample(
        MONTHS.filter((m) => m[0] !== MONTHS[k - 1]![0]).map((m) => m[0]),
        3,
      ),
      explanation: `The month before ${MONTHS[k]![0]} is ${MONTHS[k - 1]![0]}.`,
      hints: [
        "Say the months in order, starting from January.",
        `Find ${MONTHS[k]![0]} and go back one month.`,
      ],
    });
    const n = rng.int(1, 12);
    items.push({
      stem: `Which is the ${ordinalNumeral(n)} month of the year?`,
      correct: MONTHS[n - 1]![0],
      wrongs: rng.sample(
        MONTHS.filter((m) => m[0] !== MONTHS[n - 1]![0]).map((m) => m[0]),
        3,
      ),
      explanation: `Counting from January, the ${ordinalNumeral(n)} month is ${MONTHS[n - 1]![0]}.`,
      hints: ["Count the months from January as 1, 2, 3 …"],
    });
    items.push({
      stem: "How many months are there in one year?",
      correct: "12",
      wrongs: ["10", "11", "13"],
      typed: ["12", "twelve"],
      explanation: "There are 12 months in a year.",
      hints: ["Say the months from January to December and count them."],
    });
    const thirty = MONTHS.filter((m) => m[1] === 30).map((m) => m[0]);
    items.push({
      stem: "Which of these months has 30 days?",
      correct: rng.pick(thirty),
      wrongs: rng.sample(
        MONTHS.filter((m) => m[1] === 31).map((m) => m[0]),
        3,
      ),
      explanation:
        "April, June, September and November have 30 days. January, March, May, July, August, October and December have 31.",
      hints: [
        "Use the knuckle rhyme or the poem: thirty days has September, April, June and November.",
      ],
    });
  }
  if (kinds.includes("seasons")) {
    const i = rng.int(0, 3);
    const season = SEASONS[i]!;
    items.push({
      stem: `The seasons of the year in order are summer, autumn, winter and spring. Which season comes after ${season}?`,
      correct: wrap(SEASONS, i + 1),
      wrongs: SEASONS.filter((s) => s !== wrap(SEASONS, i + 1)),
      typed: [wrap(SEASONS, i + 1)],
      explanation: `The seasons repeat in this order: summer, autumn, winter, spring. After ${season} comes ${wrap(SEASONS, i + 1)}.`,
      hints: [
        "The seasons go round in a circle: after the last one in the list, the first one comes again.",
        `Find ${season} and go to the next one.`,
      ],
    });
    const j = rng.int(0, 3);
    items.push({
      stem: `The seasons of the year in order are summer, autumn, winter and spring. Which season comes before ${SEASONS[j]}?`,
      correct: wrap(SEASONS, j - 1),
      wrongs: SEASONS.filter((s) => s !== wrap(SEASONS, j - 1)),
      typed: [wrap(SEASONS, j - 1)],
      explanation: `The season before ${SEASONS[j]} is ${wrap(SEASONS, j - 1)}.`,
      hints: [
        "The seasons go round in a circle: after the last one in the list, the first one comes again.",
        `Find ${SEASONS[j]} and go back one.`,
      ],
    });
    items.push({
      stem: "How many seasons are there in one year?",
      correct: "4",
      wrongs: ["2", "3", "6"],
      typed: ["4", "four"],
      explanation: "There are 4 seasons: summer, autumn, winter and spring.",
      hints: ["Name the seasons and count them."],
    });
  }
  return items;
}

const UNIT_ITEMS: Item[] = [
  {
    stem: "Which unit of time is best for measuring how long you take to walk to school?",
    correct: "minutes",
    wrongs: ["seconds", "days", "years"],
    explanation:
      "A walk to school takes some minutes: seconds are too small and days or years are far too big.",
    hints: [
      "Think about how long the walk takes: a very short time, a few minutes, or many hours?",
    ],
  },
  {
    stem: "Which unit of time is best for measuring how old a person is?",
    correct: "years",
    wrongs: ["seconds", "minutes", "hours"],
    explanation: "A person's age is counted in years.",
    hints: ["Think about how long a person lives: the unit must be big."],
  },
  {
    stem: "Which unit of time is best for measuring one clap of the hands?",
    correct: "seconds",
    wrongs: ["minutes", "hours", "weeks"],
    explanation: "A clap is very quick, so the best unit is the second.",
    hints: ["Think about how quick a clap is: the unit must be small."],
  },
  {
    stem: "Which unit of time is best for measuring a school holiday?",
    correct: "weeks",
    wrongs: ["seconds", "minutes", "centuries"],
    explanation: "A school holiday lasts a few weeks.",
    hints: ["Think about how long a holiday lasts: not minutes, not centuries."],
  },
  {
    stem: "Which unit of time is best for measuring how long it takes to boil an egg?",
    correct: "minutes",
    wrongs: ["days", "months", "years"],
    explanation: "Boiling an egg takes a few minutes.",
    hints: ["Think about how long you wait at the stove."],
  },
  {
    stem: "How many seconds are there in one minute?",
    correct: "60",
    wrongs: ["100", "30", "24"],
    typed: ["60", "sixty"],
    explanation: "One minute is 60 seconds.",
    hints: ["Look at the second hand on a clock: it goes all the way round in one minute."],
  },
  {
    stem: "How many minutes are there in one hour?",
    correct: "60",
    wrongs: ["100", "30", "24"],
    typed: ["60", "sixty"],
    explanation: "One hour is 60 minutes.",
    hints: ["Look at the minute hand on a clock: it goes all the way round in one hour."],
  },
  {
    stem: "How many hours are there in one day?",
    correct: "24",
    wrongs: ["12", "60", "10"],
    typed: ["24", "twenty four"],
    explanation: "One day (a day and a night) is 24 hours.",
    hints: ["Count the hours in a day and a night together."],
  },
  {
    stem: "How many years are there in one decade?",
    correct: "10",
    wrongs: ["100", "12", "5"],
    typed: ["10", "ten"],
    explanation: "A decade is 10 years.",
    hints: ["The word decade comes from the Greek for ten."],
  },
];

const APPLIED_ITEMS = (rng: Rng): Item[] => {
  const times = rng.int(3, 9);
  return [
    {
      stem: "A fortnight is the same as how many days?",
      correct: "14",
      wrongs: ["7", "10", "30"],
      typed: ["14", "fourteen"],
      explanation: "A fortnight is two weeks: 2 × 7 = 14 days.",
      hints: ["A fortnight is a number of weeks. How many?"],
    },
    {
      stem: `Chipo's clinic visit happens every fortnight. How many visits are there in ${times * 2} weeks?`,
      correct: String(times),
      wrongs: [String(times * 2), String(times + 1), String(times * 4)],
      typed: [String(times)],
      explanation: `A fortnight is 2 weeks, so ${times * 2} weeks is ${times * 2} ÷ 2 = ${times} fortnights.`,
      hints: ["How many weeks are in a fortnight?", "Share the weeks into fortnights."],
    },
    {
      stem: `Tendai's football practice is weekly. How many practices are there in ${times} weeks?`,
      correct: String(times),
      wrongs: [String(times * 7), String(times + 1), String(times * 2)],
      typed: [String(times)],
      explanation: `Weekly means once every week, so there are ${times} practices in ${times} weeks.`,
      hints: ["Weekly means once a week."],
    },
    {
      stem: "School starts at 7:30 in the morning. Is that 7:30 am or 7:30 pm?",
      correct: "7:30 am",
      wrongs: ["7:30 pm", "Both are correct"],
      typed: ["am", "7:30 am"],
      explanation:
        "Morning times, from midnight up to noon, are am. 7:30 in the morning is 7:30 am.",
      hints: ["Does the day have just begun, or is it nearly night?"],
    },
    {
      stem: "Supper is at 6:30 in the evening. Is that 6:30 am or 6:30 pm?",
      correct: "6:30 pm",
      wrongs: ["6:30 am", "Both are correct"],
      typed: ["pm", "6:30 pm"],
      explanation: "Times from noon up to midnight are pm. 6:30 in the evening is 6:30 pm.",
      hints: ["Is it before noon or after noon?"],
    },
    {
      stem: "Which time is later in the day?",
      correct: "9:00 pm",
      wrongs: ["9:00 am", "They are the same time"],
      explanation: "pm times come after noon, am times before noon. 9:00 pm is later than 9:00 am.",
      hints: ["am means before noon. pm means after noon."],
    },
  ];
};

const ESTIMATE_ITEMS: Item[] = [
  {
    stem: "About how long does it take to brush your teeth?",
    correct: "2 minutes",
    wrongs: ["2 seconds", "2 hours", "2 days"],
    explanation: "Brushing teeth takes about 2 minutes.",
    hints: ["Think of how long you stand at the basin."],
  },
  {
    stem: "About how long does a school lesson last?",
    correct: "40 minutes",
    wrongs: ["40 seconds", "40 hours", "40 days"],
    explanation: "A school lesson lasts about 40 minutes.",
    hints: ["Think of how long you sit in one lesson before the bell."],
  },
  {
    stem: "About how long does a night's sleep last for a child?",
    correct: "9 hours",
    wrongs: ["9 seconds", "9 minutes", "9 days"],
    explanation: "Children sleep about 9 or 10 hours each night.",
    hints: ["Think of when you go to bed and when you wake up."],
  },
  {
    stem: "About how long does one clap of the hands take?",
    correct: "1 second",
    wrongs: ["1 minute", "1 hour", "1 day"],
    explanation: "A clap takes about a second.",
    hints: ["How long does it take to clap once?"],
  },
  {
    stem: "About how long is a school term?",
    correct: "13 weeks",
    wrongs: ["13 days", "13 hours", "13 years"],
    explanation: "A school term is about 3 months, or about 13 weeks.",
    hints: ["A school year has three terms. Think about how long each one is."],
  },
  {
    stem: "About how long does a maize crop take to grow from planting to harvest?",
    correct: "4 months",
    wrongs: ["4 days", "4 hours", "4 years"],
    explanation: "Maize takes about 4 months to grow and ripen.",
    hints: ["Think of the rainy season: planting in summer and harvest some months later."],
  },
  {
    stem: "About how long does it take to walk 1 kilometre?",
    correct: "12 minutes",
    wrongs: ["12 seconds", "12 hours", "12 days"],
    explanation: "Walking 1 km takes about 12 to 15 minutes.",
    hints: ["Think of a slow walk, not a run."],
  },
  {
    stem: "About how long does it take to eat a meal?",
    correct: "20 minutes",
    wrongs: ["20 seconds", "20 hours", "20 days"],
    explanation: "A meal usually takes about 20 minutes.",
    hints: ["Think of how long you sit at the table."],
  },
];

export const timeConcepts = defineTemplate({
  id: "mea.time-concepts",
  description:
    "Days, months, seasons, units of time, weekly and fortnightly, am and pm, and estimating time.",
  covers: (o) =>
    scoped(o, {
      topic: MEA,
      strand: /^time$/,
      text: /days of the week|seasons of the year|identify units of time|am, pm|estimate time/i,
      not: /estimate time from shadows/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const t = o.text.toLowerCase();
    let pool: Item[];
    if (/days of the week/.test(t)) pool = calendarItems(rng, ["days", "months", "seasons"]);
    else if (/seasons/.test(t)) pool = calendarItems(rng, ["seasons"]);
    else if (/identify units/.test(t)) pool = UNIT_ITEMS;
    else if (/am, pm/.test(t)) pool = APPLIED_ITEMS(rng);
    else pool = ESTIMATE_ITEMS;
    const item = rng.pick(pool);
    const typed = item.typed && (d >= 3 || /write seasons/.test(t));
    if (typed)
      return q.text({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: item.stem,
        accepted: item.typed!,
        answerHint: "Type your answer.",
        explanation: item.explanation,
        hints:
          item.hints.length >= 2
            ? item.hints
            : [...item.hints, "Take your time and think about it again."],
      });
    return q.mcq({
      skill: /estimate/.test(t) ? "APPLICATION" : "KNOWLEDGE_COMPREHENSION",
      stem: item.stem,
      correct: item.correct,
      wrongs: item.wrongs.map((answer) => ({ answer })),
      explanation: item.explanation,
      hints:
        item.hints.length >= 2
          ? item.hints
          : [
              ...item.hints,
              "Read each choice carefully and cross out the ones that cannot be right.",
            ],
    });
  },
});

// ── conversions ─────────────────────────────────────────────────────────────────────────────────

interface Conversion {
  from: string;
  to: string;
  /** Going to a smaller unit multiplies, going to a bigger unit divides. */
  op: "multiply" | "divide";
  /** How many of the smaller unit make one of the bigger unit. */
  per: number;
  /** Unit symbols known to the marker (omitted for months, years and decades). */
  toSymbol?: string;
  grades: readonly number[];
  note?: string;
}

const CONVERSIONS: Conversion[] = [
  { from: "hours", to: "days", op: "divide", per: 24, toSymbol: "day", grades: [3, 5, 6] },
  { from: "days", to: "hours", op: "multiply", per: 24, toSymbol: "h", grades: [3, 5, 6] },
  { from: "days", to: "weeks", op: "divide", per: 7, toSymbol: "week", grades: [3, 4, 5, 6] },
  { from: "weeks", to: "days", op: "multiply", per: 7, toSymbol: "day", grades: [3, 4, 5, 6] },
  { from: "minutes", to: "hours", op: "divide", per: 60, toSymbol: "h", grades: [4, 5, 6] },
  { from: "hours", to: "minutes", op: "multiply", per: 60, toSymbol: "min", grades: [4, 5, 6] },
  {
    from: "days",
    to: "fortnights",
    op: "divide",
    per: 14,
    toSymbol: "fortnight",
    grades: [4, 5, 6],
  },
  {
    from: "weeks",
    to: "months",
    op: "divide",
    per: 4,
    grades: [4],
    note: "Use 4 weeks = 1 month.",
  },
  { from: "seconds", to: "minutes", op: "divide", per: 60, toSymbol: "min", grades: [5, 6] },
  { from: "minutes", to: "seconds", op: "multiply", per: 60, toSymbol: "s", grades: [5, 6] },
  { from: "months", to: "years", op: "divide", per: 12, grades: [5, 6] },
  { from: "years", to: "months", op: "multiply", per: 12, grades: [5, 6] },
  { from: "years", to: "decades", op: "divide", per: 10, grades: [5, 6] },
];

const singular = (unit: string): string => unit.replace(/s$/, "");

export const timeConversion = defineTemplate({
  id: "mea.time-convert",
  description: "Change between hours, days, weeks, minutes, seconds, months and years.",
  covers: (o) =>
    scoped(o, {
      topic: MEA,
      strand: /^time$/,
      text: /^convert (?:hours|days|weeks|time|units of time)/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const exact = /^convert (hours|days|weeks) to (hours|days|weeks)$/i.exec(o.text.trim());
    const options = CONVERSIONS.filter((c) =>
      exact
        ? c.from === exact[1]!.toLowerCase() && c.to === exact[2]!.toLowerCase()
        : c.grades.includes(o.grade),
    );
    const c = rng.pick(options);
    const count = rng.int(2, byLevel(d, [4, 8, 12, 20, 30]));
    const fromValue = c.op === "multiply" ? count : count * c.per;
    const toValue = c.op === "multiply" ? count * c.per : count;
    const base = {
      skill: "APPLICATION" as const,
      solutionKind: "time-conversion",
      explanation:
        c.op === "multiply"
          ? `1 ${singular(c.from)} = ${c.per} ${c.to}, so ${fromValue} ${c.from} = ${fromValue} × ${c.per} = ${toValue} ${c.to}.`
          : `${c.per} ${c.from} = 1 ${singular(c.to)}, so ${fromValue} ${c.from} = ${fromValue} ÷ ${c.per} = ${toValue} ${c.to}.`,
      hints:
        c.op === "multiply"
          ? [
              `How many ${c.to} are in one ${singular(c.from)}?`,
              `You are changing to a smaller unit, so there will be MORE of them: multiply.`,
            ]
          : [
              `How many ${c.from} make one ${singular(c.to)}?`,
              `You are changing to a bigger unit, so there will be FEWER of them: divide.`,
            ],
    };
    const wrongs: Wrong[] = [
      {
        answer: String(c.op === "multiply" ? fromValue / c.per : fromValue * c.per),
        tag: "TIME_CONVERSION_ERROR",
      },
      ...(c.per === 60
        ? [
            {
              answer: String(c.op === "multiply" ? fromValue * 100 : fromValue / 100),
              tag: "TIME_CONVERSION_ERROR",
            },
          ]
        : []),
      { answer: String(toValue + c.per), tag: "BASIC_FACT_ERROR" },
      { answer: String(toValue * 10), tag: "TIME_CONVERSION_ERROR" },
    ].filter((w) => Number.isFinite(Number(w.answer)) && Number(w.answer) !== toValue);
    if (c.toSymbol)
      return q.unit({
        ...base,
        stem: `${fromValue} ${c.from} = ___ ${c.to}`,
        type: "FILL_IN_THE_BLANK",
        value: String(toValue),
        unit: c.toSymbol,
        unitOptional: true,
        strictUnit: true,
        answerText: `${toValue} ${c.to}`,
        wrongs,
      });
    return q.numeric({
      ...base,
      stem: `${fromValue} ${c.from} = ___ ${c.to}${c.note ? ` (${c.note})` : ""}`,
      type: "FILL_IN_THE_BLANK",
      answer: String(toValue),
      wrongs,
    });
  },
});

// ── 12-hour and 24-hour notation ────────────────────────────────────────────────────────────────

export const timeNotation = defineTemplate({
  id: "mea.time-notation",
  description: "Change times between the 12-hour clock (am, pm) and the 24-hour clock.",
  covers: (o) => scoped(o, { topic: MEA, strand: /^time$/, text: /12.?hour|24.?hour|12- and 24/i }),
  generate: ({ difficulty: d, rng, q }) => {
    const hour24 = rng.pick(
      d <= 2
        ? [13, 14, 15, 16, 17, 18, 19, 20, 21]
        : [0, 1, 6, 9, 11, 12, 13, 15, 17, 18, 20, 22, 23].filter((v) => v !== 12 || d >= 4),
    );
    const minute = d <= 2 ? rng.pick([0, 15, 30, 45]) : rng.int(0, 11) * 5;
    const suffix = hour24 >= 12 ? "pm" : "am";
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
    const twelve = `${hour12}:${pad(minute)} ${suffix}`;
    const twentyFour = `${pad(hour24)}:${pad(minute)}`;
    const toTwentyFour = rng.chance(0.5);
    if (toTwentyFour) {
      const accepted = [
        twentyFour,
        `${pad(hour24)}${pad(minute)}`,
        `${pad(hour24)}.${pad(minute)}`,
        `${pad(hour24)}:${pad(minute)} hrs`,
        `${pad(hour24)}${pad(minute)} hrs`,
        `${pad(hour24)}${pad(minute)}h`,
      ];
      return q.text({
        skill: "APPLICATION",
        stem: `Write ${twelve} in 24-hour time.`,
        accepted,
        answerHint: "Write the hours and minutes with a colon between them.",
        wrongs: [
          { answer: `${pad(hour12 + 10)}:${pad(minute)}`, tag: "TIME_CONVERSION_ERROR" },
          { answer: `${pad(hour12)}:${pad(minute)}`, tag: "TIME_CONVERSION_ERROR" },
        ].filter(
          (w) => !accepted.some((a) => a.replace(/\D/g, "") === w.answer.replace(/\D/g, "")),
        ),
        explanation:
          hour24 === 0
            ? `12:${pad(minute)} am is just after midnight, which is 00:${pad(minute)} in 24-hour time.`
            : hour24 === 12
              ? `12:${pad(minute)} pm is just after noon: 12:${pad(minute)} in 24-hour time.`
              : suffix === "pm"
                ? `For pm times add 12 to the hour: ${hour12} + 12 = ${hour24}. So ${twelve} is ${twentyFour}.`
                : `For am times the hour stays the same (written with two digits): ${twelve} is ${twentyFour}.`,
        hints: [
          "The 24-hour clock counts the hours from 00 to 23.",
          suffix === "pm"
            ? "For times after noon (pm), add 12 to the hour."
            : "For times before noon (am), the hour stays the same. Write it with two digits.",
          "Write the hours, a colon, and the minutes (two digits each).",
        ],
      });
    }
    const accepted = [
      `${hour12}:${pad(minute)} ${suffix}`,
      `${hour12}:${pad(minute)}${suffix}`,
      `${hour12}.${pad(minute)} ${suffix}`,
      `${hour12}.${pad(minute)}${suffix}`,
      `${pad(hour12)}:${pad(minute)} ${suffix}`,
      `${pad(hour12)}:${pad(minute)}${suffix}`,
    ];
    return q.text({
      skill: "APPLICATION",
      stem: `Write ${twentyFour} in 12-hour time, using am or pm.`,
      accepted,
      answerHint: "Write the time with a colon, followed by am or pm.",
      wrongs: [
        {
          answer: `${hour24 > 12 ? hour24 - 10 : hour24}:${pad(minute)} ${suffix}`,
          tag: "TIME_CONVERSION_ERROR",
        },
        { answer: `${hour12}:${pad(minute)} ${suffix === "pm" ? "am" : "pm"}` },
      ].filter(
        (w) =>
          !accepted.some(
            (a) =>
              a.replace(/[^a-z0-9]/gi, "").toLowerCase() ===
              w.answer.replace(/[^a-z0-9]/gi, "").toLowerCase(),
          ),
      ),
      explanation:
        hour24 === 0
          ? `00:${pad(minute)} is just after midnight: 12:${pad(minute)} am.`
          : hour24 === 12
            ? `12:${pad(minute)} is just after noon: 12:${pad(minute)} pm.`
            : hour24 > 12
              ? `For times after 12:00, subtract 12 from the hour: ${hour24} − 12 = ${hour12}. So ${twentyFour} is ${twelve}.`
              : `Before noon the hour stays the same and we write am: ${twelve}.`,
      hints: [
        "On the 12-hour clock the hours run from 1 to 12, followed by am or pm.",
        hour24 >= 13
          ? "For hours from 13 to 23, subtract 12 and write pm."
          : "For hours before 12, keep the hour and write am. Check 00 and 12 carefully.",
      ],
    });
  },
});

// ── time taken, and adding and subtracting times ────────────────────────────────────────────────

const minutesToParts = (minutes: number): [number, number] => [
  Math.floor(minutes / 60),
  minutes % 60,
];

export const timeTaken = defineTemplate({
  id: "mea.time-taken",
  description: "Work out how long something takes, or when it ends.",
  covers: (o) => scoped(o, { topic: MEA, strand: /^time$/, text: /time taken/i, not: /estimate/i }),
  generate: ({ objective: o, difficulty: d, rng, q, local }) => {
    const twentyFour = o.grade >= 7 || d >= 4;
    const startH = rng.int(6, 14);
    const startM = rng.int(0, 11) * 5;
    const duration = rng.int(
      byLevel(d, [20, 45, 70, 95, 130]),
      byLevel(d, [60, 110, 170, 230, 330]),
    );
    const durationRounded = Math.round(duration / 5) * 5;
    const start = startH * 60 + startM;
    const end = start + durationRounded;
    const show = (minutes: number) => {
      const h = Math.floor(minutes / 60) % 24;
      const m = minutes % 60;
      if (twentyFour) return `${pad(h)}:${pad(m)}`;
      const h12 = h % 12 === 0 ? 12 : h % 12;
      return `${h12}:${pad(m)} ${h >= 12 ? "pm" : "am"}`;
    };
    const [dh, dm] = minutesToParts(durationRounded);
    const trip = local ? "A kombi leaves Harare" : "A bus leaves the depot";
    if (d <= 2 || durationRounded < 60) {
      return q.unit({
        skill: "APPLICATION",
        type: "WORD_PROBLEM",
        stem: `${trip} at ${show(start)} and arrives at ${show(end)}. How many minutes does the journey take?`,
        value: String(durationRounded),
        unit: "min",
        unitOptional: true,
        strictUnit: false,
        answerText: `${durationRounded} minutes`,
        usesLocalContext: local,
        solutionKind: "time-conversion",
        wrongs: [
          { answer: String(durationRounded + 40), tag: "TIME_CONVERSION_ERROR" },
          { answer: String(Math.max(5, durationRounded - 40)), tag: "TIME_CONVERSION_ERROR" },
          { answer: String(durationRounded + 5), tag: "BASIC_FACT_ERROR" },
        ],
        explanation: `From ${show(start)} to ${show(end)}: count on to the next hour, then add the rest. The journey takes ${durationRounded} minutes.`,
        hints: [
          "Count on from the start time to the end time. Remember there are 60 minutes in an hour.",
          "Go up to the next whole hour first, then add the remaining minutes.",
        ],
      });
    }
    return q.multiPart({
      skill: "PROBLEM_SOLVING",
      type: "WORD_PROBLEM",
      stem: `${trip} at ${show(start)} and arrives at ${show(end)}. How long does the journey take?`,
      usesLocalContext: local,
      parts: [
        {
          id: "hours",
          label: "Hours",
          answer: String(dh),
          wrongs: [{ answer: String(dh + 1), tag: "TIME_CONVERSION_ERROR" }],
        },
        {
          id: "minutes",
          label: "Minutes",
          answer: String(dm),
          wrongs: [
            { answer: String(dm + 40), tag: "TIME_CONVERSION_ERROR" },
            { answer: String((dm + 30) % 60), tag: "TIME_CONVERSION_ERROR" },
          ].filter((w) => Number(w.answer) !== dm),
        },
      ],
      explanation: `From ${show(start)} to ${show(end)} is ${durationRounded} minutes, which is ${dh} hour${dh === 1 ? "" : "s"} and ${dm} minute${dm === 1 ? "" : "s"}.`,
      hints: [
        "Count on from the start time to the end time, remembering that there are 60 minutes in an hour (not 100).",
        "Go up to the next whole hour first, then count the whole hours, then add the remaining minutes.",
      ],
    });
  },
});

export const timeOperations = defineTemplate({
  id: "mea.time-operations",
  description: "Add and subtract hours and minutes.",
  covers: (o) => scoped(o, { topic: MEA, strand: /^time$/, text: /add and subtract time/i }),
  generate: ({ difficulty: d, rng, q }) => {
    const subtract = rng.chance(0.5);
    const a = rng.int(60, byLevel(d, [200, 300, 400, 500, 600]));
    const b = rng.int(25, Math.min(a - 5, byLevel(d, [120, 180, 240, 300, 360])));
    const roundedA = Math.round(a / 5) * 5;
    const roundedB = Math.round(b / 5) * 5;
    const result = subtract ? roundedA - roundedB : roundedA + roundedB;
    const [ah, am] = minutesToParts(roundedA);
    const [bh, bm] = minutesToParts(roundedB);
    const [rh, rm] = minutesToParts(result);
    const fmt = (h: number, m: number) => `${h} h ${m} min`;
    // the common slips: minutes not regrouped at 60 (adding) or regrouped at 100 (subtracting)
    const slipMinutes = subtract ? (am >= bm ? rm : am + 100 - bm) : am + bm;
    return q.multiPart({
      skill: "APPLICATION",
      type: "WORKED_CALCULATION",
      stem: `Work out ${fmt(ah, am)} ${subtract ? "−" : "+"} ${fmt(bh, bm)}. Give your answer in hours and minutes.`,
      parts: [
        {
          id: "hours",
          label: "Hours",
          answer: String(rh),
          wrongs: [
            { answer: String(subtract ? ah - bh : ah + bh), tag: "TIME_CONVERSION_ERROR" },
          ].filter((w) => Number(w.answer) !== rh),
        },
        {
          id: "minutes",
          label: "Minutes",
          answer: String(rm),
          wrongs: [{ answer: String(slipMinutes), tag: "TIME_CONVERSION_ERROR" }].filter(
            (w) => Number(w.answer) !== rm,
          ),
        },
      ],
      explanation: `Change both times to minutes or work in hours and minutes, regrouping at 60: ${fmt(ah, am)} ${subtract ? "−" : "+"} ${fmt(bh, bm)} = ${fmt(rh, rm)}.`,
      hints: subtract
        ? [
            "Subtract the minutes first. If the top minutes are smaller, take 1 hour (60 minutes) from the hours.",
            "Remember: 1 hour = 60 minutes, not 100.",
          ]
        : [
            "Add the minutes first. If they total 60 or more, change 60 minutes into 1 hour.",
            "Remember: 1 hour = 60 minutes, not 100.",
          ],
    });
  },
});

export const timeTemplates = [
  clockReading,
  timeConcepts,
  timeConversion,
  timeNotation,
  timeTaken,
  timeOperations,
];
