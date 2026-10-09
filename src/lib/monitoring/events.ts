/**
 * What ZimTutor counts, and nothing else. An event is a name and a few numbers or words from a short
 * list: never who did it, never what they said. That is how the product can learn that lessons are
 * being finished, or that a limit is being met, without a service outside ever hearing about a child.
 */
export type AnalyticsEvent =
  | { name: "lesson_started"; grade: number; mode: string }
  | { name: "lesson_finished"; resolved: number; firstTry: number }
  | { name: "paper_started"; paper: 1 | 2; length: "FULL" | "SHORT" }
  | { name: "paper_finished"; paper: 1 | 2; length: "FULL" | "SHORT"; answered: number; of: number }
  | { name: "message_flagged"; kind: string }
  | { name: "limit_reached"; bucket: string }
  | { name: "model_fallback"; reason: string };

export type AnalyticsEventName = AnalyticsEvent["name"];
