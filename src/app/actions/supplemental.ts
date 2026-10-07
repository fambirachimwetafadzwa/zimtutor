"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { fieldErrorsFrom, submittedValues, withNonce, type FormState } from "@/lib/forms";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { relabelInputSchema, supplementalInputSchema } from "@/lib/supplemental/rules";
import { createSupplemental, relabelSupplemental } from "@/lib/supplemental/service";

/** All form values as plain strings (File entries are ignored). */
function fields(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) if (typeof value === "string") out[key] = value;
  return out;
}

export async function createSupplementalAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  // The acting administrator comes from the verified session — never from the form.
  const admin = await requireRole("admin", "/admin");
  const parsed = supplementalInputSchema.safeParse(fields(formData));
  const values = submittedValues(formData);
  if (!parsed.success) return withNonce({ fieldErrors: fieldErrorsFrom(parsed.error), values });

  const result = await createSupplemental(createSupabaseAdminClient(), admin.id, parsed.data);
  if (!result.ok)
    return withNonce({ error: result.error, fieldErrors: result.fieldErrors, values });

  revalidatePath(`/admin/curriculum/objectives/${parsed.data.objectiveId}`);
  revalidatePath("/admin/supplemental");
  revalidatePath("/admin");
  return withNonce({
    ok: true,
    message: "Saved. It is labelled exactly as you chose, and the change is in the audit log.",
  });
}

export async function relabelSupplementalAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireRole("admin", "/admin");
  const parsed = relabelInputSchema.safeParse(fields(formData));
  const values = submittedValues(formData);
  if (!parsed.success) return withNonce({ fieldErrors: fieldErrorsFrom(parsed.error), values });

  const result = await relabelSupplemental(createSupabaseAdminClient(), admin.id, parsed.data);
  if (!result.ok)
    return withNonce({ error: result.error, fieldErrors: result.fieldErrors, values });

  const objectiveId = fields(formData).objectiveId;
  if (objectiveId) revalidatePath(`/admin/curriculum/objectives/${objectiveId}`);
  revalidatePath("/admin/supplemental");
  revalidatePath("/admin");
  revalidatePath("/admin/audit");
  return withNonce({
    ok: true,
    message: "Label changed. The previous label is kept in the audit log.",
  });
}
