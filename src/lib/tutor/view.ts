import type { PublicQuestion } from "../questions/bank-rows";
import type { Phase } from "./state";
import type { Quote, SessionStatus } from "./store";
import type { TutorActionName } from "./actions";

/**
 * What the learner's screen is given. Plain data, safe to send to a browser: there is no answer key,
 * no hint that has not been released, no explanation of a question that is still open.
 */

export interface MessageView {
  id: string;
  role: "tutor" | "learner";
  kind: string;
  text: string;
  at: string;
  /** How the words were made, for a small label under a tutor message. Null for the child's own words. */
  source: "template" | "model" | null;
  /** Words copied from the syllabus, shown apart from the tutor's own. */
  quotes: Quote[];
  citation: string | null;
  hint: { number: number; of: number } | null;
  /** The question to draw: the one being asked, or the worked example. */
  question: PublicQuestion | null;
  /** A reply from the safety screen rather than from the lesson. */
  safety: boolean;
}

export interface TutorView {
  sessionId: string;
  /** Changes with every step; sent back so a stale screen can be noticed. */
  rev: number;
  status: SessionStatus;
  phase: Phase;
  objective: {
    id: string;
    text: string;
    grade: number;
    topic: string;
    subtopic: string;
  };
  messages: MessageView[];
  /** The question waiting for an answer. */
  openQuestion: PublicQuestion | null;
  hintsLeft: number;
  tries: { used: number; max: number } | null;
  actions: TutorActionName[];
  progress: { resolved: number; firstTry: number; limit: number };
  /** The learner's standing on this goal, in the words and numbers children see. */
  mastery: { state: string; label: string; percent: number } | null;
}

/** The example's card already shows its question, so the words under it need not say it again. */
export function withoutRestatedQuestion(text: string, stem: string): string {
  const restated = `Question: ${stem}`;
  return text
    .split("\n\n")
    .filter((paragraph) => paragraph.trim() !== restated)
    .join("\n\n");
}

/**
 * What a screen reader is told when a tutor message arrives. A question's words are drawn in a card,
 * so the question itself is added: otherwise someone listening would be told "Here is the next
 * question" and never hear it.
 */
export function announcementFor(message: MessageView): string {
  return message.kind === "QUESTION" && message.question
    ? `${message.text} ${message.question.stem}`
    : message.text;
}
