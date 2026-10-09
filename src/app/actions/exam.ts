"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { ExamError, finishPaper, saveAnswer, startPaper, type PaperView } from "@/lib/exam/service";
import { createExamDeps } from "@/lib/exam/server";
import { logError } from "@/lib/log";
import { getMonitor, later } from "@/lib/monitoring";
import { refusal } from "@/lib/ratelimit/server";
import type { FormState } from "@/lib/forms";
import type { LearnerAnswer } from "@/lib/marking/spec";

/**
 * Practice papers, as the learner's browser reaches them. Each action learns who is asking from the
 * signed-in session, never from anything the browser sends, and checks the shape of what it was sent.
 */

const answerSchema: z.ZodType<LearnerAnswer> = z.lazy(() =>
  z.union([z.string(), z.boolean(), z.array(z.string()), z.record(z.string(), answerSchema)]),
);

function friendly(error: unknown): string {
  if (error instanceof ExamError) {
    switch (error.code) {
      case "ACTIVE_PAPER":
        return "You already have a paper in progress. Finish it first.";
      case "NOT_ENOUGH":
        return "ZimTutor could not put that paper together just now. Please try another one.";
      case "FINISHED":
        return "That paper has been marked already.";
      case "NOT_FOUND":
        return "We could not find that.";
      case "FORBIDDEN":
        return "That paper belongs to someone else.";
      case "INVALID":
        return "That did not look right. Please try again.";
    }
  }
  logError("exam_action_failed", error);
  return "Something went wrong. Please try again.";
}

const startSchema = z.object({
  paperNumber: z.coerce.number().pipe(z.union([z.literal(1), z.literal(2)])),
  length: z.enum(["FULL", "SHORT"]),
});

/** The "start a paper" form. On success the child is taken to their paper. */
export async function startPaperAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole("student", "/student/exams");
  const [paperNumber, length] = String(formData.get("start") ?? "").split(":");
  const parsed = startSchema.safeParse({ paperNumber, length });
  if (!parsed.success) return { error: "Choose a paper." };
  const slowDown = await refusal("exam.start", user.id);
  if (slowDown) return { error: slowDown };
  let id: string;
  try {
    id = await startPaper(createExamDeps(), { learnerId: user.id, ...parsed.data });
  } catch (error) {
    return { error: friendly(error) };
  }
  later(
    getMonitor().track({
      name: "paper_started",
      paper: parsed.data.paperNumber,
      length: parsed.data.length,
    }),
  );
  redirect(`/student/exams/${id}`);
}

export type SaveResult = { ok: true } | { ok: false; error: string };

const saveSchema = z.object({
  setId: z.uuid(),
  position: z.number().int().min(1).max(200),
  answer: answerSchema,
});

export async function saveAnswerAction(input: unknown): Promise<SaveResult> {
  const user = await requireRole("student", "/student/exams");
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That answer could not be saved." };
  const slowDown = await refusal("exam.save", user.id);
  if (slowDown) return { ok: false, error: slowDown };
  try {
    await saveAnswer(createExamDeps(), { learnerId: user.id, ...parsed.data });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: friendly(error) };
  }
}

export type FinishResult = { ok: true; view: PaperView } | { ok: false; error: string };

export async function finishPaperAction(input: unknown): Promise<FinishResult> {
  const user = await requireRole("student", "/student/exams");
  const parsed = z.object({ setId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "That paper could not be found." };
  const slowDown = await refusal("exam.finish", user.id);
  if (slowDown) return { ok: false, error: slowDown };
  try {
    const view = await finishPaper(createExamDeps(), {
      learnerId: user.id,
      setId: parsed.data.setId,
    });
    later(
      getMonitor().track({
        name: "paper_finished",
        paper: view.paperNumber,
        length: view.length,
        answered: view.answered,
        of: view.total,
      }),
    );
    return { ok: true, view };
  } catch (error) {
    return { ok: false, error: friendly(error) };
  }
}
