import { z } from "zod";
import { MASTERY_STATES } from "../mastery/engine";

/**
 * Where a tutoring session is. Stored as `tutor_sessions.state` (jsonb): ids and counters ONLY. The
 * conversation itself lives in `tutor_messages`, which parents cannot read, so the state — which a
 * parent's progress view may touch — holds nothing a child said.
 *
 * The phase and these counters are decided by the application (src/lib/tutor/service.ts). A language
 * model never chooses what happens next.
 */

export const PHASES = [
  "IDENTIFY_OBJECTIVE",
  "LESSON",
  "AWAITING_ANSWER",
  "RESOLVED",
  "ENDED",
] as const;
export type Phase = (typeof PHASES)[number];

export const LESSON_MODES = ["LEARN", "PRACTISE", "REVIEW", "FOUNDATION"] as const;

/** The question the learner is working on now. */
export const openQuestionSchema = z.object({
  id: z.string(),
  shownAt: z.string(),
  difficulty: z.number().int().min(1).max(5),
  /** How many hints the question has (so the screen knows when they run out without reading the key). */
  hintCount: z.number().int().min(0),
  /** Answers that were marked right, wrong or nearly right. Unreadable input does not count. */
  submissions: z.number().int().min(0),
  wrongAttempts: z.number().int().min(0),
  almost: z.number().int().min(0),
  hintsUsed: z.number().int().min(0),
  /** Misconceptions shown by the wrong answers so far. */
  tags: z.array(z.string()),
});
export type OpenQuestion = z.infer<typeof openQuestionSchema>;

export const sessionStateSchema = z.object({
  v: z.literal(1),
  mode: z.enum(LESSON_MODES),
  /** FOUNDATION: the objective this check is for. */
  forObjectiveId: z.string().optional(),
  /** Lesson pages shown: 0 none, 1 introduced, 2 explained and an example worked. */
  page: z.number().int().min(0).max(2),
  exampleQuestionId: z.string().nullable(),
  question: openQuestionSchema.nullable(),
  /** Questions already used in this session (never set again in it). */
  seen: z.array(z.string()).max(300),
  resolved: z.number().int().min(0),
  firstTry: z.number().int().min(0),
  wrongInARow: z.number().int().min(0),
  skips: z.number().int().min(0),
  hintsUsed: z.number().int().min(0),
  masteryStart: z.object({ score: z.number(), state: z.enum(MASTERY_STATES) }).nullable(),
  startedAt: z.string(),
});
export type SessionState = z.infer<typeof sessionStateSchema>;
export type LessonMode = SessionState["mode"];

export function newSessionState(input: {
  mode: LessonMode;
  forObjectiveId?: string | undefined;
  now: Date;
  masteryStart: SessionState["masteryStart"];
}): SessionState {
  return {
    v: 1,
    mode: input.mode,
    ...(input.forObjectiveId ? { forObjectiveId: input.forObjectiveId } : {}),
    page: 0,
    exampleQuestionId: null,
    question: null,
    seen: [],
    resolved: 0,
    firstTry: 0,
    wrongInARow: 0,
    skips: 0,
    hintsUsed: 0,
    masteryStart: input.masteryStart,
    startedAt: input.now.toISOString(),
  };
}

/** What a parent may be shown about a finished session: counts and outcomes, never words. */
export const sessionSummarySchema = z.object({
  objectiveId: z.string(),
  mode: z.enum(LESSON_MODES),
  questions: z.number().int().min(0),
  firstTry: z.number().int().min(0),
  hintsUsed: z.number().int().min(0),
  minutes: z.number().min(0),
  masteryStart: z.object({ score: z.number(), state: z.enum(MASTERY_STATES) }).nullable(),
  masteryEnd: z.object({ score: z.number(), state: z.enum(MASTERY_STATES) }).nullable(),
  endedBy: z.enum(["MASTERED", "SESSION_DONE", "LEARNER", "IDLE"]),
});
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
