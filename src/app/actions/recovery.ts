"use server";

import { redirect } from "next/navigation";
import { emailSchema, passwordSchema } from "@/lib/auth/credentials";
import { requireRole } from "@/lib/auth/session";
import { readPublicEnv } from "@/lib/env";
import { formString, submittedValues, type FormState } from "@/lib/forms";
import { logError, logEvent } from "@/lib/log";
import { createRateLimiter, requestAddress } from "@/lib/ratelimit/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * A parent who has forgotten their password asks for an email, follows its link, and chooses a new
 * one. (A learner's password is changed by their parent; learners have no email address.)
 */

// The same words whether or not the address has an account: nobody can use this to find out who does.
const SENT =
  "If that address has a ZimTutor account, we have sent it an email with a link to choose a new password. The link works once and for an hour.";

export async function requestPasswordResetAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = emailSchema.safeParse(formString(formData, "email"));
  // an address that cannot be one (or is a learner's made-up one) gets the same answer as any other
  if (!parsed.success) return { ok: true, message: SENT };

  const limiter = createRateLimiter();
  const address = await requestAddress();
  if (address) {
    const place = await limiter.hit("reset.address", address);
    if (!place.allowed) return { error: place.message, values: submittedValues(formData) };
  }
  const asked = await limiter.hit("reset.email", parsed.data);
  if (!asked.allowed) return { error: asked.message, values: submittedValues(formData) };

  const supabase = await createSupabaseServerClient();
  const { siteUrl } = readPublicEnv();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
    // if the email carries the default link, it comes back here; the project's own template points at
    // /auth/confirm, which also works from another device (see docs/DEPLOYMENT.md)
    redirectTo: `${siteUrl}/auth/callback?next=/reset-password`,
  });
  if (error && error.status === 429)
    return {
      error: "A lot of requests have been made. Please try again in a few minutes.",
      values: submittedValues(formData),
    };
  // the parent is told the same thing either way (no one can find out who has an account), so a
  // failure to send has to reach whoever runs the service some other way: the log and the monitor
  if (error) logError("password_reset_email_failed", error, { status: error.status ?? 0 });
  else logEvent("account", { type: "password_reset_requested" });
  return { ok: true, message: SENT };
}

export async function setNewPasswordAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireRole("parent", "/reset-password");
  const password = passwordSchema.safeParse(formString(formData, "password"));
  if (!password.success)
    return {
      fieldErrors: { password: password.error.issues[0]?.message ?? "Choose another password." },
    };
  if (formString(formData, "password") !== formString(formData, "again"))
    return { fieldErrors: { again: "The two passwords are not the same." } };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: password.data });
  if (error) {
    if (error.code === "same_password")
      return { fieldErrors: { password: "Please choose a password you have not used before." } };
    if (error.code === "weak_password")
      return {
        fieldErrors: { password: "That password is too easy to guess. Try a longer phrase." },
      };
    return { error: "We couldn't change the password. Please try again." };
  }
  // every other place that was signed in with the old password is signed out
  await supabase.auth.signOut({ scope: "others" }).catch(() => {});
  logEvent("account", { type: "password_reset_done" });
  redirect("/parent?passwordChanged=1"); // outside any try/catch: redirect() works by throwing
}
