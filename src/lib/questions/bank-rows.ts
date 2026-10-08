import { z } from "zod";
import {
  markingSpecSchema,
  type LearnerAnswer,
  type MarkingMethod,
  type MarkingSpec,
} from "../marking/spec";
import { SOURCE_TYPE_INFO, type SourceType } from "../supplemental/rules";
import type { VerifiedQuestion } from "./generate";
import {
  ASSESSMENT_SKILLS,
  QUESTION_TYPES,
  learnerAnswerSchema,
  stemDataSchema,
  type AssessmentSkill,
  type Difficulty,
  type QuestionType,
  type StemData,
} from "./types";

/**
 * How a generated question is kept in the database and what part of it a learner may see.
 *
 * Two tables hold it: `questions` (what the screen shows: readable by administrators only) and
 * `question_keys` (the answer key, the hints and the explanation: readable by the server alone). A
 * learner's screen is therefore always built from `toPublicQuestion`, which cannot leak a key because
 * it never receives one.
 *
 * Everything here is pure, so it can be tested without a database.
 */

// ── labelling ───────────────────────────────────────────────────────────────────────────────────

/** Questions made by ZimTutor are supplemental practice, never official, until a person reviews them. */
export const BANK_SOURCE = {
  sourceType: "SUPPLEMENTAL",
  verificationStatus: "UNVERIFIED",
} as const;

export interface ContentLabel {
  sourceType: SourceType;
  verificationStatus: string;
  /** Short text for the screen. */
  text: string;
  official: boolean;
}

/** The label a learner sees on a question: the five content categories are never shown as one. */
export function contentLabel(sourceType: string, verificationStatus: string): ContentLabel {
  const info = SOURCE_TYPE_INFO[sourceType as SourceType];
  const official = sourceType === "OFFICIAL_CURRICULUM" || sourceType === "OFFICIAL_ASSESSMENT";
  const reviewed =
    verificationStatus === "ADMIN_REVIEWED" || verificationStatus === "VERIFIED_FROM_SOURCE";
  return {
    sourceType: (info ? sourceType : "UNVERIFIED") as SourceType,
    verificationStatus,
    official,
    text: official
      ? info!.label
      : sourceType === "SUPPLEMENTAL"
        ? reviewed
          ? "ZimTutor practice question (checked by a teacher)"
          : "ZimTutor practice question (not part of the syllabus)"
        : (info?.label ?? "Unverified"),
  };
}

// ── what is stored ──────────────────────────────────────────────────────────────────────────────

/** The helpers a screen needs besides the stem. None of them tells the answer. */
export const presentationSchema = z.object({
  items: z.array(z.string()).optional(),
  matching: z.object({ left: z.array(z.string()), right: z.array(z.string()) }).optional(),
  answerFields: z
    .array(z.object({ id: z.string(), label: z.string(), unit: z.string().optional() }))
    .optional(),
  answerHint: z.string().optional(),
});
export type Presentation = z.infer<typeof presentationSchema>;

export const GENERATOR_PREFIX = "template:";

export function generatorName(q: Pick<VerifiedQuestion, "templateId" | "templateVersion">): string {
  return `${GENERATOR_PREFIX}${q.templateId}@${q.templateVersion}`;
}

export function parseGenerator(generator: string): { templateId: string; version: number } | null {
  const match = /^template:([a-z0-9.-]+)@(\d+)$/.exec(generator);
  return match ? { templateId: match[1]!, version: Number(match[2]) } : null;
}

/** The two JSON documents `bank_save_question(question, key)` takes. */
export interface BankInsert {
  question: {
    learning_objective_id: string;
    difficulty: number;
    question_type: QuestionType;
    assessment_skill: AssessmentSkill;
    stem: string;
    stem_data: StemData | Record<string, never>;
    options: Array<{ id: string; text: string }> | null;
    marking_method: MarkingMethod;
    misconception_tags: string[];
    uses_local_context: boolean;
    source_type: typeof BANK_SOURCE.sourceType;
    verification_status: typeof BANK_SOURCE.verificationStatus;
    generator: string;
    generator_seed: string;
    presentation: Presentation;
    content_hash: string;
  };
  key: {
    expected_answer: { spec: MarkingSpec; display: LearnerAnswer };
    explanation: string;
    hints: string[];
    solution_steps: string[] | null;
    solution_spec: { kind: string } | null;
    distractor_map: Record<string, string>;
  };
}

