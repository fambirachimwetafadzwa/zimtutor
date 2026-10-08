import { byLevel, defineTemplate, fractionWords, scoped, type Builders, type Wrong } from "../kit";
import type { Rng } from "../rng";
import {
  COMPASS_DIRECTIONS,
  type AssessmentSkill,
  type CompassDirection,
  type ObjectiveInfo,
  type StemData,
} from "../types";

/**
 * Direction, angles and lines: the cardinal points (4 in Grades 3–4, 8 from Grade 5), turns and
 * revolutions, horizontal / vertical / perpendicular lines, right angles, and — in Grade 7 — the types
 * of angle, missing angles and fractions of a revolution in degrees.
 */

const MEA = "MEA" as const;
const strand = /^direction/;

// ── compass helpers ─────────────────────────────────────────────────────────────────────────────

const DIR4: CompassDirection[] = ["north", "east", "south", "west"];
/** Grid steps (column, row) for one step in each direction; rows grow downwards, north is up. */
const STEP: Record<CompassDirection, [number, number]> = {
  north: [0, -1],
  "north-east": [1, -1],
  east: [1, 0],
  "south-east": [1, 1],
  south: [0, 1],
  "south-west": [-1, 1],
  west: [-1, 0],
  "north-west": [-1, -1],
};

const directionsFor = (points: 4 | 8): CompassDirection[] =>
  points === 4 ? DIR4 : [...COMPASS_DIRECTIONS];
/** Grades 3 and 4 use the four main points; the eight points are taught from Grade 5. */
const pointsFor = (o: ObjectiveInfo): 4 | 8 => (o.grade >= 5 ? 8 : 4);

function rotate(direction: CompassDirection, eighths: number): CompassDirection {
  const index = COMPASS_DIRECTIONS.indexOf(direction);
  return COMPASS_DIRECTIONS[(((index + eighths) % 8) + 8) % 8]!;
}
const opposite = (direction: CompassDirection) => rotate(direction, 4);
/** The likeliest slips first: the opposite direction and the neighbours. */
function wrongDirections(rng: Rng, answer: CompassDirection, points: 4 | 8, count = 3): Wrong[] {
  const pool = directionsFor(points).filter((d) => d !== answer);
  const likely = [
    opposite(answer),
    rotate(answer, 1),
    rotate(answer, -1),
    rotate(answer, 2),
    rotate(answer, -2),
  ].filter((d) => pool.includes(d));
  const chosen = [
    ...new Set([...rng.sample(likely, Math.min(count, likely.length)), ...rng.shuffle(pool)]),
  ];
  return chosen.slice(0, count).map((answer) => ({ answer }));
}

interface Cell {
  col: number;
  row: number;
}

/** The compass direction of `to` seen from `from`, when it lies exactly on one of the eight lines. */
function directionBetween(from: Cell, to: Cell): CompassDirection | null {
  const dx = to.col - from.col;
  const dy = to.row - from.row;
  if (dx === 0 && dy === 0) return null;
  if (dx !== 0 && dy !== 0 && Math.abs(dx) !== Math.abs(dy)) return null;
  const ux = Math.sign(dx);
  const uy = Math.sign(dy);
  return COMPASS_DIRECTIONS.find((d) => STEP[d][0] === ux && STEP[d][1] === uy) ?? null;
}

const VILLAGE_PLACES = [
  "school",
  "clinic",
  "market",
  "church",
  "borehole",
  "dip tank",
  "grinding mill",
  "bus stop",
  "tuck shop",
  "dam",
  "post office",
  "police station",
];

interface VillageMap {
  places: Array<Cell & { label: string }>;
  reference: Cell & { label: string };
  target: Cell & { label: string };
  direction: CompassDirection;
  size: number;
}

/**
 * A small map with a reference place and a target exactly in one of the compass directions from it,
 * plus other places that are NOT in that direction (so "which place is north of …" has one answer).
 */
