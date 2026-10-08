import { z } from "zod";
import { markingSpecSchema, type LearnerAnswer, type MarkingMethod } from "../marking/spec";
import { isMisconceptionCode } from "../misconceptions/registry";
import type { Rng } from "./rng";

/**
 * The shape of every practice question, wherever it came from (a deterministic template or, later,
 * a language model whose output passes the same checks).
 *
 * A question carries its objective, difficulty, type, skill, the answer key (a marking spec), a
 * worked explanation, PROGRESSIVE HINTS that never state the answer, the wrong answers it expects
 * (each tagged with a misconception), and — when the maths is easier to see — structured data for a
 * picture (a table, bar chart, clock, shaded fraction bar, …) that the interface draws.
 */

export const QUESTION_TYPES = [
  "MULTIPLE_CHOICE",
  "NUMERIC",
  "SHORT_ANSWER",
  "WORKED_CALCULATION",
  "TRUE_FALSE",
  "ORDERING",
  "MATCHING",
  "FILL_IN_THE_BLANK",
  "WORD_PROBLEM",
  "VISUAL_DIAGRAM",
  "DATA_INTERPRETATION",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** The four skills ZimTutor tags with; the official grid groups APPLICATION and ANALYSIS into one band. */
export const ASSESSMENT_SKILLS = [
  "KNOWLEDGE_COMPREHENSION",
  "APPLICATION",
  "ANALYSIS",
  "PROBLEM_SOLVING",
] as const;
export type AssessmentSkill = (typeof ASSESSMENT_SKILLS)[number];

export type Difficulty = 1 | 2 | 3 | 4 | 5;

// ── structured picture data (drawn by the interface) ─────────────────────────────────────────
const label = z.string().min(1).max(40);

/** The eight points of the compass, clockwise from north. */
export const COMPASS_DIRECTIONS = [
  "north",
  "north-east",
  "east",
  "south-east",
  "south",
  "south-west",
  "west",
  "north-west",
] as const;
export type CompassDirection = (typeof COMPASS_DIRECTIONS)[number];

export const stemDataSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("table"),
    caption: z.string().max(120).optional(),
    headers: z.array(label).min(2).max(6),
    rows: z
      .array(z.array(z.string().max(40)).min(2).max(6))
      .min(1)
      .max(12),
  }),
  z.object({
    kind: z.literal("bar-chart"),
    title: z.string().max(120),
    /** What the categories are (always the categories, whichever way the bars point). */
    xLabel: z.string().max(40),
    /** What the values measure. */
    yLabel: z.string().max(40),
    bars: z
      .array(z.object({ label, value: z.number().min(0) }))
      .min(2)
      .max(10),
    max: z.number().positive(),
    step: z.number().positive(),
    /** "vertical" draws a column graph, "horizontal" a bar graph (default vertical). */
    orientation: z.enum(["vertical", "horizontal"]).optional(),
  }),
  z.object({
    kind: z.literal("pictograph"),
    title: z.string().max(120),
    symbol: z.string().max(8),
    each: z.number().int().positive(),
    rows: z
      .array(z.object({ label, count: z.number().int().min(0).max(40) }))
      .min(2)
      .max(8),
  }),
  z.object({
    kind: z.literal("tally"),
    title: z.string().max(120),
    rows: z
      .array(z.object({ label, count: z.number().int().min(0).max(40) }))
      .min(1)
      .max(8),
  }),
  z.object({
    kind: z.literal("fraction-bar"),
    parts: z.number().int().min(2).max(24),
    shaded: z.number().int().min(0).max(24),
    /** Whole bars drawn completely shaded before this one (a mixed number). */
    wholes: z.number().int().min(1).max(5).optional(),
  }),
  z.object({
    kind: z.literal("clock"),
    hour: z.number().int().min(1).max(12),
    minute: z.number().int().min(0).max(59),
  }),
  z.object({
    kind: z.literal("rectangle"),
    length: z.number().positive(),
    width: z.number().positive(),
    unit: z.string().max(10),
    showLabels: z.boolean(),
  }),
  z.object({
    kind: z.literal("l-shape"),
    length: z.number().positive(),
    width: z.number().positive(),
    cutLength: z.number().positive(),
    cutWidth: z.number().positive(),
    unit: z.string().max(10),
  }),
  z.object({
    kind: z.literal("triangle"),
    base: z.number().positive(),
    height: z.number().positive(),
    unit: z.string().max(10),
  }),
  z.object({
    kind: z.literal("cuboid"),
    length: z.number().positive(),
    width: z.number().positive(),
    height: z.number().positive(),
    unit: z.string().max(10),
  }),
  z.object({ kind: z.literal("angle"), degrees: z.number().min(1).max(360) }),
  /** A grid of equal squares with some shaded (a 10 × 10 grid shows hundredths and percentages). */
  z.object({
    kind: z.literal("grid"),
    rows: z.number().int().min(1).max(10),
    cols: z.number().int().min(1).max(10),
    shaded: z.number().int().min(0).max(100),
  }),
  /** A number line with evenly spaced marks; `pointer` is where an arrow points (answer asked for). */
  z.object({
    kind: z.literal("number-line"),
    from: z.number(),
    to: z.number(),
    /** Distance between small marks. */
    step: z.number().positive(),
    /** Which values carry a printed label. */
    labelled: z.array(z.number()).max(12),
    pointer: z.number().optional(),
    /** Values written as text on the marks, for fractions ("1/4"). */
    labels: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    kind: z.literal("pie-chart"),
    title: z.string().max(120),
    slices: z
      .array(z.object({ label, value: z.number().positive() }))
      .min(2)
      .max(8),
    /** How slice sizes are written on the chart. */
    valueLabel: z.enum(["percent", "degrees", "count", "none"]),
  }),
  z.object({
    kind: z.literal("line-graph"),
    title: z.string().max(120),
    xLabel: z.string().max(40),
    yLabel: z.string().max(40),
    points: z
      .array(z.object({ label, value: z.number().min(0) }))
      .min(3)
      .max(12),
    max: z.number().positive(),
    step: z.number().positive(),
  }),
  /** A regular polygon with `sides` sides, or a named shape. */
  z.object({
    kind: z.literal("polygon"),
    sides: z.number().int().min(3).max(10),
    regular: z.boolean(),
    /** For named quadrilaterals that are not regular polygons. */
    shape: z.enum(["kite", "rhombus", "parallelogram", "trapezium"]).optional(),
  }),
  z.object({
    kind: z.literal("circle-part"),
    highlight: z.enum([
      "radius",
      "diameter",
      "chord",
      "arc",
      "circumference",
      "centre",
      "semicircle",
    ]),
  }),
  /** A ruler with a line drawn along it. */
  z.object({
    kind: z.literal("ruler"),
    unit: z.enum(["cm", "mm"]),
    /** Length of the ruler shown. */
    length: z.number().positive(),
    start: z.number().min(0),
    end: z.number().positive(),
  }),
  /** A measuring jug filled to `level`. */
  z.object({
    kind: z.literal("jug"),
    capacity: z.number().positive(),
    level: z.number().min(0),
    unit: z.enum(["ml", "l"]),
    step: z.number().positive(),
    labelEvery: z.number().positive(),
  }),
  /** A dial or balance scale reading. */
  z.object({
    kind: z.literal("dial-scale"),
    max: z.number().positive(),
    reading: z.number().min(0),
    unit: z.enum(["g", "kg"]),
    step: z.number().positive(),
    labelEvery: z.number().positive(),
  }),
  /** A compass rose with 4 or 8 points; `pointer` is where an arrow points (the learner names it). */
  z.object({
    kind: z.literal("compass"),
    points: z.union([z.literal(4), z.literal(8)]),
    pointer: z.enum(COMPASS_DIRECTIONS).optional(),
  }),
  /** A map on a grid with north at the top; places sit on grid points (column, row from the top left). */
  z.object({
    kind: z.literal("map"),
    cols: z.number().int().min(3).max(11),
    rows: z.number().int().min(3).max(11),
    places: z
      .array(
        z.object({
          label,
          col: z.number().int().min(0).max(10),
          row: z.number().int().min(0).max(10),
        }),
      )
      .min(2)
      .max(8),
  }),
  /** A straight line at `degrees` from the horizontal: 0 is horizontal, 90 is vertical. */
  z.object({ kind: z.literal("line"), degrees: z.number().min(0).max(179) }),
  /** Angles that share a vertex and fill a right angle, a straight line or a full turn; one is unknown. */
  z.object({
    kind: z.literal("angle-sum"),
    total: z.union([z.literal(90), z.literal(180), z.literal(360)]),
    known: z.array(z.number().positive()).min(1).max(4),
  }),
]);
export type StemData = z.infer<typeof stemDataSchema>;