export function toBankInsert(q: VerifiedQuestion): BankInsert {
  const presentation: Presentation = {
    ...(q.items ? { items: q.items } : {}),
    ...(q.matching ? { matching: q.matching } : {}),
    ...(q.answerFields ? { answerFields: q.answerFields } : {}),
    ...(q.answerHint ? { answerHint: q.answerHint } : {}),
  };
  return {
    question: {
      learning_objective_id: q.objectiveId,
      difficulty: q.difficulty,
      question_type: q.type,
      assessment_skill: q.assessmentSkill,
      stem: q.stem,
      stem_data: q.stemData ?? {},
      options: q.options ?? null,
      marking_method: q.marking.method,
      misconception_tags: q.misconceptionTags,
      uses_local_context: q.usesLocalContext,
      source_type: BANK_SOURCE.sourceType,
      verification_status: BANK_SOURCE.verificationStatus,
      generator: generatorName(q),
      generator_seed: q.seed,
      presentation,
      content_hash: q.contentHash,
    },
    key: {
      expected_answer: { spec: q.marking, display: q.correctAnswer },
      explanation: q.explanation,
      hints: q.hints,
      solution_steps: q.solutionSteps ?? null,
      solution_spec: q.solutionKind ? { kind: q.solutionKind } : null,
      distractor_map: q.distractorMap,
    },
  };
}

// ── reading back ────────────────────────────────────────────────────────────────────────────────

/** Columns of `questions` the application reads (never the hash or the seed). */
export const QUESTION_COLUMNS =
  "id, learning_objective_id, grade, topic_code, subtopic_id, difficulty, question_type, assessment_skill, stem, stem_data, options, marking_method, misconception_tags, uses_local_context, source_type, verification_status, generator, status, presentation";

export const storedQuestionSchema = z.object({
  id: z.string(),
  learning_objective_id: z.string(),
  grade: z.number().int(),
  topic_code: z.enum(["NUM", "OPS", "MEA", "REL"]),
  subtopic_id: z.string(),
  difficulty: z.number().int().min(1).max(5),
  question_type: z.enum(QUESTION_TYPES),
  assessment_skill: z.enum(ASSESSMENT_SKILLS),
  stem: z.string(),
  stem_data: z.record(z.string(), z.unknown()).nullable(),
  options: z.array(z.object({ id: z.string(), text: z.string() })).nullable(),
  marking_method: z.string(),
  misconception_tags: z.array(z.string()),
  uses_local_context: z.boolean(),
  source_type: z.string(),
  verification_status: z.string(),
  generator: z.string(),
  status: z.string(),
  presentation: z.record(z.string(), z.unknown()).nullable(),
});
export type StoredQuestion = z.infer<typeof storedQuestionSchema>;

/** The form a child answers in. */
export const ANSWER_KINDS = ["CHOICE", "TRUE_FALSE", "ORDER", "MATCH", "BOXES", "TEXT"] as const;
export type AnswerKind = (typeof ANSWER_KINDS)[number];

/**
 * Which form a child answers in. It follows how the question is MARKED, not what it is about: a clock
 * question is a "visual diagram" and may still be multiple choice; a word problem may be true or
 * false. (`items` exist only for ordering, `matching` only for matching, `answerFields` only for
 * multi-part marking, `options` only for multiple-choice marking: the question schema enforces it.)
 */
export function answerKindOf(markingMethod: string, presentation: Presentation): AnswerKind {
  switch (markingMethod) {
    case "MULTIPLE_CHOICE":
      return "CHOICE";
    case "TRUE_FALSE":
      return "TRUE_FALSE";
    case "MATCHING_PAIRS":
      return "MATCH";
    case "MULTI_PART":
      return "BOXES";
    case "ORDERED_SEQUENCE":
      // arranged with the arrows when there are items to arrange, otherwise typed ("2, 4, 6")
      return presentation.items ? "ORDER" : "TEXT";
    default:
      return "TEXT";
  }
}

