import { z } from "zod";
import { learnerAnswerSchema } from "../questions/types";
import { answerIsReasonable } from "./answers";

/**
 * What a learner can do in a lesson. Every request from the browser is parsed with this schema on the
 * server; nothing else is accepted.
 */

export const tutorActionSchema = z.discriminatedUnion("type", [
  /** Next card of the lesson: the explanation, then the first question. */
  z.object({ type: z.literal("CONTINUE") }),
  z.object({ type: z.literal("SKIP_LESSON") }),
  z.object({
    type: z.literal("ANSWER"),
    /** The question the answer is for, so a stale screen cannot answer a newer question. */
    questionId: z.string().min(1).max(64),
    answer: learnerAnswerSchema.refine(answerIsReasonable, "That answer is too long."),
  }),
  z.object({ type: z.literal("HINT") }),
  z.object({ type: z.literal("SHOW_ANSWER") }),
  z.object({ type: z.literal("NEXT_QUESTION") }),
  z.object({ type: z.literal("SKIP_QUESTION") }),
  z.object({ type: z.literal("EXPLAIN_AGAIN") }),
  z.object({ type: z.literal("ASK"), text: z.string().max(5000) }),
  z.object({ type: z.literal("END") }),
]);
export type TutorAction = z.infer<typeof tutorActionSchema>;
export type TutorActionName = TutorAction["type"];
