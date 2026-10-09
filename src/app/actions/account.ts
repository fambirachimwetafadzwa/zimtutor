"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { changeLearnerPassword, removeFamily, removeLearner } from "@/lib/auth/accounts";
import { createSupabaseAccountPorts } from "@/lib/auth/accounts.server";
import { learnerEmail, normalizeUsername, passwordSchema } from "@/lib/auth/credentials";
import { requireRole } from "@/lib/auth/session";
import { passwordIsRight } from "@/lib/auth/verify.server";
import { formString, type FormState } from "@/lib/forms";
import { logEvent } from "@/lib/log";
import { createRateLimiter, refusal } from "@/lib/ratelimit/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * What a parent can do about the accounts they look after: change a child's password, delete a
 * child's account and everything saved about it, and delete their own account (which deletes the
 * children they alone look after). Each action learns who is asking from the signed-in session; which
 * child it is about comes from the page, and is only ever acted on if that parent is the child's
 * guardian (to anyone else the child does not exist).
 */

const NOT_FOUND = "We could not find that learner.";
const childSchema = z.uuid();

export async function changeLearnerPasswordAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parent = await requireRole("parent", "/parent");
  const child = childSchema.safeParse(formString(formData, "child"));
  if (!child.success) return { error: NOT_FOUND };
  const password = passwordSchema.safeParse(formString(formData, "password"));
  if (!password.success)
    return {
      fieldErrors: { password: password.error.issues[0]?.message ?? "Choose another password." },
    };

  const slowDown = await refusal("account.password", parent.id);
  if (slowDown) return { error: slowDown };

  const result = await changeLearnerPassword(
    createSupabaseAccountPorts(),
    parent.id,
    child.data,
    password.data,
  );
  if (!result.ok)
    return {
      error:
        result.error === "NOT_FOUND"
          ? NOT_FOUND
          : "We couldn't change the password. Please try again.",
    };
  // a child locked out by wrong guesses can try again with the new password
  await createRateLimiter().clear("login.account", `learner:${learnerEmail(result.username)}`);
  logEvent("account", { type: "learner_password_changed" });
  return { ok: true, message: "The password has been changed. Tell your child the new one." };
}

export async function removeLearnerAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parent = await requireRole("parent", "/parent");
  const child = childSchema.safeParse(formString(formData, "child"));
  if (!child.success) return { error: NOT_FOUND };

  const slowDown = await refusal("account.delete", parent.id);
  if (slowDown) return { error: slowDown };

  const ports = createSupabaseAccountPorts();
  // typing the username is how a parent says they mean it; a child who is not theirs is not found
  const username = (await ports.isGuardian(parent.id, child.data))
    ? await ports.learnerUsername(child.data)
    : null;
  if (!username) return { error: NOT_FOUND };
  if (normalizeUsername(formString(formData, "confirm")) !== username)
    return { fieldErrors: { confirm: "Please type the username exactly as it is shown." } };

  const result = await removeLearner(ports, parent.id, child.data);
  if (!result.ok)
    return {
      error:
        result.error === "NOT_FOUND"
          ? NOT_FOUND
          : "We couldn't delete the account. Please try again.",
    };
  logEvent("account", { type: "learner_deleted" });
  redirect("/parent?removed=1"); // outside any try/catch: redirect() works by throwing
}

export async function deleteMyAccountAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parent = await requireRole("parent", "/parent/account");
  if (formString(formData, "confirm").trim().toLowerCase() !== "delete")
    return { fieldErrors: { confirm: "Please type the word delete to show that you mean it." } };

  const slowDown = await refusal("account.delete", parent.id);
  if (slowDown) return { error: slowDown };

  // deleting everything asks for the password again: a phone left signed in cannot do it alone
  const supabase = await createSupabaseServerClient();
  const email = (await supabase.auth.getUser()).data.user?.email;
  if (!email) return { error: "Please sign in again to do this." };
  const limiter = createRateLimiter();
  const account = `parent:${email}`;
  const counted = await limiter.hit("login.account", account);
  if (!counted.allowed) return { error: counted.message };
  if (!(await passwordIsRight(email, formString(formData, "password"))))
    return { fieldErrors: { password: "That is not your password." } };
  await limiter.clear("login.account", account);

  const result = await removeFamily(createSupabaseAccountPorts(), parent.id);
  if (!result.ok) return { error: "We couldn't finish deleting everything. Please try again." };
  logEvent("account", { type: "family_deleted", learners: result.learnersRemoved });
  await supabase.auth.signOut().catch(() => {});
  redirect("/login?who=parent&deleted=1");
}
