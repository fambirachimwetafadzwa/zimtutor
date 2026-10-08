import { mark, type MarkResult } from "../marking/mark";
import type { LearnerAnswer } from "../marking/spec";
import { diagnose } from "../misconceptions/diagnose";
import type { QuestionKey } from "./bank-rows";

/**
 * Checking an answer: deterministic, from the stored key. The marking engine says whether the answer
 * is right (a language model is never asked), and the misconception diagnosis names the slip from the
 * question's own table of predicted wrong answers.
 */

export interface CheckedAnswer {
  result: MarkResult;
  /** Misconceptions the wrong answer shows (empty when it is right or the slip is not one we predicted). */
  tags: string[];
}

export function checkAnswer(key: QuestionKey, answer: LearnerAnswer): CheckedAnswer {
  const result = mark(key.spec, answer);
  const tags = diagnose(
    {
      distractorMap: key.distractorMap,
      solutionKind: key.solutionKind,
      candidateTags: key.candidateTags,
    },
    result,
    answer,
  );
  return { result, tags };
}

/** The hint to give after `used` hints have already been given, or null when they are all used up. */
export function nextHint(key: QuestionKey, used: number): string | null {
  return key.hints[used] ?? null;
}