export const learnerAnswerSchema: z.ZodType<LearnerAnswer> = z.lazy(() =>
  z.union([
    z.string(),
    z.boolean(),
    z.array(z.string()),
    z.record(z.string(), learnerAnswerSchema),
  ]),
);

/** Which marking methods suit which question types (a multiple-choice question is never marked as a number). */
export const METHODS_FOR_TYPE: Record<QuestionType, readonly MarkingMethod[]> = {
  MULTIPLE_CHOICE: ["MULTIPLE_CHOICE"],
  TRUE_FALSE: ["TRUE_FALSE"],
  ORDERING: ["ORDERED_SEQUENCE"],
  MATCHING: ["MATCHING_PAIRS"],
  SHORT_ANSWER: ["TEXT_NORMALISED", "EXACT_NUMERIC", "ORDERED_SEQUENCE"],
  NUMERIC: [
    "EXACT_NUMERIC",
    "FRACTION_EQUIVALENT",
    "FRACTION_LOWEST_TERMS",
    "NUMERIC_WITH_UNIT",
    "EXPRESSION_EQUIVALENT",
  ],
  FILL_IN_THE_BLANK: [
    "EXACT_NUMERIC",
    "TEXT_NORMALISED",
    "ORDERED_SEQUENCE",
    "NUMERIC_WITH_UNIT",
    "FRACTION_EQUIVALENT",
    "FRACTION_LOWEST_TERMS",
    "EXPRESSION_EQUIVALENT",
  ],
  WORKED_CALCULATION: ["EXPRESSION_EQUIVALENT", "EXACT_NUMERIC", "NUMERIC_WITH_UNIT", "MULTI_PART"],
  WORD_PROBLEM: [
    "EXACT_NUMERIC",
    "NUMERIC_WITH_UNIT",
    "MULTI_PART",
    "FRACTION_EQUIVALENT",
    "FRACTION_LOWEST_TERMS",
  ],
  VISUAL_DIAGRAM: [
    "MULTIPLE_CHOICE",
    "EXACT_NUMERIC",
    "NUMERIC_WITH_UNIT",
    "TEXT_NORMALISED",
    "FRACTION_EQUIVALENT",
    "FRACTION_LOWEST_TERMS",
    "TRUE_FALSE",
  ],
  DATA_INTERPRETATION: [
    "EXACT_NUMERIC",
    "NUMERIC_WITH_UNIT",
    "MULTIPLE_CHOICE",
    "TEXT_NORMALISED",
    "MULTI_PART",
  ],
};

