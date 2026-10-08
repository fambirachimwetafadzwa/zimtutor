import { canonicalKey } from "../misconceptions/diagnose";
import type { LearnerAnswer, MarkingSpec } from "../marking/spec";
import type { Rational } from "../marking/rational";
import { numberToWords, ordinalWords } from "../marking/words";
import type { Rng } from "./rng";
import type {
  AssessmentSkill,
  Difficulty,
  GeneratedQuestion,
  ObjectiveInfo,
  QuestionTemplate,
  QuestionType,
  StemData,
  TemplateInput,
} from "./types";

/**
 * Building blocks shared by the question templates: number formatting in the syllabus's style,
 * multiple-choice and numeric question builders that keep the answer key, the options and the
 * misconception map consistent with each other, and helpers for matching objectives.
 */

// ── formatting ──────────────────────────────────────────────────────────────────────────────────

/** Whole numbers as the syllabus prints them: digits grouped in threes by spaces ("1 250", "100 000"). */
export function fmtInt(n: number | bigint): string {
  const negative = n < 0;
  const digits = (negative ? -BigInt(n) : BigInt(n)).toString();
  const grouped = digits.length > 3 ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ") : digits;
  return `${negative ? "−" : ""}${grouped}`;
}

/** Any exact value as a decimal when it terminates (grouping the integer part), otherwise as a fraction. */
export function fmtValue(value: Rational): string {
  const decimal = value.toDecimalString();
  if (decimal === null) return value.toFractionString();
  const [integer, fraction] = decimal.split(".");
  const grouped = fmtInt(BigInt(integer!));
  return fraction ? `${grouped}.${fraction}` : grouped;
}

/** A decimal's integer part grouped like a whole number: "12345.6" → "12 345.6". */
export function fmtDecimal(text: string): string {
  const [integer, fraction] = text.split(".");
  const grouped = fmtInt(BigInt(integer!));
  return fraction !== undefined ? `${grouped}.${fraction}` : grouped;
}

/** Money: "75c", "$5", "$5.50". Amounts under a dollar are cents. */
export function fmtMoney(cents: number): string {
  if (cents < 100 && cents >= 0) return `${cents}c`;
  const dollars = Math.floor(cents / 100);
  const rest = cents % 100;
  return rest === 0 ? `$${dollars}` : `$${dollars}.${String(rest).padStart(2, "0")}`;
}

