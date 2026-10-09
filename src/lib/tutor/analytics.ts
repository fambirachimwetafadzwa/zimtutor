import type { AnalyticsEvent } from "@/lib/monitoring/events";
import type { TutorEvent } from "./service";
import type { VoiceEvent } from "./voice";

/**
 * What the tutor's own events become when they are counted: grade, mode and numbers only. Never an
 * objective's wording, a question, an answer or a message (those events do not carry them, and these
 * mappings would not pass them on if they did).
 */

/** The grade in a goal's code ("G5-OPS-ADDITION-WHOLE-NUMBERS-001" is Grade 5). */
export function gradeOfObjective(objectiveId: string): number | null {
  const match = /^G([3-7])-/.exec(objectiveId);
  return match ? Number(match[1]) : null;
}

export function analyticsForTutor(event: TutorEvent): AnalyticsEvent | null {
  switch (event.type) {
    case "session_started": {
      const grade = gradeOfObjective(event.objectiveId);
      return grade === null ? null : { name: "lesson_started", grade, mode: event.mode };
    }
    case "session_ended":
      // a lesson counts as finished when something was answered; one stopped at once is not
      return event.questions > 0
        ? { name: "lesson_finished", resolved: event.questions, firstTry: event.firstTry }
        : null;
    case "message_screened":
      return event.flagged && event.categories.length > 0
        ? { name: "message_flagged", kind: event.categories.join("_") }
        : null;
    default:
      return null;
  }
}

export function analyticsForVoice(event: VoiceEvent): AnalyticsEvent | null {
  // the tutor fell back to its own plain text: a model failed, was refused, or is being left alone
  return event.kind === "model_used" ? null : { name: "model_fallback", reason: event.kind };
}
