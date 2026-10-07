import { normaliseText, type MarkResult } from "../marking/mark";
import { parseLearnerNumber } from "../marking/numbers";
import type { LearnerAnswer } from "../marking/spec";

/**
 * Deterministic misconception diagnosis: which structured misconception does this wrong answer
 * point at? No language model is involved.
 *
 * Two sources, in order:
 *  1. the question's `distractor_map`: wrong answers the question's generator PREDICTED, each tagged
 *     (for example the sum you get by forgetting to carry → CARRYING_ERROR), keyed by the answer's
 *     canonical form so "524", " 524 " and "524.0" are the same key;
 *  2. a generic fallback from the marker's signals: an answer a power of ten away from the right one
 *     is a unit, decimal-place, place-value or time slip depending on the kind of question.
 *
 * Only tags the question declares it can produce are ever returned.
 */

export interface DiagnosisInput {
  /** canonical wrong answer → misconception code. For multi-part questions the key is "<partId>:<answer>". */
  distractorMap: Record<string, string>;
  /** What the question is about, for the power-of-ten fallback. */
  solutionKind?: string | undefined;
  /** The tags this question may produce (questions.misconception_tags). */
  candidateTags: readonly string[];
}

/** The canonical lookup key for a typed answer: its exact numeric value if it is a number, else normalised text. */
export function canonicalKey(text: string): string {
  const parsed = parseLearnerNumber(text);
  if (parsed.ok && parsed.value.form !== "words") return parsed.value.candidates[0]!.toString();
  return normaliseText(text);
}

function keysFor(answer: LearnerAnswer): string[] {
  if (typeof answer === "string") {
    const parsed = parseLearnerNumber(answer);
    if (parsed.ok && parsed.value.form !== "words")
      return parsed.value.candidates.map((c) => c.toString());
    return [normaliseText(answer), answer.trim().toUpperCase()]; // text, or an option letter
  }
  if (typeof answer === "boolean") return [String(answer)];
  if (Array.isArray(answer)) return [answer.map((a) => canonicalKey(String(a))).join("|")];
  return [];
}

const POWER_OF_TEN_TAG: Record<string, string> = {
  "unit-conversion": "UNIT_CONVERSION_ERROR",
  "time-conversion": "TIME_CONVERSION_ERROR",
  "decimal-places": "DECIMAL_PLACE_CONFUSION",
  "place-value": "PLACE_VALUE_CONFUSION",
};

function singleAnswerTags(
  input: DiagnosisInput,
  result: MarkResult,
  answer: LearnerAnswer,
  prefix = "",
): string[] {
  const tags: string[] = [];
  for (const key of keysFor(answer)) {
    const tag = input.distractorMap[`${prefix}${key}`];
    if (tag) {
      tags.push(tag);
      break;
    }
  }
  if (tags.length === 0 && result.signals.includes("OFF_BY_POWER_OF_TEN") && input.solutionKind) {
    const tag = POWER_OF_TEN_TAG[input.solutionKind];
    if (tag) tags.push(tag);
  }
  return tags;
}

export function diagnose(
  input: DiagnosisInput,
  result: MarkResult,
  answer: LearnerAnswer,
): string[] {
  if (result.status !== "INCORRECT") return [];
  const allowed = new Set(input.candidateTags);
  const found: string[] = [];

  if (result.parts && typeof answer === "object" && answer !== null && !Array.isArray(answer)) {
    for (const [id, part] of Object.entries(result.parts)) {
      if (part.status !== "INCORRECT") continue;
      const partAnswer = (answer as Record<string, LearnerAnswer>)[id] ?? "";
      found.push(...singleAnswerTags(input, part, partAnswer, `${id}:`));
    }
  } else {
    found.push(...singleAnswerTags(input, result, answer));
  }
  return [...new Set(found)].filter((tag) => allowed.has(tag));
}