export const generatedQuestionSchema = z
  .object({
    templateId: z.string().regex(/^[a-z0-9.-]+$/),
    templateVersion: z.number().int().positive(),
    objectiveId: z.string(),
    difficulty: z.number().int().min(1).max(5),
    type: z.enum(QUESTION_TYPES),
    assessmentSkill: z.enum(ASSESSMENT_SKILLS),
    stem: z.string().trim().min(8).max(900),
    stemData: stemDataSchema.optional(),
    options: z
      .array(z.object({ id: z.string().regex(/^[A-F]$/), text: z.string().trim().min(1).max(120) }))
      .min(3)
      .max(6)
      .optional(),
    /** ORDERING: the things to arrange, shuffled (never in the answer order). */
    items: z.array(z.string().trim().min(1).max(60)).min(2).max(12).optional(),
    /** MATCHING: the two columns, both shuffled. */
    matching: z
      .object({
        left: z.array(z.string().trim().min(1).max(60)).min(2).max(12),
        right: z.array(z.string().trim().min(1).max(60)).min(2).max(12),
      })
      .optional(),
    /** MULTI_PART: one labelled box per part of the answer. */
    answerFields: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z0-9_]{1,24}$/),
          label: z.string().trim().min(1).max(60),
          unit: z.string().max(12).optional(),
        }),
      )
      .min(2)
      .max(10)
      .optional(),
    /** How to write the answer ("Write a fraction, like 3/4"), shown under the answer box. */
    answerHint: z.string().trim().max(100).optional(),
    marking: markingSpecSchema,
    /** The right answer in the form a learner would type it. Server-side only (answer key). */
    correctAnswer: learnerAnswerSchema,
    explanation: z.string().trim().min(10).max(1200),
    /** From a first nudge to a strong clue. NONE of them states the answer. */
    hints: z.array(z.string().trim().min(5).max(300)).min(2).max(4),
    solutionSteps: z.array(z.string().trim().min(3).max(300)).max(10).optional(),
    /** What the question is about, for the power-of-ten fallback in diagnosis. */
    solutionKind: z.string().max(40).optional(),
    /** Canonical wrong answer → misconception code. Multi-part keys are "<partId>:<answer>". */
    distractorMap: z.record(z.string(), z.string()),
    misconceptionTags: z.array(z.string()),
    usesLocalContext: z.boolean(),
  })
  .superRefine((q, ctx) => {
    const fail = (message: string, path: string[] = []) =>
      ctx.addIssue({ code: "custom", message, path });
    if (!METHODS_FOR_TYPE[q.type].includes(q.marking.method))
      fail(`A ${q.type} question cannot be marked with ${q.marking.method}`, ["marking"]);
    if (q.type === "MULTIPLE_CHOICE" || q.marking.method === "MULTIPLE_CHOICE") {
      if (!q.options) fail("Multiple-choice questions need options", ["options"]);
      else {
        const ids = q.options.map((o) => o.id);
        if (new Set(ids).size !== ids.length) fail("Option ids must be unique", ["options"]);
        const texts = q.options.map((o) => o.text.toLowerCase());
        if (new Set(texts).size !== texts.length)
          fail("Option texts must be distinct", ["options"]);
        if (
          q.marking.method === "MULTIPLE_CHOICE" &&
          !q.marking.correct.every((c) => ids.includes(c))
        )
          fail("The correct option is not among the options", ["marking"]);
      }
    } else if (q.options) {
      fail("Only multiple-choice questions have options", ["options"]);
    }
    if (q.type === "ORDERING") {
      if (!q.items) fail("Ordering questions need the items to arrange", ["items"]);
    } else if (q.items) fail("Only ordering questions have items", ["items"]);
    if (q.type === "MATCHING") {
      if (!q.matching) fail("Matching questions need both columns", ["matching"]);
    } else if (q.matching) fail("Only matching questions have columns", ["matching"]);
    if (q.marking.method === "MULTI_PART") {
      const ids = q.marking.parts.map((p) => p.id);
      const fields = (q.answerFields ?? []).map((f) => f.id);
      if (ids.length !== fields.length || ids.some((id) => !fields.includes(id)))
        fail("answerFields must list exactly the parts of the marking key", ["answerFields"]);
    } else if (q.answerFields)
      fail("Only multi-part questions have answer fields", ["answerFields"]);
    for (const tag of q.misconceptionTags)
      if (!isMisconceptionCode(tag))
        fail(`Unknown misconception tag ${tag}`, ["misconceptionTags"]);
    for (const tag of Object.values(q.distractorMap)) {
      if (!q.misconceptionTags.includes(tag))
        fail(`distractorMap uses ${tag}, which is not in misconceptionTags`, ["distractorMap"]);
    }
  });