/** Dollars and cents with both parts shown ("$0.75", "$5.00"): for answers typed as a decimal. */
export function moneyDecimal(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function fmtFraction(num: number, den: number): string {
  return `${num}/${den}`;
}

export function mixedText(whole: number, num: number, den: number): string {
  return `${whole} ${num}/${den}`;
}

/** Accepted spellings of a whole number in words ("and" after hundreds is optional). */
export function numberWordVariants(n: number): string[] {
  const withAnd = numberToWords(n);
  const without = withAnd.replace(/ and /g, " ");
  return withAnd === without ? [withAnd] : [withAnd, without];
}

const SMALL_NAMES: Record<number, [string, string]> = {
  2: ["half", "halves"],
  4: ["quarter", "quarters"],
};

/** "three quarters", "one fifth", "seven twentieths". */
export function fractionWords(num: number, den: number): string {
  const [one, many] = SMALL_NAMES[den] ?? [ordinalWords(den), `${ordinalWords(den)}s`];
  return `${numberToWords(num)} ${num === 1 ? one : many}`;
}

// ── objective matching ──────────────────────────────────────────────────────────────────────────

export interface Scope {
  grades?: readonly number[];
  topic?: ObjectiveInfo["topicCode"];
  /** Matched against the strand key (e.g. "proper-fractions"). */
  strand?: RegExp;
  /** Matched against the objective's wording. */
  text?: RegExp;
  /** The wording must NOT match this. */
  not?: RegExp;
}

export function scoped(objective: ObjectiveInfo, scope: Scope): boolean {
  if (scope.grades && !scope.grades.includes(objective.grade)) return false;
  if (scope.topic && objective.topicCode !== scope.topic) return false;
  if (scope.strand && !scope.strand.test(objective.strandKey)) return false;
  if (scope.text && !scope.text.test(objective.text)) return false;
  if (scope.not && scope.not.test(objective.text)) return false;
  return true;
}

/** `covers` for a list of scopes: any one matching is enough. */
export const anyScope =
  (...scopes: Scope[]) =>
  (objective: ObjectiveInfo): boolean =>
    scopes.some((s) => scoped(objective, s));

export const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** Pick by difficulty: values[0] for difficulty 1 … values[4] for difficulty 5. */
export function byLevel<T>(difficulty: Difficulty, values: readonly [T, T, T, T, T]): T {
  return values[difficulty - 1]!;
}

// ── builders ────────────────────────────────────────────────────────────────────────────────────

export interface Wrong {
  /** The wrong answer as a learner would type it. */
  answer: string;
  /** The misconception it points at, if the template predicted this error. */
  tag?: string;
}

/** Two answers are the same when they have the same value or the same words ("<" and ">" are different). */
const sameAnswerKey = (text: string): string => canonicalKey(text) || text.trim();

/** Wrong answers with the right one and duplicates removed (compared by canonical value). */
export function uniqueWrongs(correct: string, wrongs: Wrong[]): Wrong[] {
  const seen = new Set([sameAnswerKey(correct)]);
  const out: Wrong[] = [];
  for (const wrong of wrongs) {
    const key = sameAnswerKey(wrong.answer);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(wrong);
  }
  return out;
}

interface Common {
  input: TemplateInput;
  templateId: string;
  version?: number;
  skill: AssessmentSkill;
  stem: string;
  stemData?: StemData;
  explanation: string;
  hints: string[];
  solutionSteps?: string[];
  solutionKind?: string;
  usesLocalContext?: boolean;
  /** Tags the question may produce even if no listed wrong answer carries them. */
  extraTags?: string[];
  /** "Write a fraction, like 3/4": shown under the answer box. */
  answerHint?: string;
}

interface Extras {
  options?: GeneratedQuestion["options"];
  items?: string[];
  matching?: GeneratedQuestion["matching"];
  answerFields?: GeneratedQuestion["answerFields"];
}

function assemble(
  common: Common,
  type: QuestionType,
  marking: MarkingSpec,
  correctAnswer: LearnerAnswer,
  distractorMap: Record<string, string>,
  extras: Extras = {},
): GeneratedQuestion {
  const tags = [...new Set([...Object.values(distractorMap), ...(common.extraTags ?? [])])];
  return {
    templateId: common.templateId,
    templateVersion: common.version ?? 1,
    objectiveId: common.input.objective.id,
    difficulty: common.input.difficulty,
    type,
    assessmentSkill: common.skill,
    stem: common.stem,
    ...(common.stemData ? { stemData: common.stemData } : {}),
    ...(extras.options ? { options: extras.options } : {}),
    ...(extras.items ? { items: extras.items } : {}),
    ...(extras.matching ? { matching: extras.matching } : {}),
    ...(extras.answerFields ? { answerFields: extras.answerFields } : {}),
    ...(common.answerHint ? { answerHint: common.answerHint } : {}),
    marking,
    correctAnswer,
    explanation: common.explanation,
    hints: common.hints,
    ...(common.solutionSteps ? { solutionSteps: common.solutionSteps } : {}),
    ...(common.solutionKind ? { solutionKind: common.solutionKind } : {}),
    distractorMap,
    misconceptionTags: tags,
    usesLocalContext: common.usesLocalContext ?? false,
  };
}

const tagMap = (correct: string, wrongs: Wrong[] | undefined): Record<string, string> => {
  const map: Record<string, string> = {};
  for (const wrong of uniqueWrongs(correct, wrongs ?? []))
    if (wrong.tag) map[canonicalKey(wrong.answer)] = wrong.tag;
  return map;
};

/** A typed numeric answer, marked exactly. */
export function numericQuestion(
  common: Common & {
    type?: Extract<
      QuestionType,
      | "NUMERIC"
      | "FILL_IN_THE_BLANK"
      | "WORD_PROBLEM"
      | "VISUAL_DIAGRAM"
      | "DATA_INTERPRETATION"
      | "WORKED_CALCULATION"
      | "SHORT_ANSWER"
    >;
    answer: string;
    wrongs?: Wrong[];
    requireForm?: "integer" | "decimal" | "fraction" | "mixed" | "percent" | "digits";
    alsoAccept?: string[];
    /** Accept answers within this distance (estimation). */
    tolerance?: string;
  },
): GeneratedQuestion {
  const marking: MarkingSpec = {
    method: "EXACT_NUMERIC",
    value: common.answer,
    ...(common.alsoAccept ? { alsoAccept: common.alsoAccept } : {}),
    ...(common.requireForm ? { requireForm: common.requireForm } : {}),
    ...(common.tolerance ? { tolerance: common.tolerance } : {}),
  };
  return assemble(
    common,
    common.type ?? "NUMERIC",
    marking,
    common.answer,
    tagMap(common.answer, common.wrongs),
  );
}

/** A number with a unit ("250 cm"). */
export function unitQuestion(
  common: Common & {
    type?: Extract<
      QuestionType,
      "NUMERIC" | "WORD_PROBLEM" | "VISUAL_DIAGRAM" | "FILL_IN_THE_BLANK" | "DATA_INTERPRETATION"
    >;
    value: string;
    unit: string;
    /** The question states the unit, so a bare number is accepted. */
    unitOptional?: boolean;
    /** The answer must be in exactly this unit (conversions). */
    strictUnit?: boolean;
    /** The answer as shown after the question ("$2.50"); default: the value and the unit. */
    answerText?: string;
    wrongs?: Wrong[];
  },
): GeneratedQuestion {
  const marking: MarkingSpec = {
    method: "NUMERIC_WITH_UNIT",
    value: common.value,
    unit: common.unit,
    unitOptional: common.unitOptional ?? false,
    strictUnit: common.strictUnit ?? true,
  };
  return assemble(
    common,
    common.type ?? "NUMERIC",
    marking,
    common.answerText ?? `${common.value} ${common.unit}`,
    tagMap(common.value, common.wrongs),
  );
}

/** Choose one. The wrong options come from `wrongs`; tagged ones feed misconception diagnosis. */
export function mcqQuestion(
  common: Common & {
    type?: Extract<QuestionType, "MULTIPLE_CHOICE" | "VISUAL_DIAGRAM" | "DATA_INTERPRETATION">;
    correct: string;
    wrongs: Wrong[];
    rng: Rng;
    /** Total number of options (default 4). */
    count?: number;
    /** Keep the options in the order given (for "<  >  =" style choices). */
    keepOrder?: boolean;
    /**
     * The options are ways of WRITING things, not values ("4 7/10" and "4.7" may both be offered):
     * only identical texts count as duplicates.
     */
    keepEqualValues?: boolean;
  },
): GeneratedQuestion {
  const distinct = common.keepEqualValues
    ? common.wrongs.filter(
        (w, i, all) =>
          w.answer.trim() !== common.correct.trim() &&
          all.findIndex((x) => x.answer.trim() === w.answer.trim()) === i,
      )
    : uniqueWrongs(common.correct, common.wrongs);
  const wrongs = distinct.slice(0, (common.count ?? 4) - 1);
  if (wrongs.length < 2)
    throw new Error(`mcqQuestion needs at least 2 distinct wrong options, got ${wrongs.length}`);
  const entries = [
    { text: common.correct, tag: undefined as string | undefined, right: true },
    ...wrongs.map((w) => ({ text: w.answer, tag: w.tag, right: false })),
  ];
  const ordered = common.keepOrder ? entries : common.rng.shuffle(entries);
  const ids = ["A", "B", "C", "D", "E", "F"];
  const options = ordered.map((o, i) => ({ id: ids[i]!, text: o.text }));
  const correctId = options[ordered.findIndex((o) => o.right)]!.id;
  const distractorMap: Record<string, string> = {};
  ordered.forEach((o, i) => {
    if (!o.right && o.tag) distractorMap[ids[i]!] = o.tag;
  });
  return assemble(
    common,
    common.type ?? "MULTIPLE_CHOICE",
    { method: "MULTIPLE_CHOICE", correct: [correctId] },
    correctId,
    distractorMap,
    { options },
  );
}

export function trueFalseQuestion(
  common: Common & { value: boolean; falseTag?: string },
): GeneratedQuestion {
  const distractorMap: Record<string, string> = {};
  if (common.falseTag) distractorMap[String(!common.value)] = common.falseTag;
  return assemble(
    common,
    "TRUE_FALSE",
    { method: "TRUE_FALSE", value: common.value },
    common.value,
    distractorMap,
  );
}

/** Arrange items in order. The items are shown shuffled (never already in the right order). */
export function orderingQuestion(
  common: Common & {
    sequence: string[];
    rng: Rng;
    wrongOrders?: Array<{ order: string[]; tag: string }>;
  },
): GeneratedQuestion {
  const distractorMap: Record<string, string> = {};
  for (const wrong of common.wrongOrders ?? [])
    distractorMap[wrong.order.map(canonicalKey).join("|")] = wrong.tag;
  let items = common.rng.shuffle(common.sequence);
  for (let i = 0; i < 20 && items.every((item, k) => item === common.sequence[k]); i++)
    items = common.rng.shuffle(common.sequence);
  return assemble(
    common,
    "ORDERING",
    { method: "ORDERED_SEQUENCE", sequence: common.sequence },
    common.sequence,
    distractorMap,
    { items },
  );
}

/** A typed list ("write the next three numbers"), marked in order. */
export function listQuestion(
  common: Common & {
    type?: Extract<QuestionType, "SHORT_ANSWER" | "FILL_IN_THE_BLANK">;
    sequence: string[];
    wrongLists?: Array<{ list: string[]; tag: string }>;
  },
): GeneratedQuestion {
  const distractorMap: Record<string, string> = {};
  for (const wrong of common.wrongLists ?? [])
    distractorMap[wrong.list.map(canonicalKey).join("|")] = wrong.tag;
  return assemble(
    common,
    common.type ?? "SHORT_ANSWER",
    { method: "ORDERED_SEQUENCE", sequence: common.sequence },
    common.sequence,
    distractorMap,
  );
}

/** Match each item in the left column to one in the right column. */
export function matchingQuestion(
  common: Common & { pairs: Record<string, string>; rng: Rng },
): GeneratedQuestion {
  const left = common.rng.shuffle(Object.keys(common.pairs));
  const right = common.rng.shuffle(Object.values(common.pairs));
  return assemble(
    common,
    "MATCHING",
    { method: "MATCHING_PAIRS", pairs: common.pairs },
    common.pairs,
    {},
    { matching: { left, right } },
  );
}

export function textQuestion(
  common: Common & {
    type?: Extract<
      QuestionType,
      "SHORT_ANSWER" | "FILL_IN_THE_BLANK" | "VISUAL_DIAGRAM" | "DATA_INTERPRETATION"
    >;
    accepted: string[];
    wrongs?: Wrong[];
  },
): GeneratedQuestion {
  const distractorMap: Record<string, string> = {};
  for (const wrong of common.wrongs ?? [])
    if (wrong.tag) distractorMap[canonicalKey(wrong.answer)] = wrong.tag;
  return assemble(
    common,
    common.type ?? "SHORT_ANSWER",
    { method: "TEXT_NORMALISED", accepted: common.accepted },
    common.accepted[0]!,
    distractorMap,
  );
}

export function fractionQuestion(
  common: Common & {
    type?: Extract<
      QuestionType,
      "NUMERIC" | "FILL_IN_THE_BLANK" | "WORD_PROBLEM" | "VISUAL_DIAGRAM"
    >;
    value: string;
    lowestTerms: boolean;
    wrongs?: Wrong[];
  },
): GeneratedQuestion {
  return assemble(
    common,
    common.type ?? "NUMERIC",
    {
      method: common.lowestTerms ? "FRACTION_LOWEST_TERMS" : "FRACTION_EQUIVALENT",
      value: common.value,
    },
    common.value,
    tagMap(common.value, common.wrongs),
  );
}

export function expressionQuestion(
  common: Common & {
    type?: Extract<QuestionType, "WORKED_CALCULATION" | "NUMERIC" | "FILL_IN_THE_BLANK">;
    expression: string;
    kind?: "value" | "expanded";
    terms?: Array<number | string>;
    /** The right answer as a learner would write it (shown after the question; default: the terms joined). */
    answerText?: string;
    wrongs?: Wrong[];
  },
): GeneratedQuestion {
  const distractorMap: Record<string, string> = {};
  for (const wrong of common.wrongs ?? [])
    if (wrong.tag) distractorMap[canonicalKey(wrong.answer)] = wrong.tag;
  return assemble(
    common,
    common.type ?? "WORKED_CALCULATION",
    {
      method: "EXPRESSION_EQUIVALENT",
      expression: common.expression,
      kind: common.kind ?? "value",
      ...(common.terms ? { terms: common.terms } : {}),
    },
    // An expansion is answered with the sum of its terms, not with the number it adds up to.
    common.answerText ??
      (common.kind === "expanded" && common.terms ? common.terms.join(" + ") : common.expression),
    distractorMap,
  );
}

/** One labelled box per part, each marked on its own ("quotient" and "remainder"). */
export function multiPartQuestion(
  common: Common & {
    type?: Extract<QuestionType, "WORKED_CALCULATION" | "WORD_PROBLEM" | "DATA_INTERPRETATION">;
    parts: Array<{
      id: string;
      label: string;
      unit?: string;
      marks?: number;
      /** Exact number by default; pass `spec` for anything else. */
      answer: string;
      spec?: MarkingSpec;
      wrongs?: Wrong[];
    }>;
  },
): GeneratedQuestion {
  const distractorMap: Record<string, string> = {};
  const correct: Record<string, LearnerAnswer> = {};
  for (const part of common.parts) {
    correct[part.id] = part.answer;
    for (const [key, tag] of Object.entries(tagMap(part.answer, part.wrongs)))
      distractorMap[`${part.id}:${key}`] = tag;
  }
  return assemble(
    common,
    common.type ?? "WORKED_CALCULATION",
    {
      method: "MULTI_PART",
      parts: common.parts.map((p) => ({
        id: p.id,
        label: p.label,
        marks: p.marks ?? 1,
        spec: p.spec ?? { method: "EXACT_NUMERIC", value: p.answer },
      })),
    },
    correct,
    distractorMap,
    {
      answerFields: common.parts.map((p) => ({
        id: p.id,
        label: p.label,
        ...(p.unit ? { unit: p.unit } : {}),
      })),
    },
  );
}

// ── objective-bound template definition ─────────────────────────────────────────────────────────

type Bind<A> = Omit<A, "input" | "templateId" | "version" | "rng">;
type ArgsOf<F> = F extends (a: infer A) => GeneratedQuestion ? A : never;

export interface Builders {
  numeric: (a: Bind<ArgsOf<typeof numericQuestion>>) => GeneratedQuestion;
  unit: (a: Bind<ArgsOf<typeof unitQuestion>>) => GeneratedQuestion;
  mcq: (a: Bind<ArgsOf<typeof mcqQuestion>>) => GeneratedQuestion;
  trueFalse: (a: Bind<ArgsOf<typeof trueFalseQuestion>>) => GeneratedQuestion;
  ordering: (a: Bind<ArgsOf<typeof orderingQuestion>>) => GeneratedQuestion;
  list: (a: Bind<ArgsOf<typeof listQuestion>>) => GeneratedQuestion;
  matching: (a: Bind<ArgsOf<typeof matchingQuestion>>) => GeneratedQuestion;
  text: (a: Bind<ArgsOf<typeof textQuestion>>) => GeneratedQuestion;
  fraction: (a: Bind<ArgsOf<typeof fractionQuestion>>) => GeneratedQuestion;
  expression: (a: Bind<ArgsOf<typeof expressionQuestion>>) => GeneratedQuestion;
  multiPart: (a: Bind<ArgsOf<typeof multiPartQuestion>>) => GeneratedQuestion;
}

export interface Ctx extends TemplateInput {
  q: Builders;
}

function builders(input: TemplateInput, templateId: string, version: number): Builders {
  const base = { input, templateId, version, rng: input.rng };
  const bind =
    <A>(build: (a: A) => GeneratedQuestion) =>
    (a: object): GeneratedQuestion =>
      build({ ...base, ...a } as unknown as A);
  return {
    numeric: bind(numericQuestion),
    unit: bind(unitQuestion),
    mcq: bind(mcqQuestion),
    trueFalse: bind(trueFalseQuestion),
    ordering: bind(orderingQuestion),
    list: bind(listQuestion),
    matching: bind(matchingQuestion),
    text: bind(textQuestion),
    fraction: bind(fractionQuestion),
    expression: bind(expressionQuestion),
    multiPart: bind(multiPartQuestion),
  };
}

export function defineTemplate(def: {
  id: string;
  version?: number;
  description: string;
  covers: (objective: ObjectiveInfo) => boolean;
  levels?: readonly Difficulty[];
  generate: (ctx: Ctx) => GeneratedQuestion;
}): QuestionTemplate {
  const version = def.version ?? 1;
  return {
    id: def.id,
    version,
    description: def.description,
    covers: def.covers,
    ...(def.levels ? { levels: def.levels } : {}),
    generate: (input) => def.generate({ ...input, q: builders(input, def.id, version) }),
  };
}

// ── numbers ─────────────────────────────────────────────────────────────────────────────────────

/** A few near-miss integers around `n`, never equal to it and never negative. */
export function nearMisses(rng: Rng, n: number, count = 4): number[] {
  const candidates = new Set<number>();
  const steps = [1, 2, 10, 100, 1000].filter((s) => s <= Math.max(1, Math.abs(n)) * 2 || s === 1);
  let guard = 0;
  while (candidates.size < count && guard++ < 50) {
    const step = rng.pick(steps);
    const candidate = n + (rng.chance(0.5) ? step : -step) * rng.int(1, 2);
    if (candidate !== n && candidate >= 0) candidates.add(candidate);
  }
  return [...candidates];
}

/** Digits of n, most significant first. */
export const digitsOf = (n: number | bigint): number[] => [...n.toString()].map(Number);

export const PLACE_NAMES = [
  "ones",
  "tens",
  "hundreds",
  "thousands",
  "ten thousands",
  "hundred thousands",
  "millions",
  "ten millions",
] as const;

export function placeName(index: number): string {
  return PLACE_NAMES[index] ?? `10^${index}`;
}

/** Put the elements of a list in a sentence: "a, b and c". */
export function joinWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export const sentenceCase = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
