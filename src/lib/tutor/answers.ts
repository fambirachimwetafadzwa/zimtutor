import { detectPersonalDetails, redact } from "../ai/patterns";
import type { LearnerAnswer, MarkingSpec } from "../marking/spec";
import type { PublicQuestion } from "../questions/bank-rows";

/**
 * Answers as words: the right answer shown once a question is worked through, and what the child
 * answered as it appears in their conversation. Also the one place that decides what of a child's
 * answer is kept: a free-text answer box must not become somewhere to store a phone number.
 */

type Shape = Pick<PublicQuestion, "options" | "matching" | "answerFields">;

const MAX_TEXT = 200;
const MAX_ITEMS = 30;

const labelOf = (shape: Shape, id: string): string =>
  shape.answerFields?.find((f) => f.id === id)?.label ?? id;

const unitOf = (shape: Shape, id: string): string => {
  const unit = shape.answerFields?.find((f) => f.id === id)?.unit;
  return unit ? ` ${unit}` : "";
};

function partsText(answer: Record<string, LearnerAnswer>, shape: Shape): string {
  return Object.entries(answer)
    .map(([id, value]) => `${labelOf(shape, id)}: ${plain(value, shape)}${unitOf(shape, id)}`)
    .join("; ");
}

function plain(value: LearnerAnswer, shape: Shape): string {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "True" : "False";
  if (Array.isArray(value)) return value.join(", ");
  return partsText(value, shape);
}

/** The right answer, in words a child can read. For multiple choice it is the option's text. */
export function answerAsText(
  key: { spec: MarkingSpec; display: LearnerAnswer },
  shape: Shape,
): string {
  const { spec, display } = key;
  if (spec.method === "MULTIPLE_CHOICE") {
    const texts = spec.correct.map((id) => shape.options?.find((o) => o.id === id)?.text ?? id);
    return texts.join(" or ");
  }
  if (spec.method === "TRUE_FALSE") return spec.value ? "True" : "False";
  if (spec.method === "MATCHING_PAIRS")
    return Object.entries(spec.pairs)
      .map(([left, right]) => `${left} → ${right}`)
      .join("; ");
  if (typeof display === "object" && display !== null && !Array.isArray(display))
    return partsText(display, shape);
  return plain(display, shape);
}

/** What the child answered, for the conversation record. Personal details are removed. */
export function describeLearnerAnswer(answer: LearnerAnswer, shape: Shape): string {
  let text: string;
  if (typeof answer === "string") {
    const option = shape.options?.find((o) => o.id === answer.trim());
    text = option ? `${option.id}. ${option.text}` : answer.trim();
  } else if (typeof answer === "boolean") {
    text = answer ? "True" : "False";
  } else if (Array.isArray(answer)) {
    text = answer.slice(0, MAX_ITEMS).join(" → ");
  } else if (shape.matching) {
    text = Object.entries(answer)
      .slice(0, MAX_ITEMS)
      .map(([left, right]) => `${left} → ${plain(right, shape)}`)
      .join("; ");
  } else {
    text = partsText(answer, shape);
  }
  text = text.slice(0, MAX_TEXT * 2);
  return redact(text, detectPersonalDetails(text)).slice(0, MAX_TEXT * 2);
}

/** The answer as it is stored with the attempt: same shape, personal details removed, sizes capped. */
export function answerForStorage(answer: LearnerAnswer): LearnerAnswer {
  if (typeof answer === "string") {
    const text = answer.slice(0, MAX_TEXT);
    return redact(text, detectPersonalDetails(text));
  }
  if (typeof answer === "boolean") return answer;
  if (Array.isArray(answer))
    return answer.slice(0, MAX_ITEMS).map((a) => answerForStorage(a) as string);
  return Object.fromEntries(
    Object.entries(answer)
      .slice(0, MAX_ITEMS)
      .map(([key, value]) => [key.slice(0, 60), answerForStorage(value)]),
  );
}

/** Is this answer a sensible size to mark and keep? (An answer box is not a place to paste a book.) */
export function answerIsReasonable(answer: LearnerAnswer): boolean {
  return JSON.stringify(answer).length <= 2000;
}
