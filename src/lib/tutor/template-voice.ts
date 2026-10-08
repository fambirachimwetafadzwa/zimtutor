import type { MarkSignal } from "../marking/mark";
import { findLeak } from "../questions/verify";
import type { TutorMove } from "./moves";

/**
 * The tutor's plain words: written by people, fixed, and always correct because they only restate
 * facts the application already decided. This is what a child reads when no language model is
 * configured, when a model is down, and whenever a model's reply fails a guard (src/lib/ai/guards.ts).
 * It is also the DRAFT a model is asked to rephrase, so a model can change the wording but not the
 * facts.
 *
 * Plain text only. The same move always gives the same text (the wording is chosen from a seed).
 */

// ── small helpers ───────────────────────────────────────────────────────────────────────────────

const stripEnd = (text: string) => text.trim().replace(/[.!?:;,\s]+$/, "");
const lowerFirst = (text: string) => (text ? text[0]!.toLowerCase() + text.slice(1) : text);

/** A stable pick from a list: the same seed always gives the same wording. */
export function pickVariant<T>(seed: string, options: readonly [T, ...T[]]): T {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return options[(hash >>> 0) % options.length]!;
}

/** What the marker noticed, in words for a child. These never contain the answer. */
const SIGNAL_TEXT: Partial<Record<MarkSignal, string>> = {
  MISSING_UNIT: "Your number looks right, but remember to write the unit.",
  WRONG_UNIT: "Check the unit in your answer.",
  UNIT_DIMENSION_MISMATCH:
    "Check the unit in your answer. It does not measure the right kind of thing.",
  NOT_IN_LOWEST_TERMS: "The value is right. Now write the fraction in its simplest form.",
  WRONG_FORM:
    "The value is right, but the question asks for a different way of writing it. Read the question again.",
  OFF_BY_POWER_OF_TEN: "Check the size of your answer. Count the places carefully.",
  EXPRESSION_GIVEN: "Write the final answer, not the working.",
  SEQUENCE_PARTIAL: "Some of your order is right. Look again at the ones that are out of place.",
  PAIRS_PARTIAL: "Some of your pairs are right. Look again at the others.",
  WRONG_SHAPE_OF_ANSWER: "Your answer is not written in the way the question asks.",
};

/** One short sentence about what to fix, or null when the marker had nothing particular to say. */
export function signalAdvice(signals: readonly MarkSignal[]): string | null {
  for (const signal of signals) {
    const text = SIGNAL_TEXT[signal];
    if (text) return text;
  }
  return null;
}

const where = (o: { grade: number; topicName: string; subtopicName: string }) =>
  `Grade ${o.grade} syllabus (${o.topicName}: ${o.subtopicName})`;

// ── the words ───────────────────────────────────────────────────────────────────────────────────

export function templateText(move: TutorMove): string {
  switch (move.kind) {
    case "IDENTIFY": {
      const place = where(move.objective);
      switch (move.mode) {
        case "LEARN":
          return `Here is our goal for this lesson, from your ${place}.`;
        case "PRACTISE":
          return `Let's keep practising this goal from your ${place}.`;
        case "REVIEW":
          return `Time for a quick review. You worked on this goal before, and checking it again helps you remember it. It is from your ${place}.`;
        case "FOUNDATION":
          return `Let's go back one step first. This earlier goal helps with "${stripEnd(move.becauseOf ?? "your next goal")}", so a short check will show us where to start. It is from your ${place}.`;
      }
      break;
    }

    case "INTRODUCE":
      return `In this lesson you will learn to ${lowerFirst(stripEnd(move.objective.text))}. First we will look at what the syllabus says and go through an example. Then you will try some questions. If you get stuck you can ask for a hint, and that is fine: everyone needs hints sometimes.`;

    case "EXPLAIN":
      return move.objective.activities.length > 0
        ? "Here is what this goal covers, word for word from the syllabus. The syllabus also suggests ways to practise it. Read it, then we will go through an example."
        : "Here is what this goal covers, word for word from the syllabus. Read it, then we will go through an example.";

    case "WORKED_EXAMPLE": {
      const { stem, steps, explanation, answer } = move.example;
      const body =
        steps.length > 0
          ? steps.map((step, i) => `Step ${i + 1}: ${step}`).join("\n")
          : explanation;
      const stated = findLeak(body, [answer]) !== null;
      return [
        "Let's look at an example together.",
        `Question: ${stem}`,
        body,
        stated ? "" : `So the answer is ${answer}.`,
      ]
        .filter(Boolean)
        .join("\n\n");
    }

    case "ASK":
      return move.again
        ? "Let's try another question on the same idea. Take your time."
        : move.number === 1
          ? "Now it is your turn. Take your time, and ask for a hint if you need one."
          : "Here is the next question.";

    case "HINT":
      return move.hint;

    case "FEEDBACK": {
      const seed = `${move.variety}:${move.attempt}`;
      if (move.verdict === "CORRECT") {
        const clean = move.attempt === 1 && move.hintsUsed === 0;
        const praise = clean
          ? pickVariant(seed, [
              "Correct! Well done.",
              "That's right! Nicely done.",
              "Yes, you got it! Well done.",
              "Correct. Good work.",
            ])
          : pickVariant(seed, [
              "That's right. You stayed with it and worked it out.",
              "Yes, that is correct now. Good thinking.",
              "Correct! Trying again paid off.",
            ]);
        return move.signals.includes("WITHIN_TOLERANCE")
          ? `${praise} Your estimate is close enough.`
          : praise;
      }
      if (move.verdict === "ALMOST") {
        return `You are nearly there! ${signalAdvice(move.signals) ?? "Check how you have written your answer."}`;
      }
      const opening = pickVariant(seed, [
        "Not quite yet.",
        "That is not right yet.",
        "Good try, but that is not it yet.",
      ]);
      const advice =
        signalAdvice(move.signals) ??
        move.misconception?.nudge ??
        "Read the question again, or ask for a hint if you are stuck.";
      return `${opening} ${advice}`;
    }

    case "CORRECTION": {
      const body =
        move.steps.length > 0
          ? move.steps.map((step, i) => `Step ${i + 1}: ${step}`).join("\n")
          : move.explanation;
      const stated = findLeak(body, [move.answer]) !== null;
      const opening =
        move.reason === "TRIES_USED"
          ? "That was a tricky one. Let's work it out together."
          : "Let's work it out together.";
      return [opening, body, stated ? "" : `So the answer is ${move.answer}.`]
        .filter(Boolean)
        .join("\n\n");
    }

    case "TRANSITION":
      switch (move.decision) {
        case "NEXT_QUESTION":
          return "Ready for another one?";
        case "MASTERED":
          return "ZimTutor thinks you have mastered this goal. Well done! It will come back for a quick review in a few days, to help you remember it for a long time.";
        case "ADVANCE":
          return "You are doing well on this goal. Shall we move on to the next one?";
        case "KEEP_PRACTISING":
          return "A little more practice will help. Let's do another one.";
        case "EASIER_OR_BREAK":
          return "This goal is tricky, and that is okay. We can try an easier question first, or you can take a break and come back later.";
        case "SESSION_DONE":
          return `That is a good session. You answered ${move.resolved} ${move.resolved === 1 ? "question" : "questions"} and got ${move.firstTry} right at the first try. You can come back whenever you like.`;
      }
      break;

    case "ANSWER_QUESTION":
      return "Good question! I can help most with a hint or an example for this goal. Use the Hint button, or ask your teacher about this one.";
  }
  // unreachable: every move kind returns above
  return "";
}
