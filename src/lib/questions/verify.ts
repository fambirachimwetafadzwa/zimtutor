import { mark } from "../marking/mark";
import type { LearnerAnswer } from "../marking/spec";
import { canonicalKey, diagnose } from "../misconceptions/diagnose";
import { fmtDecimal } from "./kit";
import type { GeneratedQuestion } from "./types";

/**
 * Independent checks on a generated question — run for EVERY question before it is served, and for
 * thousands of generated questions in the test suite.
 *
 *  1. SELF-CONSISTENCY: marking the question's own correct answer against its own key must say
 *     CORRECT, and every wrong answer it predicted must be marked INCORRECT and diagnosed with the
 *     tag the question declared. (A template whose arithmetic disagrees with its key can never reach
 *     a learner.)
 *  2. NO LEAKS: no hint may state the answer. Hints exist to help without giving it away.
 */

export interface Problem {
  code:
    | "KEY_REJECTS_ITS_OWN_ANSWER"
    | "WRONG_ANSWER_MARKED_RIGHT"
    | "DISTRACTOR_NOT_DIAGNOSED"
    | "HINT_LEAKS_ANSWER"
    | "ITEMS_DO_NOT_MATCH_KEY"
    | "ITEMS_ALREADY_IN_ORDER"
    | "COLUMNS_DO_NOT_MATCH_KEY"
    | "OPTION_TEXT_IS_ANSWER_LEAK";
  detail: string;
}

/** Turn a canonical distractor key back into something a learner could submit for this question. */
function submissionFor(question: GeneratedQuestion, key: string): LearnerAnswer | null {
  if (question.marking.method === "MULTI_PART") {
    const [partId, ...rest] = key.split(":");
    if (!partId || rest.length === 0) return null;
    const correct = question.correctAnswer;
    if (typeof correct !== "object" || correct === null || Array.isArray(correct)) return null;
    return { ...(correct as Record<string, LearnerAnswer>), [partId]: rest.join(":") };
  }
  if (question.marking.method === "ORDERED_SEQUENCE") return key.split("|");
  if (question.marking.method === "TRUE_FALSE") return key === "true";
  return key;
}

export function selfCheck(question: GeneratedQuestion): Problem[] {
  const problems: Problem[] = [];
  const own = mark(question.marking, question.correctAnswer);
  if (own.status !== "CORRECT") {
    problems.push({
      code: "KEY_REJECTS_ITS_OWN_ANSWER",
      detail: `marking the correct answer ${JSON.stringify(question.correctAnswer)} gave ${own.status}`,
    });
  }
  for (const [key, tag] of Object.entries(question.distractorMap)) {
    const submitted = submissionFor(question, key);
    if (submitted === null) continue;
    const result = mark(question.marking, submitted);
    if (result.status === "CORRECT") {
      problems.push({
        code: "WRONG_ANSWER_MARKED_RIGHT",
        detail: `predicted wrong answer ${JSON.stringify(key)} (${tag}) is marked correct`,
      });
      continue;
    }
    if (result.status !== "INCORRECT") continue; // e.g. ALMOST: a presentation slip, not a misconception
    const tags = diagnose(
      {
        distractorMap: question.distractorMap,
        solutionKind: question.solutionKind,
        candidateTags: question.misconceptionTags,
      },
      result,
      submitted,
    );
    if (!tags.includes(tag))
      problems.push({
        code: "DISTRACTOR_NOT_DIAGNOSED",
        detail: `wrong answer ${JSON.stringify(key)} should be diagnosed as ${tag}, got [${tags.join(", ")}]`,
      });
  }
  return problems;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The strings that would give the answer away if a hint contained them. */
export function answerForms(question: GeneratedQuestion): string[] {
  const forms = new Set<string>();
  const add = (text: string) => {
    const t = text.trim();
    if (t.length >= 2) {
      forms.add(t);
      forms.add(t.replace(/\s+/g, ""));
    }
  };
  const answer = question.correctAnswer;
  const addNumber = (text: string) => {
    add(text);
    // Large numbers are printed with spaces ("4 305"); a hint that writes it that way leaks it too.
    if (/^\d{4,}(\.\d+)?$/.test(text.trim())) add(fmtDecimal(text.trim()));
  };
  if (question.marking.method === "MULTIPLE_CHOICE") {
    const correct = question.options?.find(
      (o) =>
        question.marking.method === "MULTIPLE_CHOICE" && question.marking.correct.includes(o.id),
    );
    if (correct) add(correct.text);
    return [...forms];
  }
  if (typeof answer === "string") {
    // "250 cm" → the number; "3/4" → itself; "five" → itself
    const numeric = /^(-?[\d\s.,/]+)/.exec(answer);
    addNumber(numeric ? numeric[1]!.trim() : answer);
    add(answer);
  } else if (Array.isArray(answer)) {
    add(answer.join(", "));
  } else if (typeof answer === "object" && answer !== null) {
    for (const value of Object.values(answer)) if (typeof value === "string") add(value);
  }
  return [...forms];
}

export function hintLeaks(question: GeneratedQuestion): Problem[] {
  const problems: Problem[] = [];
  for (const form of answerForms(question)) {
    const pattern = new RegExp(`(?<![\\w.,/])${escapeRegExp(form)}(?![\\w]|[.,]\\d|/\\d)`, "i");
    question.hints.forEach((hint, i) => {
      if (pattern.test(hint))
        problems.push({
          code: "HINT_LEAKS_ANSWER",
          detail: `hint ${i + 1} contains the answer "${form}": ${hint}`,
        });
    });
  }
  return problems;
}

const sameSet = (a: string[], b: string[]): boolean => {
  const x = [...a].map(canonicalKey).sort();
  const y = [...b].map(canonicalKey).sort();
  return x.length === y.length && x.every((value, i) => value === y[i]);
};

/** What the interface will draw must agree with the answer key (the items to order, the two columns). */
export function structureCheck(question: GeneratedQuestion): Problem[] {
  const problems: Problem[] = [];
  const key = question.marking;
  if (question.type === "ORDERING" && key.method === "ORDERED_SEQUENCE") {
    if (!question.items || !sameSet(question.items, key.sequence))
      problems.push({
        code: "ITEMS_DO_NOT_MATCH_KEY",
        detail: "the items to arrange are not the items of the answer key",
      });
    else if (
      question.items.every((item, i) => canonicalKey(item) === canonicalKey(key.sequence[i]!))
    )
      problems.push({
        code: "ITEMS_ALREADY_IN_ORDER",
        detail: "the items are shown already in the answer order",
      });
  }
  if (key.method === "MATCHING_PAIRS") {
    const m = question.matching;
    if (
      !m ||
      !sameSet(m.left, Object.keys(key.pairs)) ||
      !sameSet(m.right, Object.values(key.pairs))
    )
      problems.push({
        code: "COLUMNS_DO_NOT_MATCH_KEY",
        detail: "the two columns are not the pairs of the answer key",
      });
  }
  return problems;
}

export function verifyQuestion(question: GeneratedQuestion): Problem[] {
  return [...selfCheck(question), ...hintLeaks(question), ...structureCheck(question)];
}
