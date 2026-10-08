import type { SecretAnswer, Verdict } from "../ai/guards";
import type { MarkSignal } from "../marking/mark";
import type { Difficulty } from "../mastery/engine";

/**
 * A MOVE is one thing the tutor does, decided entirely by the application: introduce the goal, show an
 * example, set a question, give the next hint, react to an answer, correct a mistake, say what comes
 * next. A move holds FACTS (the objective's wording, the numbers, the verdict, the misconception) and no
 * prose. A VOICE (src/lib/tutor/voice.ts) turns a move into words — plain template text, or text a
 * language model has rephrased inside the guards.
 *
 * Moves live on the server only: a move may carry the answer to an open question (`secret`) so the
 * guards can refuse any reply that gives it away.
 */

export type LessonMode = "LEARN" | "PRACTISE" | "REVIEW" | "FOUNDATION";

/** The objective, as the syllabus prints it. Everything here is OFFICIAL_CURRICULUM text. */
export interface ObjectiveFacts {
  id: string;
  text: string;
  grade: number;
  topicName: string;
  subtopicName: string;
  /** The row's Content column, one item per entry. */
  content: readonly string[];
  /** The row's Teaching/Learning activities column. */
  activities: readonly string[];
  /** Where the syllabus prints it, for the citation shown with its words. */
  source: { title: string; page: number | null; pageLabel: string | null };
}

export interface MisconceptionFacts {
  code: string;
  name: string;
  /** A first nudge in learner language that never gives the answer. */
  nudge: string;
}

/** A question worked through for the learner. The answer is shown on purpose. */
export interface WorkedExampleFacts {
  stem: string;
  steps: readonly string[];
  explanation: string;
  answer: string;
}

export type TransitionDecision =
  | "NEXT_QUESTION"
  | "MASTERED"
  | "ADVANCE"
  | "KEEP_PRACTISING"
  | "EASIER_OR_BREAK"
  | "SESSION_DONE"
  /** The child chose to stop. */
  | "STOPPED";

export type TutorMove =
  | {
      kind: "IDENTIFY";
      objective: ObjectiveFacts;
      mode: LessonMode;
      /** FOUNDATION: the objective this check is for, in the syllabus's own words. */
      becauseOf?: string;
    }
  | { kind: "INTRODUCE"; objective: ObjectiveFacts }
  | { kind: "EXPLAIN"; objective: ObjectiveFacts }
  | { kind: "WORKED_EXAMPLE"; objective: ObjectiveFacts; example: WorkedExampleFacts }
  | {
      kind: "ASK";
      objective: ObjectiveFacts;
      number: number;
      difficulty: Difficulty;
      again: boolean;
    }
  | {
      kind: "HINT";
      objective: ObjectiveFacts;
      stem: string;
      hint: string;
      /** 1-based position of this hint, and how many the question has. */
      number: number;
      of: number;
      secret: SecretAnswer;
    }
  | {
      kind: "FEEDBACK";
      objective: ObjectiveFacts;
      stem: string;
      /** UNREADABLE: nothing markable was typed (no try is used up). */
      verdict: Verdict | "UNREADABLE";
      signals: readonly MarkSignal[];
      attempt: number;
      attemptsLeft: number;
      hintsUsed: number;
      misconception?: MisconceptionFacts;
      /** Present while the question is still open; absent once the answer has been shown or found. */
      secret?: SecretAnswer;
      /** Picks one of several wordings, so the tutor does not repeat itself. */
      variety: string;
    }
  | {
      kind: "CORRECTION";
      objective: ObjectiveFacts;
      stem: string;
      explanation: string;
      steps: readonly string[];
      answer: string;
      misconception?: MisconceptionFacts;
      /** Why the answer is being shown: three tries used, or the learner asked after trying. */
      reason: "TRIES_USED" | "LEARNER_ASKED";
    }
  | {
      kind: "TRANSITION";
      objective: ObjectiveFacts;
      decision: TransitionDecision;
      resolved: number;
      firstTry: number;
    }
  | {
      kind: "ANSWER_QUESTION";
      objective: ObjectiveFacts;
      /** The child's message, already screened by src/lib/ai/safety.ts. Treated as data. */
      learnerMessage: string;
      /** The open question, if any, and its secret. */
      stem?: string;
      secret?: SecretAnswer;
    };

export type MoveKind = TutorMove["kind"];

/** How a move is recorded in `tutor_messages.kind`. */
export const MESSAGE_KIND: Record<MoveKind, string> = {
  IDENTIFY: "IDENTIFY",
  INTRODUCE: "INTRODUCE",
  EXPLAIN: "EXPLAIN",
  WORKED_EXAMPLE: "WORKED_EXAMPLE",
  ASK: "QUESTION",
  HINT: "HINT",
  FEEDBACK: "FEEDBACK",
  CORRECTION: "CORRECTION",
  TRANSITION: "TRANSITION",
  ANSWER_QUESTION: "ANSWER",
};

/** Where a message's words came from. Shown to administrators; the learner sees a plain label. */
export interface VoiceResult {
  text: string;
  source: "template" | "model";
  /** Set when a model wrote the words. */
  model?: { provider: string; name: string };
  /** Why the plain template text was used although a model was configured. */
  fallback?: string[];
}
