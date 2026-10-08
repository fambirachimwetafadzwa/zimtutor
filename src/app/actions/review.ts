"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { fieldErrorsFrom, submittedValues, withNonce, type FormState } from "@/lib/forms";
import { decideQuestion, reviewQuestionSchema } from "@/lib/questions/review";
import { reviewFlagged } from "@/lib/safety/review";
import { reviewInputSchema } from "@/lib/safety/rules";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/** Both actions act as the administrator in the verified session, never as anyone named in a form. */

export async function reviewFlaggedAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireRole("admin", "/admin/safety");
  const values = submittedValues(formData);
  const parsed = reviewInputSchema.safeParse({
    messageId: values.messageId,
    outcome: values.outcome,
    note: values.note,
  });
  if (!parsed.success) return withNonce({ fieldErrors: fieldErrorsFrom(parsed.error), values });

  const result = await reviewFlagged(createSupabaseAdminClient(), admin.id, parsed.data);
  if (!result.ok) return withNonce({ error: result.error, values });

  revalidatePath("/admin/safety");
  revalidatePath("/admin");
  revalidatePath("/admin/audit");
  return withNonce({ ok: true, message: "Saved. Your decision is in the audit log.", values });
}

export async function reviewQuestionAction(formData: FormData): Promise<void> {
  const admin = await requireRole("admin", "/admin/questions");
  const parsed = reviewQuestionSchema.safeParse({
    questionId: formData.get("questionId"),
    action: formData.get("action"),
  });
  if (!parsed.success) throw new Error("That decision was not understood.");
  const result = await decideQuestion(createSupabaseAdminClient(), admin.id, parsed.data);
  if (!result.ok) throw new Error(result.error);
  revalidatePath("/admin/questions");
  revalidatePath("/admin");
  revalidatePath("/admin/audit");
}