export type GeneratedQuestion = z.infer<typeof generatedQuestionSchema>;

// ── templates ────────────────────────────────────────────────────────────────────────────────

/** What a template needs to know about the objective it is generating for. */
export interface ObjectiveInfo {
  id: string;
  text: string;
  grade: number;
  topicCode: "NUM" | "OPS" | "MEA" | "REL";
  subtopicId: string;
  /** e.g. "proper-fractions": links the same strand across grades. */
  strandKey: string;
  subtopicShortName: string;
  ordinalInSubtopic: number;
}

export interface TemplateInput {
  objective: ObjectiveInfo;
  difficulty: Difficulty;
  rng: Rng;
  /** Whether this question may be set in a Zimbabwean everyday context. */
  local: boolean;
}

export interface QuestionTemplate {
  /** Stable identifier, e.g. "ops.add-whole". */
  id: string;
  /** Bump when the output changes meaningfully. */
  version: number;
  description: string;
  covers(objective: ObjectiveInfo): boolean;
  /** Difficulties this template suits (default: all). A word problem is not for the first level. */
  levels?: readonly Difficulty[];
  generate(input: TemplateInput): GeneratedQuestion;
}

/** Largest whole number each grade works with (syllabus topic headings: 0–1 000 … 0–10 000 000). */
export const GRADE_MAX: Record<number, number> = {
  3: 1_000,
  4: 10_000,
  5: 100_000,
  6: 1_000_000,
  7: 10_000_000,
};