/** What a learner's screen is given. There is no field for an answer, a hint or an explanation. */
export interface PublicQuestion {
  id: string;
  objectiveId: string;
  grade: number;
  difficulty: Difficulty;
  type: QuestionType;
  /** Which form to answer in (how the question is marked, not its category). */
  answerKind: AnswerKind;
  skill: AssessmentSkill;
  stem: string;
  stemData?: StemData;
  options?: Array<{ id: string; text: string }>;
  items?: string[];
  matching?: { left: string[]; right: string[] };
  answerFields?: Array<{ id: string; label: string; unit?: string }>;
  answerHint?: string;
  usesLocalContext: boolean;
  label: ContentLabel;
}

export function toPublicQuestion(row: StoredQuestion): PublicQuestion {
  const presentation = presentationSchema.parse(row.presentation ?? {});
  const hasPicture = row.stem_data && Object.keys(row.stem_data).length > 0;
  const stemData = hasPicture ? stemDataSchema.parse(row.stem_data) : undefined;
  return {
    id: row.id,
    objectiveId: row.learning_objective_id,
    grade: row.grade,
    difficulty: row.difficulty as Difficulty,
    type: row.question_type,
    answerKind: answerKindOf(row.marking_method, presentation),
    skill: row.assessment_skill,
    stem: row.stem,
    ...(stemData ? { stemData } : {}),
    ...(row.options ? { options: row.options.map((o) => ({ id: o.id, text: o.text })) } : {}),
    ...(presentation.items ? { items: presentation.items } : {}),
    ...(presentation.matching ? { matching: presentation.matching } : {}),
    ...(presentation.answerFields ? { answerFields: presentation.answerFields } : {}),
    ...(presentation.answerHint ? { answerHint: presentation.answerHint } : {}),
    usesLocalContext: row.uses_local_context,
    label: contentLabel(row.source_type, row.verification_status),
  };
}

export const storedKeySchema = z.object({
  question_id: z.string(),
  expected_answer: z.object({ spec: markingSpecSchema, display: learnerAnswerSchema }),
  explanation: z.string(),
  hints: z.array(z.string()),
  solution_steps: z.array(z.string()).nullable(),
  solution_spec: z.object({ kind: z.string() }).nullable(),
  distractor_map: z.record(z.string(), z.string()),
});
export type StoredKey = z.infer<typeof storedKeySchema>;
export const KEY_COLUMNS =
  "question_id, expected_answer, explanation, hints, solution_steps, solution_spec, distractor_map";

/** Everything the server needs to mark an answer and respond to it. NEVER sent to a learner's screen. */
export interface QuestionKey {
  questionId: string;
  objectiveId: string;
  difficulty: Difficulty;
  type: QuestionType;
  spec: MarkingSpec;
  /** The right answer as a learner would write it (shown once the question is resolved). */
  display: LearnerAnswer;
  explanation: string;
  /** Gentlest first; released one at a time. */
  hints: string[];
  solutionSteps: string[];
  distractorMap: Record<string, string>;
  solutionKind?: string;
  /** The misconceptions this question can show (questions.misconception_tags). */
  candidateTags: string[];
}

export function toQuestionKey(question: StoredQuestion, key: StoredKey): QuestionKey {
  return {
    questionId: question.id,
    objectiveId: question.learning_objective_id,
    difficulty: question.difficulty as Difficulty,
    type: question.question_type,
    spec: key.expected_answer.spec,
    display: key.expected_answer.display,
    explanation: key.explanation,
    hints: key.hints,
    solutionSteps: key.solution_steps ?? [],
    distractorMap: key.distractor_map,
    ...(key.solution_spec ? { solutionKind: key.solution_spec.kind } : {}),
    candidateTags: question.misconception_tags,
  };
}
