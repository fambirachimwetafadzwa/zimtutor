import type { MarkStatus } from "../marking/mark";
import type { MasteryState } from "../mastery/engine";
import type { TransitionDecision } from "./moves";
import type { LessonMode, OpenQuestion } from "./state";

/**
 * The tutoring rules, as plain functions of counters. Nothing here calls a model, a database or the
 * clock; the numbers are named so they can be reviewed and changed in one place.
 */

export const POLICY = {
  /** Wrong answers to one question before the tutor works it through with the child. */
  maxWrongAttempts: 3,
  /** "Nearly right" answers (right value, wrong presentation) that cost nothing; after this they count as wrong. */
  maxAlmost: 3,
  /** Questions in one sitting before the tutor suggests a rest. */
  questionsPerSession: 8,
  /** A review of something already mastered is short. */
  reviewQuestions: 3,
  /** A foundation check is shorter still. */
  foundationQuestions: 3,
  /** Questions a child may skip in one sitting (skipping leaves no mark on mastery either way). */
  skipsPerSession: 2,
  /** Wrong answers in a row (resolved questions) before the tutor offers an easier question or a break. */
  wrongRunBeforeBreak: 3,
  /** Resolved questions at DEVELOPING before moving on is offered. */
  advanceAfter: 5,
  /** A session left alone this long is closed the next time the goal is opened. */
  idleMinutes: 120,
} as const;

/**
 * May the tutor show the answer? Never to a child who has not tried, and never as the first reaction
 * to "I'm stuck": a hint comes first. After one wrong try and a hint (or when the question has no
 * hints), or after two wrong tries, the tutor works the question through with them.
 */
export function mayRevealAnswer(
  q: Pick<OpenQuestion, "wrongAttempts" | "hintsUsed" | "hintCount">,
): boolean {
  if (q.wrongAttempts >= 2) return true;
  return q.wrongAttempts >= 1 && (q.hintsUsed >= 1 || q.hintCount === 0);
}

export type SubmissionOutcome =
  | "CORRECT"
  /** Wrong; the child may try again. */
  | "WRONG"
  /** Wrong, and it was the last try. */
  | "EXHAUSTED"
  /** The right idea in the wrong form: try again, nothing lost. */
  | "ALMOST"
  /** Nothing markable was given (empty, not a number): ask again, nothing lost. */
  | "UNREADABLE"
  /** The question cannot be marked by machine; it is set aside, never held against the child. */
  | "UNMARKABLE";

/** Apply one marked answer to the open question's counters. */
export function applySubmission(
  q: OpenQuestion,
  status: MarkStatus,
  tags: readonly string[],
): { question: OpenQuestion; outcome: SubmissionOutcome } {
  if (status === "INVALID_INPUT") return { question: q, outcome: "UNREADABLE" };
  if (status === "NEEDS_REVIEW") return { question: q, outcome: "UNMARKABLE" };
  if (status === "CORRECT")
    return { question: { ...q, submissions: q.submissions + 1 }, outcome: "CORRECT" };
  if (status === "ALMOST" && q.almost < POLICY.maxAlmost)
    return {
      question: { ...q, submissions: q.submissions + 1, almost: q.almost + 1 },
      outcome: "ALMOST",
    };
  // wrong (or too many near misses in a row): one of the child's tries is used up
  const wrongAttempts = q.wrongAttempts + 1;
  return {
    question: {
      ...q,
      submissions: q.submissions + 1,
      almost: status === "ALMOST" ? q.almost + 1 : q.almost,
      wrongAttempts,
      tags: [...q.tags, ...tags.filter((t) => !q.tags.includes(t))],
    },
    outcome: wrongAttempts >= POLICY.maxWrongAttempts ? "EXHAUSTED" : "WRONG",
  };
}

export interface TransitionInput {
  mode: LessonMode;
  /** Questions resolved in this session, counting the one just resolved. */
  resolved: number;
  /** Wrong answers in a row at the end of the session so far. */
  wrongInARow: number;
  stateBefore: MasteryState;
  stateAfter: MasteryState;
  lastWasCorrect: boolean;
}

/** After a question is resolved and mastery updated: what does the tutor offer next? */
export function chooseTransition(input: TransitionInput): TransitionDecision {
  const { mode, resolved, stateBefore, stateAfter } = input;
  const wasMastered = stateBefore === "MASTERED" || stateBefore === "REVIEW";
  if (stateAfter === "MASTERED" && !wasMastered) return "MASTERED";
  if (input.wrongInARow >= POLICY.wrongRunBeforeBreak) return "EASIER_OR_BREAK";
  if (mode === "REVIEW" && resolved >= POLICY.reviewQuestions) return "SESSION_DONE";
  if (mode === "FOUNDATION" && resolved >= POLICY.foundationQuestions) return "SESSION_DONE";
  if (resolved >= POLICY.questionsPerSession) return "SESSION_DONE";
  if (stateAfter === "DEVELOPING" && resolved >= POLICY.advanceAfter && input.lastWasCorrect)
    return "ADVANCE";
  return input.lastWasCorrect ? "NEXT_QUESTION" : "KEEP_PRACTISING";
}

/** Does this decision end the sitting? */
export const endsSession = (d: TransitionDecision): boolean =>
  d === "MASTERED" || d === "SESSION_DONE";

// ── what a typed message means ──────────────────────────────────────────────────────────────────

export type Intent = "SHOW_ANSWER" | "STOP" | "SKIP" | "EXPLAIN_AGAIN" | "HINT" | "OTHER";

const INTENTS: ReadonlyArray<readonly [Intent, RegExp]> = [
  [
    "SHOW_ANSWER",
    /\b(?:show|tell|give)\s+me\s+(?:the\s+)?(?:answer|solution)\b|\bwhat(?:'s|\s+is)\s+the\s+answer\b|\bi\s+give\s+up\b|\bgive\s+up\b|\b(?:work|solve)\s+it\s+(?:out\s+)?for\s+me\b/i,
  ],
  [
    "STOP",
    /\b(?:stop|finish|quit|bye|goodbye|end\s+(?:the\s+)?(?:lesson|session)|i(?:'m|\s+am)\s+done|i\s+want\s+to\s+stop)\b/i,
  ],
  ["SKIP", /\b(?:skip|next\s+question|another\s+question|different\s+question|too\s+hard)\b/i],
  [
    "EXPLAIN_AGAIN",
    /\b(?:explain|i\s+don'?t\s+(?:understand|get)|don'?t\s+get\s+it|do\s+not\s+understand|confused|show\s+me\s+(?:how|an\s+example)|example)\b/i,
  ],
  ["HINT", /\b(?:hint|stuck|help)\b/i],
];

/** Plain words that mean a button the child could have pressed. Anything else is a question for the tutor. */
export function classifyIntent(text: string): Intent {
  for (const [intent, pattern] of INTENTS) if (pattern.test(text)) return intent;
  return "OTHER";
}
