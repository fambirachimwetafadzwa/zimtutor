"use server";

import { z } from "zod";
import { getLearnerGrade } from "@/lib/adaptive/service";
import { requireRole } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/log";
import { tutorActionSchema } from "@/lib/tutor/actions";
import { act, startOrResume, TutorError } from "@/lib/tutor/service";
import { refusal } from "@/lib/ratelimit/server";
import { createTutorDeps } from "@/lib/tutor/server";
import { LESSON_MODES } from "@/lib/tutor/state";
import type { TutorView } from "@/lib/tutor/view";

/**
 * Lessons, as the learner's browser reaches them. Every action checks who is asking from the signed-in
 * session (never from anything the browser sends), checks the shape of what it was sent, and returns
 * only the lesson view: no answer key, no database record.
 */

export type LessonResult = { ok: true; view: TutorView } | { ok: false; error: string };

const startSchema = z.object({
  objectiveId: z.string().min(3).max(120),
  mode: z.enum(LESSON_MODES).optional(),
  forObjectiveId: z.string().min(3).max(120).optional(),
});

const stepSchema = z.object({ sessionId: z.uuid(), action: tutorActionSchema });

function failure(error: unknown): LessonResult {
  if (error instanceof TutorError) {
    switch (error.code) {
      case "NOT_FOUND":
        return { ok: false, error: "We could not find that lesson." };
      case "FORBIDDEN":
        return { ok: false, error: "That lesson belongs to someone else." };
      case "NOT_PRACTICABLE":
        return {
          ok: false,
          error:
            "This goal is done with real things, like drawing or building, so there are no questions for it here.",
        };
      case "CONFLICT":
        return { ok: false, error: "That did not work. Please try again." };
    }
  }
  logError("tutor_action_failed", error);
  return { ok: false, error: "Something went wrong. Please try again." };
}

export async function startLessonAction(input: unknown): Promise<LessonResult> {
  const user = await requireRole("student", "/student");
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That lesson link is not right." };
  const slowDown = await refusal("tutor.start", user.id);
  if (slowDown) return { ok: false, error: slowDown };
  try {
    const deps = createTutorDeps();
    // A learner works on the goals of their own grade and the grades before it, never ahead.
    const [objective, grade] = await Promise.all([
      deps.curriculum.objective(parsed.data.objectiveId),
      getLearnerGrade(createSupabaseAdminClient(), user.id),
    ]);
    if (objective && objective.grade > grade)
      return {
        ok: false,
        error: `That goal is for Grade ${objective.grade}. You are in Grade ${grade}.`,
      };
    const view = await startOrResume(deps, { learnerId: user.id, ...parsed.data });
    return { ok: true, view };
  } catch (error) {
    return failure(error);
  }
}

export async function lessonAction(input: unknown): Promise<LessonResult> {
  const user = await requireRole("student", "/student");
  const parsed = stepSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That did not look right. Please try again." };
  // a child's own question may be put to a model, so it has limits of its own (a minute, and a day)
  const asking = parsed.data.action.type === "ASK";
  const slowDown =
    (await refusal(asking ? "tutor.ask" : "tutor.step", user.id)) ??
    (asking ? await refusal("tutor.ask.day", user.id) : null);
  if (slowDown) return { ok: false, error: slowDown };
  try {
    const view = await act(createTutorDeps(), { learnerId: user.id, ...parsed.data });
    return { ok: true, view };
  } catch (error) {
    return failure(error);
  }
}
