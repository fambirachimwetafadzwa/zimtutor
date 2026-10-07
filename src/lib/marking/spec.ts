import { z } from "zod";

/**
 * How a question is marked, stored with the answer key (question_keys.expected_answer). The marker
 * validates this on every use: a malformed key is a bug to surface, never an excuse to mark wrongly.
 *
 * Expected numbers are STRINGS ("0.75", "3/4", "2 1/2") so they stay exact; nothing in marking uses
 * floating point.
 */

export const MARKING_METHODS = [
  "EXACT_NUMERIC",
  "EXPRESSION_EQUIVALENT",
  "FRACTION_EQUIVALENT",
  "FRACTION_LOWEST_TERMS",
  "NUMERIC_WITH_UNIT",
  "MULTIPLE_CHOICE",
  "TRUE_FALSE",
  "ORDERED_SEQUENCE",
  "MATCHING_PAIRS",
  "TEXT_NORMALISED",
  "MULTI_PART",
  "MANUAL_REVIEW",
] as const;
export type MarkingMethod = (typeof MARKING_METHODS)[number];

const numberText = z.string().trim().min(1).max(60);
const form = z.enum(["integer", "decimal", "fraction", "mixed", "percent"]);

const exactNumeric = z.object({
  method: z.literal("EXACT_NUMERIC"),
  value: numberText,
  /** Other values that are also fully correct (rare: questions with more than one right answer). */
  alsoAccept: z.array(numberText).max(8).optional(),
  /** Accept answers within this distance of the value (estimation questions). */
  tolerance: numberText.optional(),
  /** The written form the question asks for ("write 3/4 as a decimal"). A right value in another form is ALMOST. */
  requireForm: form.optional(),
});

const expressionEquivalent = z.object({
  method: z.literal("EXPRESSION_EQUIVALENT"),
  expression: z.string().trim().min(1).max(160),
  /** "value": any expression with the same value. "expanded": the place-value breakdown (terms must match). */
  kind: z.enum(["value", "expanded"]).default("value"),
  terms: z.array(z.number().int().nonnegative()).max(12).optional(),
});

const fractionEquivalent = z.object({
  method: z.literal("FRACTION_EQUIVALENT"),
  value: numberText,
});
const fractionLowestTerms = z.object({
  method: z.literal("FRACTION_LOWEST_TERMS"),
  value: numberText,
});

const numericWithUnit = z.object({
  method: z.literal("NUMERIC_WITH_UNIT"),
  value: numberText,
  unit: z.string().trim().min(1).max(20),
  /** The question states the unit, so a bare number is fine. */
  unitOptional: z.boolean().default(false),
  /** The answer MUST be in `unit` (conversion questions). Otherwise any equivalent unit is accepted. */
  strictUnit: z.boolean().default(true),
});

const multipleChoice = z.object({
  method: z.literal("MULTIPLE_CHOICE"),
  correct: z.array(z.string().trim().min(1).max(40)).min(1).max(6),
});

const trueFalse = z.object({ method: z.literal("TRUE_FALSE"), value: z.boolean() });

const orderedSequence = z.object({
  method: z.literal("ORDERED_SEQUENCE"),
  sequence: z.array(z.string().trim().min(1).max(60)).min(2).max(12),
});

const matchingPairs = z.object({
  method: z.literal("MATCHING_PAIRS"),
  pairs: z
    .record(z.string().min(1).max(60), z.string().min(1).max(60))
    .refine((p) => Object.keys(p).length >= 2 && Object.keys(p).length <= 12),
});

const textNormalised = z.object({
  method: z.literal("TEXT_NORMALISED"),
  accepted: z.array(z.string().trim().min(1).max(120)).min(1).max(20),
});

const manualReview = z.object({
  method: z.literal("MANUAL_REVIEW"),
  rubric: z.string().max(1000).optional(),
});

export type MarkingSpec =
  | z.infer<typeof exactNumeric>
  | z.infer<typeof expressionEquivalent>
  | z.infer<typeof fractionEquivalent>
  | z.infer<typeof fractionLowestTerms>
  | z.infer<typeof numericWithUnit>
  | z.infer<typeof multipleChoice>
  | z.infer<typeof trueFalse>
  | z.infer<typeof orderedSequence>
  | z.infer<typeof matchingPairs>
  | z.infer<typeof textNormalised>
  | z.infer<typeof manualReview>
  | MultiPartSpec;

export interface MultiPartSpec {
  method: "MULTI_PART";
  parts: Array<{ id: string; label?: string | undefined; marks: number; spec: MarkingSpec }>;
}

const multiPart: z.ZodType<MultiPartSpec> = z.lazy(() =>
  z.object({
    method: z.literal("MULTI_PART"),
    parts: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z0-9_]{1,24}$/),
          label: z.string().max(80).optional(),
          marks: z.number().int().min(1).max(20).default(1),
          spec: markingSpecSchema,
        }),
      )
      .min(2)
      .max(10),
  }),
) as z.ZodType<MultiPartSpec>;

export const markingSpecSchema: z.ZodType<MarkingSpec> = z.lazy(() =>
  z.union([
    exactNumeric,
    expressionEquivalent,
    fractionEquivalent,
    fractionLowestTerms,
    numericWithUnit,
    multipleChoice,
    trueFalse,
    orderedSequence,
    matchingPairs,
    textNormalised,
    manualReview,
    multiPart,
  ]),
) as z.ZodType<MarkingSpec>;

/** A learner's answer in whatever shape the question's method takes. */
export type LearnerAnswer = string | boolean | string[] | { [key: string]: LearnerAnswer };

export class MarkingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarkingConfigError";
  }
}

export function parseMarkingSpec(input: unknown): MarkingSpec {
  const parsed = markingSpecSchema.safeParse(input);
  if (!parsed.success) {
    throw new MarkingConfigError(
      `Invalid marking specification: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data;
}