function buildMap(rng: Rng, points: 4 | 8, size: number): VillageMap {
  const directions = directionsFor(points);
  for (let attempt = 0; attempt < 400; attempt++) {
    const labels = rng.sample(VILLAGE_PLACES, 5);
    const direction = rng.pick(directions);
    const distance = rng.int(1, Math.floor((size - 1) / 2));
    const reference = { label: labels[0]!, col: rng.int(0, size - 1), row: rng.int(0, size - 1) };
    const target = {
      label: labels[1]!,
      col: reference.col + STEP[direction][0] * distance,
      row: reference.row + STEP[direction][1] * distance,
    };
    if (target.col < 0 || target.col >= size || target.row < 0 || target.row >= size) continue;
    const places = [reference, target];
    const taken = new Set(places.map((p) => `${p.col},${p.row}`));
    for (let i = 2; i < 5 && places.length < 5; i++) {
      for (let tries = 0; tries < 30; tries++) {
        const cell = { col: rng.int(0, size - 1), row: rng.int(0, size - 1) };
        if (taken.has(`${cell.col},${cell.row}`)) continue;
        if (directionBetween(reference, cell) === direction) continue;
        taken.add(`${cell.col},${cell.row}`);
        places.push({ label: labels[i]!, ...cell });
        break;
      }
    }
    if (places.length >= 4) return { places, reference, target, direction, size };
  }
  throw new Error("could not build a map");
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A hint that never names the direction it is helping with. */
const arrowHints = (answer: CompassDirection): string[] => [
  "Look at where the arrow points from the middle of the compass: towards the top, the right, the bottom or the left?",
  answer.includes("-")
    ? "This arrow points between two of the main points, so its name has two parts: the up-and-down part comes first."
    : "Each main point is a quarter turn from the next one, going round the compass.",
];

// ── the cardinal points ─────────────────────────────────────────────────────────────────────────

export const cardinalPoints = defineTemplate({
  id: "mea.cardinal",
  description:
    "Cardinal points (4 in Grades 3–4, 8 from Grade 5): naming, opposites, order, and directions between places on a map.",
  covers: (o) =>
    scoped(o, {
      topic: MEA,
      strand,
      text: /cardinal points|position of an object|direction of points/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const points = pointsFor(o);
    const onMap = /position|locate|direction of points/i.test(o.text);
    if (onMap) return mapQuestion(rng, q, d, points);
    const modes: Array<"compass" | "opposite" | "order" | "between" | "sun" | "side"> = [
      "compass",
      "opposite",
    ];
    if (d >= 2) modes.push("order");
    if (points === 8 && d >= 3) modes.push("between");
    if (points === 4) modes.push("sun", "side");
    const mode = rng.pick(modes);
    const dirs = directionsFor(points);

    if (mode === "compass") {
      const answer = rng.pick(dirs);
      return q.mcq({
        skill: "KNOWLEDGE_COMPREHENSION",
        type: "VISUAL_DIAGRAM",
        stem: "The arrow on the compass points in one direction. Which direction is it?",
        stemData: { kind: "compass", points, pointer: answer },
        correct: answer,
        wrongs: wrongDirections(rng, answer, points),
        explanation: `The arrow points ${answer}.`,
        hints: arrowHints(answer),
      });
    }
    if (mode === "opposite") {
      const start = rng.pick(dirs);
      const answer = opposite(start);
      return q.mcq({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Which direction is opposite to ${start}?`,
        correct: answer,
        wrongs: wrongDirections(rng, answer, points),
        explanation: `Opposite means straight across the compass, half a turn away. The opposite of ${start} is ${answer}.`,
        hints: [
          "Opposite means directly across the compass: half a turn away.",
          `Start at ${start} and go half way round the compass.`,
        ],
      });
    }
    if (mode === "order") {
      const start = rng.pick(dirs);
      const clockwise = rng.chance(0.5);
      const step = (points === 4 ? 2 : 1) * (clockwise ? 1 : -1);
      const sequence = Array.from({ length: points }, (_, i) => rotate(start, i * step));
      return q.ordering({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Put the ${points === 4 ? "four main" : "eight"} cardinal points in order, starting at ${start} and going ${clockwise ? "clockwise (the way the hands of a clock turn)" : "anticlockwise (the opposite way to the hands of a clock)"}.`,
        sequence,
        explanation: `Going ${clockwise ? "clockwise" : "anticlockwise"} from ${start}: ${sequence.join(", ")}.`,
        hints: [
          "Picture a compass and move round it one point at a time.",
          clockwise
            ? "Clockwise is the way the hands of a clock turn: from the top, to the right, to the bottom, to the left."
            : "Anticlockwise is the opposite way to the hands of a clock: from the top, to the left, to the bottom, to the right.",
        ],
      });
    }
    if (mode === "between") {
      const first = rng.pick(DIR4);
      const second = rotate(first, 2);
      const answer = rotate(first, 1);
      return q.mcq({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Which direction is exactly half way between ${first} and ${second}?`,
        correct: answer,
        wrongs: wrongDirections(rng, answer, 8),
        explanation: `The point half way between ${first} and ${second} is ${answer}. Its name uses both words, the north or south one first.`,
        hints: [
          "Find the two main points on a compass. The direction half way between them lies on the curve joining them.",
          "A direction between two main points has a name with two parts.",
        ],
      });
    }
    if (mode === "sun") {
      const rises = rng.chance(0.5);
      const answer = rises ? "east" : "west";
      return q.mcq({
        skill: "APPLICATION",
        stem: rises
          ? "In the morning the sun rises in the …"
          : "In the evening the sun sets in the …",
        correct: answer,
        wrongs: DIR4.filter((x) => x !== answer).map((a) => ({ answer: a })),
        explanation: `The sun rises in the east and sets in the west.`,
        hints: rises
          ? [
              "Think about which way you must face to see the morning sun come up.",
              "It is the direction opposite to where the sun sets.",
            ]
          : [
              "Think about which way you must face to see the sun go down in the evening.",
              "It is the direction opposite to where the sun rises.",
            ],
        usesLocalContext: false,
      });
    }
    // side
    const face = rng.pick(DIR4);
    const side = rng.pick(["left", "right", "behind"] as const);
    const answer = rotate(face, side === "right" ? 2 : side === "left" ? -2 : 4);
    return q.mcq({
      skill: "APPLICATION",
      stem:
        side === "behind"
          ? `You are facing ${face}. Which cardinal point is behind you?`
          : `You are facing ${face}. Which cardinal point is on your ${side}-hand side?`,
      correct: answer,
      wrongs: DIR4.filter((x) => x !== answer).map((a) => ({ answer: a })),
      explanation: `Facing ${face}, ${side === "behind" ? "the point behind you is" : `the point on your ${side}-hand side is`} ${answer}.`,
      hints: [
        "Stand up, face that direction, and point with your arm.",
        side === "behind"
          ? "Behind you is the opposite direction to the one you are facing."
          : `A quarter turn ${side === "right" ? "to the right" : "to the left"} shows you the point on that side.`,
      ],
    });
  },
});

function mapQuestion(rng: Rng, q: Builders, d: number, points: 4 | 8) {
  const size = d <= 2 ? 5 : d <= 4 ? 7 : 9;
  const map = buildMap(rng, points, size);
  const picture: StemData = {
    kind: "map",
    cols: size,
    rows: size,
    places: map.places.map(({ label, col, row }) => ({ label, col, row })),
  };
  const modes: Array<"direction" | "place" | "reverse"> = ["direction"];
  if (d >= 3) modes.push("place");
  if (d >= 4) modes.push("reverse");
  const mode = rng.pick(modes);
  const { reference, target, direction } = map;
  const common = {
    skill: "APPLICATION" as AssessmentSkill,
    type: "VISUAL_DIAGRAM" as const,
    stemData: picture,
    usesLocalContext: true,
  };
  const intro = "The map shows some places in a village. North is at the top of the map.";
  if (mode === "place") {
    const others = map.places.filter(
      (p) => p.label !== reference.label && p.label !== target.label,
    );
    return q.mcq({
      ...common,
      stem: `${intro} Which place is ${direction} of the ${reference.label}?`,
      correct: target.label,
      wrongs: others.map((p) => ({ answer: p.label })),
      explanation: `From the ${reference.label}, the ${target.label} lies ${direction}.`,
      hints: [
        `Find the ${reference.label} on the map and put your finger on it.`,
        "Only one place lies exactly in a straight line from it in that direction. Move your finger that way.",
      ],
    });
  }
  const asked = mode === "reverse" ? opposite(direction) : direction;
  const from = mode === "reverse" ? target : reference;
  const to = mode === "reverse" ? reference : target;
  return q.mcq({
    ...common,
    stem: `${intro} In which direction is the ${to.label} from the ${from.label}?`,
    correct: asked,
    wrongs: wrongDirections(rng, asked, points),
    explanation:
      mode === "reverse"
        ? `The ${target.label} is ${direction} of the ${reference.label}, so the ${reference.label} is ${asked} of the ${target.label}.`
        : `The ${to.label} is ${asked} of the ${from.label}.`,
    hints: [
      `Find the ${from.label} on the map, then find the ${to.label}.`,
      `From the ${from.label}, is the ${to.label} above, below, to the left, to the right, or on a slant between?`,
      ...(mode === "reverse" ? ["Going back the other way gives the opposite direction."] : []),
    ],
  });
}

// ── turns and revolutions ───────────────────────────────────────────────────────────────────────

interface Turn {
  key: "quarter" | "half" | "three-quarter" | "complete";
  /** As an option: "a quarter turn". */
  name: string;
  degrees: number;
  eighths: number;
}

const TURNS: Turn[] = [
  { key: "quarter", name: "a quarter turn", degrees: 90, eighths: 2 },
  { key: "half", name: "a half turn", degrees: 180, eighths: 4 },
  { key: "three-quarter", name: "a three-quarter turn", degrees: 270, eighths: 6 },
  { key: "complete", name: "a complete revolution", degrees: 360, eighths: 8 },
];
const turn = (key: Turn["key"]) => TURNS.find((t) => t.key === key)!;

/** Grade 3: quarter and half; Grade 4 adds the complete revolution; Grades 5–6 add three quarters. */
const turnsFor = (grade: number): Turn[] =>
  grade <= 3
    ? [turn("quarter"), turn("half")]
    : grade === 4
      ? [turn("quarter"), turn("half"), turn("complete")]
      : TURNS;
/** Choices offered: Grade 3 also sees "a complete revolution" as a choice, never as an answer. */
const optionsFor = (grade: number): Turn[] =>
  grade <= 3 ? [...turnsFor(3), turn("complete")] : turnsFor(grade);

export const turns = defineTemplate({
  id: "mea.turns",
  description:
    "Quarter, half, three-quarter and complete revolutions: pictures, clock hands, facing directions and combining turns.",
  covers: (o) => scoped(o, { topic: MEA, strand, text: /revolution/i, not: /convert fractions/i }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const grade = o.grade;
    const answers = turnsFor(grade);
    const choices = optionsFor(grade);
    const modes: Array<"picture" | "facing" | "count" | "clock" | "combine"> = [
      "picture",
      "facing",
      "count",
    ];
    if (d >= 2) modes.push("clock");
    if (d >= 3) modes.push("combine");
    const mode = rng.pick(modes);

    if (mode === "picture") {
      const t = rng.pick(answers);
      return q.mcq({
        skill: "KNOWLEDGE_COMPREHENSION",
        type: "VISUAL_DIAGRAM",
        stem: "The picture shows how far an arrow has turned round the circle. Which turn is it?",
        stemData: { kind: "angle", degrees: t.degrees },
        correct: t.name,
        wrongs: choices.filter((c) => c.key !== t.key).map((c) => ({ answer: c.name })),
        explanation:
          t.key === "complete"
            ? "The arrow has turned all the way round the circle: that is a complete revolution."
            : `The arrow has turned ${t.key === "quarter" ? "a quarter" : t.key === "half" ? "a half" : "three quarters"} of the way round the circle, so it is ${t.name}.`,
        hints: [
          "A complete revolution is a turn all the way round, back to where you start.",
          "Compare the turned part with the whole circle: how much of the circle has the arrow passed?",
        ],
      });
    }
    if (mode === "facing") {
      const points = pointsFor(o);
      const dirs = directionsFor(points);
      const start = rng.pick(dirs);
      const t = rng.pick(answers);
      const clockwise = rng.chance(0.5);
      const answer = rotate(start, (clockwise ? 1 : -1) * t.eighths);
      return q.mcq({
        skill: "APPLICATION",
        stem: `You are facing ${start}. You make ${t.name} ${clockwise ? "clockwise (the way the hands of a clock turn)" : "anticlockwise (the opposite way)"}. Which direction are you facing now?`,
        correct: answer,
        wrongs: wrongDirections(rng, answer, points),
        explanation:
          t.key === "complete"
            ? `A complete revolution brings you back to where you started: you face ${start} again.`
            : `${cap(t.name)} ${clockwise ? "clockwise" : "anticlockwise"} from ${start} takes you to ${answer}.`,
        hints: [
          "Stand up, face the first direction, and make the turn slowly.",
          t.key === "complete"
            ? "A turn all the way round brings you back to the start."
            : "Count the turn in quarters: each quarter turn takes you to the next main point.",
        ],
      });
    }
    if (mode === "count") {
      const pairs: Array<{ small: Turn; big: Turn; n: number }> = [
        { small: turn("quarter"), big: turn("half"), n: 2 },
      ];
      if (grade >= 4)
        pairs.push(
          { small: turn("quarter"), big: turn("complete"), n: 4 },
          { small: turn("half"), big: turn("complete"), n: 2 },
        );
      if (grade >= 5) pairs.push({ small: turn("quarter"), big: turn("three-quarter"), n: 3 });
      const { small, big, n } = rng.pick(pairs);
      const unit = (t: Turn) => t.name.replace(/^an? /, "");
      return q.numeric({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `How many ${unit(small)}s make ${big.name}?`,
        answer: String(n),
        wrongs: [
          { answer: String(n + 1) },
          { answer: String(n * 2) },
          { answer: String(n - 1) },
        ].filter((w) => Number(w.answer) > 0),
        explanation: `${cap(big.name)} is made of ${n} ${unit(small)}s.`,
        hints: [
          "Picture the whole circle and cut it into equal turns.",
          "Count how many of the small turns fit into the big turn.",
        ],
      });
    }
    if (mode === "clock") {
      const stops = grade <= 3 ? [3, 6] : grade === 4 ? [3, 6, 12] : [3, 6, 9, 12];
      const stop = rng.pick(stops);
      const t = turn(
        stop === 3 ? "quarter" : stop === 6 ? "half" : stop === 9 ? "three-quarter" : "complete",
      );
      return q.mcq({
        skill: "APPLICATION",
        stem:
          stop === 12
            ? "The minute hand of a clock starts at 12 and goes all the way round until it points to 12 again. What turn has it made?"
            : `The minute hand of a clock moves from 12 to ${stop}. What turn has it made?`,
        correct: t.name,
        wrongs: choices.filter((c) => c.key !== t.key).map((c) => ({ answer: c.name })),
        explanation:
          stop === 12
            ? "Going all the way round the clock face is a complete revolution."
            : `From 12 to ${stop} the hand passes ${stop} of the 12 numbers, which is ${stop}/12 = ${stop / 3}/4 of the way round: ${t.name}.`,
        hints: [
          "The clock face is a circle. 12 at the top, then the numbers go round clockwise.",
          stop === 12
            ? "The hand ends where it started, after going all the way round."
            : "Count how many of the 12 numbers the hand has passed, out of the whole 12.",
        ],
      });
    }
    // combine two turns
    const combos: Array<{ first: Turn; second: Turn; result: Turn }> = [
      { first: turn("quarter"), second: turn("quarter"), result: turn("half") },
    ];
    if (grade >= 4)
      combos.push({ first: turn("half"), second: turn("half"), result: turn("complete") });
    if (grade >= 5)
      combos.push(
        { first: turn("half"), second: turn("quarter"), result: turn("three-quarter") },
        { first: turn("quarter"), second: turn("three-quarter"), result: turn("complete") },
      );
    const { first, second, result } = rng.pick(combos);
    return q.mcq({
      skill: "ANALYSIS",
      stem: `You make ${first.name} and then ${second.name} in the same direction. Altogether you have made …`,
      correct: result.name,
      wrongs: choices.filter((c) => c.key !== result.key).map((c) => ({ answer: c.name })),
      explanation: `${cap(first.name)} and ${second.name} together make ${result.name}.`,
      hints: [
        "Add the two turns, one after the other, as parts of a whole circle.",
        "Think of the turns as quarters of a circle and count how many quarters you have altogether.",
      ],
    });
  },
});

// ── fractions of a revolution in degrees (Grade 7) ───────────────────────────────────────────────

const REVOLUTION_FRACTIONS: Array<{ num: number; den: number }> = [
  { num: 1, den: 4 },
  { num: 1, den: 2 },
  { num: 3, den: 4 },
  { num: 1, den: 8 },
  { num: 3, den: 8 },
  { num: 1, den: 3 },
  { num: 2, den: 3 },
  { num: 1, den: 6 },
  { num: 5, den: 8 },
  { num: 1, den: 10 },
  { num: 1, den: 12 },
  { num: 1, den: 5 },
];

export const revolutionDegrees = defineTemplate({
  id: "mea.revolution-degrees",
  description: "Change fractions of a revolution into degrees and back (a revolution is 360°).",
  covers: (o) => scoped(o, { topic: MEA, strand, text: /convert fractions of revolutions/i }),
  generate: ({ difficulty: d, rng, q }) => {
    const pool = REVOLUTION_FRACTIONS.slice(0, byLevel(d, [3, 4, 8, 12, 12]));
    const { num, den } = rng.pick(pool);
    const degrees = (360 * num) / den;
    const unit = { unit: "°", unitOptional: true, strictUnit: false } as const;
    const mode =
      d <= 2 ? "to-degrees" : rng.pick(["to-degrees", "to-fraction", "two-turns"] as const);

    if (mode === "to-fraction") {
      return q.fraction({
        skill: "APPLICATION",
        stem: `A turn of ${degrees}° is what fraction of a complete revolution? Give your answer in its simplest form.`,
        value: `${num}/${den}`,
        lowestTerms: true,
        answerHint: "Write a fraction, like 1/4",
        wrongs: [
          { answer: `${degrees}/180`, tag: "ANGLE_SUM_ERROR" },
          { answer: `${degrees}/100` },
        ],
        explanation: `A complete revolution is 360°. ${degrees}/360 = ${num}/${den} in its simplest form.`,
        hints: [
          "A complete revolution is a turn of 360°.",
          "Write the turn over 360, then make the fraction simpler.",
        ],
      });
    }
    if (mode === "two-turns") {
      // two turns in the same direction that together stay within one revolution
      const candidates = pool.filter((f) => (360 * f.num) / f.den + degrees <= 360);
      if (candidates.length > 0) {
        const second = rng.pick(candidates);
        const secondDegrees = (360 * second.num) / second.den;
        const total = degrees + secondDegrees;
        return q.unit({
          ...unit,
          skill: "PROBLEM_SOLVING",
          stem: `A wheel turns ${fractionWords(num, den)} of a revolution, and then ${fractionWords(second.num, second.den)} of a revolution in the same direction. How many degrees has it turned altogether?`,
          value: String(total),
          answerText: `${total}°`,
          wrongs: [
            {
              answer: String((180 * num) / den + (180 * second.num) / second.den),
              tag: "ANGLE_SUM_ERROR",
            },
            { answer: String(degrees) },
            { answer: String(secondDegrees) },
          ],
          explanation: `${num}/${den} of 360° = ${degrees}°. ${second.num}/${second.den} of 360° = ${secondDegrees}°. Together: ${degrees} + ${secondDegrees} = ${total}°.`,
          hints: [
            "A complete revolution is 360°. Change each turn into degrees first.",
            "Then add the two turns.",
          ],
        });
      }
    }
    return q.unit({
      ...unit,
      skill: "KNOWLEDGE_COMPREHENSION",
      stem: `How many degrees are there in ${fractionWords(num, den)} of a revolution?`,
      value: String(degrees),
      answerText: `${degrees}°`,
      wrongs: [
        { answer: String((180 * num) / den), tag: "ANGLE_SUM_ERROR" },
        { answer: String((100 * num) / den) },
        { answer: String(degrees + 10) },
      ],
      explanation: `A complete revolution is 360°. ${num}/${den} of 360° = ${num} × (360 ÷ ${den}) = ${degrees}°.`,
      hints: [
        "A complete revolution is a turn of 360°.",
        `Share 360° into ${den} equal parts, then take ${num} of them.`,
      ],
    });
  },
});

// ── lines ───────────────────────────────────────────────────────────────────────────────────────

const LINE_THINGS: Array<{ thing: string; orientation: "horizontal" | "vertical" }> = [
  { thing: "a flagpole standing straight up at the school", orientation: "vertical" },
  { thing: "the crossbar of a football goalpost", orientation: "horizontal" },
  { thing: "the surface of still water in a bucket", orientation: "horizontal" },
  { thing: "a tree trunk growing straight up", orientation: "vertical" },
  { thing: "the top edge of a table", orientation: "horizontal" },
  { thing: "the side edge of a door", orientation: "vertical" },
  { thing: "a washing line pulled tight between two poles", orientation: "horizontal" },
  { thing: "a string with a stone hanging from it", orientation: "vertical" },
  { thing: "the floor of a classroom", orientation: "horizontal" },
  { thing: "a fence post standing upright", orientation: "vertical" },
];

export const lines = defineTemplate({
  id: "mea.lines",
  description: "Horizontal, vertical and (from Grade 6) perpendicular lines.",
  covers: (o) => scoped(o, { topic: MEA, strand, text: /horizontal|vertical|perpendicular/i }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const perpendicular = /perpendicular/i.test(o.text);
    const modes: Array<"thing" | "picture" | "perpendicular" | "meaning"> = ["thing", "picture"];
    if (perpendicular) modes.push("perpendicular", "perpendicular", "meaning");
    const mode = d <= 2 ? rng.pick(["thing", "picture"] as const) : rng.pick(modes);

    if (mode === "thing") {
      const { thing, orientation } = rng.pick(LINE_THINGS);
      return q.mcq({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Is the line along ${thing} horizontal, vertical or slanting?`,
        correct: orientation,
        wrongs: (["horizontal", "vertical", "slanting"] as const)
          .filter((x) => x !== orientation)
          .map((answer) => ({ answer })),
        explanation: `${cap(thing)} is ${orientation === "horizontal" ? "flat and level" : "upright"}, so its line is ${orientation}.`,
        hints: [
          "Think about how the line lies: flat and level like the ground, upright like a standing person, or leaning?",
          "A flat, level line runs from side to side. An upright line runs up and down.",
        ],
        usesLocalContext: false,
      });
    }
    if (mode === "picture") {
      const kind = rng.pick(["horizontal", "vertical", "slanting"] as const);
      const degrees =
        kind === "horizontal"
          ? 0
          : kind === "vertical"
            ? 90
            : rng.pick([30, 45, 60, 120, 135, 150]);
      return q.mcq({
        skill: "KNOWLEDGE_COMPREHENSION",
        type: "VISUAL_DIAGRAM",
        stem: "Look at the line in the picture. Is it horizontal, vertical or slanting?",
        stemData: { kind: "line", degrees },
        correct: kind,
        wrongs: (["horizontal", "vertical", "slanting"] as const)
          .filter((x) => x !== kind)
          .map((answer) => ({ answer })),
        explanation: `The line is ${kind === "slanting" ? "leaning, neither level nor upright, so it is slanting" : kind === "horizontal" ? "flat and level, so it is horizontal" : "straight up and down, so it is vertical"}.`,
        hints: [
          "Compare the line with the bottom edge of the page (which is level) and with the side edge of the page (which is upright).",
          "If the line is not along either of those directions, it is leaning.",
        ],
      });
    }
    if (mode === "perpendicular") {
      const degrees = rng.pick([90, 90, 45, 60, 120, 135]);
      return q.trueFalse({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: "The two lines in the picture are perpendicular to each other.",
        stemData: { kind: "angle", degrees },
        value: degrees === 90,
        falseTag: "ANGLE_TYPE_CONFUSION",
        explanation:
          degrees === 90
            ? "The lines meet at a right angle (like the corner of a page), so they are perpendicular."
            : "The lines do not meet at a right angle, so they are not perpendicular.",
        hints: [
          "Perpendicular lines meet at a right angle: the corner of a page.",
          "Compare the angle between the lines with the corner of a page.",
        ],
      });
    }
    // meaning
    const asked = rng.pick(["right-angle", "horizontal-vertical"] as const);
    return q.mcq({
      skill: "KNOWLEDGE_COMPREHENSION",
      stem:
        asked === "right-angle"
          ? "What do we call two lines that meet at a right angle?"
          : "A horizontal line and a vertical line meet. What are the two lines to each other?",
      correct: "perpendicular",
      wrongs: ["horizontal", "vertical", "slanting"].map((answer) => ({ answer })),
      explanation:
        asked === "right-angle"
          ? "Lines that meet at a right angle (90°) are perpendicular."
          : "A horizontal line and a vertical line meet at a right angle, so they are perpendicular.",
      hints: [
        "Think of the corner of a page: the two edges meet at a right angle.",
        "There is a special word for lines that meet at a right angle.",
      ],
    });
  },
});

// ── right angles ────────────────────────────────────────────────────────────────────────────────

export const rightAngles = defineTemplate({
  id: "mea.right-angles",
  description: "Recognise right angles in pictures, corners of objects and clock hands.",
  covers: (o) => scoped(o, { topic: MEA, strand, text: /right angles/i }),
  generate: ({ difficulty: d, rng, q }) => {
    const modes: Array<"picture" | "object" | "clock" | "count"> = ["picture", "object"];
    if (d >= 2) modes.push("count");
    if (d >= 3) modes.push("clock");
    const mode = rng.pick(modes);

    if (mode === "picture") {
      const degrees = rng.pick([90, 90, 30, 45, 60, 120, 135, 150]);
      return q.trueFalse({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: "This angle is a right angle.",
        stemData: { kind: "angle", degrees },
        value: degrees === 90,
        falseTag: "ANGLE_TYPE_CONFUSION",
        explanation:
          degrees === 90
            ? "It is the same size as the corner of a page, so it is a right angle."
            : `It is ${degrees < 90 ? "smaller" : "bigger"} than the corner of a page, so it is not a right angle.`,
        hints: [
          "A right angle is the size of the corner of a page or an exercise book.",
          "Imagine fitting the corner of a page into the angle: does it fit exactly?",
        ],
      });
    }
    if (mode === "object") {
      const right = rng.pick([
        "the corner of an exercise book",
        "the corner of a door frame",
        "the corner of a window pane",
        "the corner of a chalkboard",
        "the corner of the classroom floor",
      ]);
      return q.mcq({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: "Which of these shows a right angle?",
        correct: right,
        wrongs: [
          "the tip of a sharpened pencil",
          "the opening of a pair of scissors held slightly open",
          "the edge of a round coin",
        ].map((answer) => ({ answer, tag: "ANGLE_TYPE_CONFUSION" })),
        explanation: `${cap(right)} is square: it is a right angle.`,
        hints: [
          "A right angle is the angle in the corner of a page.",
          "Look for a square corner, not a sharp point or a curve.",
        ],
      });
    }
    if (mode === "count") {
      const items = [
        {
          stem: "How many right angles does a square have?",
          n: 4,
          explanation: "Every corner of a square is a right angle, and a square has 4 corners.",
          hints: [
            "A right angle is a square corner, like the corner of a page.",
            "Count the corners of a square.",
          ],
        },
        {
          stem: "How many right angles does a rectangle have?",
          n: 4,
          explanation:
            "Every corner of a rectangle is a right angle, and a rectangle has 4 corners.",
          hints: [
            "A right angle is a square corner, like the corner of a page.",
            "Count the corners of a rectangle.",
          ],
        },
        {
          stem: "How many right angles make a half turn?",
          n: 2,
          explanation: "A right angle is a quarter turn, so a half turn is 2 right angles.",
          hints: [
            "A right angle is a quarter turn.",
            "How many quarter turns fit into a half turn?",
          ],
        },
        {
          stem: "How many right angles make a complete turn?",
          n: 4,
          explanation: "A right angle is a quarter turn, so a complete turn is 4 right angles.",
          hints: [
            "A right angle is a quarter turn.",
            "How many quarter turns fit into a complete turn?",
          ],
        },
      ];
      const pick = rng.pick(items);
      return q.numeric({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: pick.stem,
        answer: String(pick.n),
        wrongs: [
          { answer: String(pick.n + 1) },
          { answer: String(pick.n - 1) },
          { answer: String(pick.n * 2) },
        ].filter((w) => Number(w.answer) > 0),
        explanation: pick.explanation,
        hints: pick.hints,
      });
    }
    // clock
    return q.mcq({
      skill: "APPLICATION",
      stem: "At which of these times do the hands of a clock make a right angle?",
      correct: "3 o'clock",
      wrongs: [
        { answer: "2 o'clock", tag: "ANGLE_TYPE_CONFUSION" },
        { answer: "5 o'clock", tag: "ANGLE_TYPE_CONFUSION" },
        { answer: "6 o'clock", tag: "ANGLE_TYPE_CONFUSION" },
      ],
      explanation:
        "At 3 o'clock the minute hand points to 12 and the hour hand points to 3: a quarter of the clock face, which is a right angle.",
      hints: [
        "A right angle is a quarter turn: a quarter of the way round the clock face.",
        "How many numbers on the clock face are in a quarter turn?",
      ],
    });
  },
});

// ── types of angle ──────────────────────────────────────────────────────────────────────────────

type AngleKind = "acute" | "right" | "obtuse" | "straight" | "reflex" | "revolution";
const ANGLE_NAME: Record<AngleKind, string> = {
  acute: "acute angle",
  right: "right angle",
  obtuse: "obtuse angle",
  straight: "straight angle",
  reflex: "reflex angle",
  revolution: "complete revolution",
};

function degreesOfKind(rng: Rng, kind: AngleKind, fine: boolean): number {
  const step = fine ? 1 : 5;
  const between = (lo: number, hi: number) => lo + step * rng.int(0, Math.floor((hi - lo) / step));
  switch (kind) {
    case "acute":
      return between(10, 85);
    case "right":
      return 90;
    case "obtuse":
      return between(95, 175);
    case "straight":
      return 180;
    case "reflex":
      return between(185, 355);
    case "revolution":
      return 360;
  }
}

const kindsAt = (d: number): AngleKind[] =>
  d <= 1
    ? ["acute", "right", "obtuse"]
    : d === 2
      ? ["acute", "right", "obtuse", "straight"]
      : d === 3
        ? ["acute", "right", "obtuse", "straight", "reflex"]
        : ["acute", "right", "obtuse", "straight", "reflex", "revolution"];

export const angleTypes = defineTemplate({
  id: "mea.angle-types",
  description:
    "Identify and name acute, right, obtuse, straight and reflex angles and a complete revolution.",
  covers: (o) => scoped(o, { topic: MEA, strand, text: /types of angles/i }),
  generate: ({ difficulty: d, rng, q }) => {
    const kinds = kindsAt(d);
    const kind = rng.pick(kinds);
    const degrees = degreesOfKind(rng, kind, d >= 4);
    const wrongKinds = rng.shuffle(kinds.filter((k) => k !== kind));
    const wrongs = wrongKinds
      .slice(0, 3)
      .map((k) => ({ answer: ANGLE_NAME[k], tag: "ANGLE_TYPE_CONFUSION" }));
    const mode =
      d <= 2
        ? rng.pick(["picture", "number"] as const)
        : rng.pick(["picture", "number", "which", "typed"] as const);
    const compareHints = [
      "Compare the angle with a right angle, the corner of a page (90°).",
      "A straight line is 180° and a complete turn is 360°. Where does the angle fit between these?",
    ];
    const explanation = {
      right: `A right angle measures exactly 90°, and this angle is 90°.`,
      straight: `A straight angle measures exactly 180°, and this angle is 180°.`,
      revolution: `A complete revolution measures exactly 360°, and this angle is 360°.`,
      acute: `${degrees}° is smaller than 90°, so it is an acute angle.`,
      obtuse: `${degrees}° is bigger than 90° but smaller than 180°, so it is an obtuse angle.`,
      reflex: `${degrees}° is bigger than 180° but smaller than 360°, so it is a reflex angle.`,
    }[kind];

    if (mode === "picture") {
      return q.mcq({
        skill: "KNOWLEDGE_COMPREHENSION",
        type: "VISUAL_DIAGRAM",
        stem: "What type of angle is shown in the picture?",
        stemData: { kind: "angle", degrees },
        correct: ANGLE_NAME[kind],
        wrongs,
        explanation,
        hints: compareHints,
      });
    }
    if (mode === "number") {
      return q.mcq({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `An angle measures ${degrees}°. What type of angle is it?`,
        correct: ANGLE_NAME[kind],
        wrongs,
        explanation,
        hints: compareHints,
      });
    }
    if (mode === "which") {
      const options = wrongKinds.slice(0, 3).map((k) => ({
        answer: `${degreesOfKind(rng, k, true)}°`,
        tag: "ANGLE_TYPE_CONFUSION",
      }));
      return q.mcq({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Which of these angles is ${kind === "revolution" ? "a complete revolution" : `${/^[aeiou]/.test(kind) ? "an" : "a"} ${kind} angle`}?`,
        correct: `${degrees}°`,
        wrongs: options,
        explanation,
        hints: [
          "Think about the size range for this type of angle.",
          "Compare each choice with 90° (a right angle), 180° (a straight line) and 360° (a complete turn).",
        ],
      });
    }
    return q.text({
      skill: "KNOWLEDGE_COMPREHENSION",
      stem: `What kind of angle is an angle of ${degrees}°? Type its name.`,
      accepted:
        kind === "revolution"
          ? ["complete revolution", "revolution", "full turn", "complete turn"]
          : [kind, `${kind} angle`],
      answerHint: "Type the kind of angle.",
      explanation,
      hints: compareHints,
    });
  },
});

// ── missing angles ──────────────────────────────────────────────────────────────────────────────

/** Positive angles in steps of 5°, each at least 10°, that add up to `total`. */
function splitTotal(rng: Rng, total: number, parts: number): number[] {
  const units = total / 5;
  for (let attempt = 0; attempt < 400; attempt++) {
    const cuts = new Set<number>();
    while (cuts.size < parts - 1) cuts.add(rng.int(1, units - 1));
    const edges = [0, ...[...cuts].sort((a, b) => a - b), units];
    const sizes = edges.slice(1).map((edge, i) => (edge - edges[i]!) * 5);
    if (sizes.every((size) => size >= 10)) return sizes;
  }
  throw new Error(`could not split ${total}° into ${parts} angles`);
}

export const missingAngles = defineTemplate({
  id: "mea.missing-angles",
  description:
    "Find a missing angle in a right angle, on a straight line, round a point, or the reflex angle.",
  covers: (o) => scoped(o, { topic: MEA, strand, text: /missing angles/i }),
  generate: ({ difficulty: d, rng, q }) => {
    const unit = { unit: "°", unitOptional: true, strictUnit: false } as const;
    if (d >= 5 && rng.chance(0.4)) {
      const given = rng.int(4, 34) * 5;
      const value = 360 - given;
      return q.unit({
        ...unit,
        skill: "APPLICATION",
        stem: `An angle of ${given}° is drawn. What is the size of the reflex angle on the outside of it (the rest of the complete turn)?`,
        value: String(value),
        answerText: `${value}°`,
        wrongs: [
          { answer: String(180 - given), tag: "ANGLE_SUM_ERROR" },
          { answer: String(given + 180), tag: "ANGLE_SUM_ERROR" },
          { answer: String(value - 10) },
        ].filter((w) => Number(w.answer) > 0),
        explanation: `The angle and the reflex angle together make a complete turn of 360°. 360° − ${given}° = ${value}°.`,
        hints: [
          "Together the two angles fill a complete revolution.",
          "Take the angle you know away from the total for a complete revolution.",
        ],
      });
    }
    const total: 90 | 180 | 360 = rng.pick(d <= 2 ? [90, 180] : [180, 360, 360]);
    const maxKnown = byLevel(d, [1, 1, 2, 3, 4]);
    const knownCount =
      total === 90
        ? 1
        : total === 180
          ? rng.int(1, Math.min(maxKnown, 3))
          : rng.int(2, Math.max(2, maxKnown));
    const parts = rng.shuffle(splitTotal(rng, total, knownCount + 1));
    const missing = parts[parts.length - 1]!;
    const known = parts.slice(0, -1);
    const sum = known.reduce((a, b) => a + b, 0);
    const where =
      total === 90
        ? "make a right angle"
        : total === 180
          ? "lie on a straight line"
          : "meet at a point";
    const otherTotals = [90, 180, 360].filter((t) => t !== total);
    const wrongs: Wrong[] = [
      ...otherTotals
        .map((t) => ({ answer: String(t - sum), tag: "ANGLE_SUM_ERROR" }))
        .filter((w) => Number(w.answer) > 0),
      { answer: String(sum) },
      { answer: String(missing + 10) },
    ];
    return q.unit({
      ...unit,
      skill: "APPLICATION",
      type: "VISUAL_DIAGRAM",
      stem: `The angles in the picture ${where}. ${known.length === 1 ? `One angle is ${known[0]}°.` : `The angles you can see are ${known.map((k) => `${k}°`).join(", ")}.`} What is the size of the missing angle?`,
      stemData: { kind: "angle-sum", total, known },
      value: String(missing),
      answerText: `${missing}°`,
      wrongs,
      explanation: `Angles that ${where} add up to ${total}° (${total === 90 ? "a right angle" : total === 180 ? "a half turn" : "a complete turn"}). ${known.length > 1 ? `${known.join(" + ")} = ${sum}. ` : ""}The missing angle is ${total} − ${sum} = ${missing}°.`,
      hints: [
        total === 90
          ? "Two angles that make a right angle fill a quarter turn."
          : total === 180
            ? "Angles that fill a straight line make a half turn."
            : "Angles that meet at a point fill a complete turn.",
        "Add the angles you know, then take that total away from the number of degrees in the whole turn.",
        "A complete turn is 360°, a half turn is 180° and a quarter turn is 90°.",
      ],
    });
  },
});

export const directionTemplates = [
  cardinalPoints,
  turns,
  revolutionDegrees,
  lines,
  rightAngles,
  angleTypes,
  missingAngles,
];
