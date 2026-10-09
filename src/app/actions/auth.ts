"use server";

import { redirect } from "next/navigation";
import { readPublicEnv } from "@/lib/env";
import {
  createLearnerSchema,
  gradeSchema,
  learnerEmail,
  learnerSignInSchema,
  parentSignInSchema,
  parentSignUpSchema,
} from "@/lib/auth/credentials";
import { provisionLearner } from "@/lib/auth/learners";
import { createSupabaseProvisioningPorts } from "@/lib/auth/learners.server";
import { safeRedirectPath } from "@/lib/auth/redirects";
import { requireRole } from "@/lib/auth/session";
import { fieldErrorsFrom, formString, submittedValues, type FormState } from "@/lib/forms";
import { refusalFor } from "@/lib/ratelimit/policy";
import { createRateLimiter, refusal, requestAddress } from "@/lib/ratelimit/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// One message for every sign-in failure: never reveal whether the username/email exists.
const SIGN_IN_FAILED = "We couldn't sign you in. Please check your details and try again.";

export async function loginAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const mode = formString(formData, "mode") === "learner" ? "learner" : "parent";
  const next = safeRedirectPath(formString(formData, "next") || null, "/");

  let email: string;
  let password: string;
  if (mode === "learner") {
    const parsed = learnerSignInSchema.safeParse({
      username: formString(formData, "username"),
      password: formString(formData, "password"),
    });
    if (!parsed.success) return { error: SIGN_IN_FAILED, values: submittedValues(formData) };
    email = learnerEmail(parsed.data.username);
    password = parsed.data.password;
  } else {
    const parsed = parentSignInSchema.safeParse({
      email: formString(formData, "email"),
      password: formString(formData, "password"),
    });
    if (!parsed.success) return { error: SIGN_IN_FAILED, values: submittedValues(formData) };
    email = parsed.data.email;
    password = parsed.data.password;
  }

  // Wrong guesses at one account are limited (the count is made before the attempt, so a crowd of
  // simultaneous guesses cannot all slip through); a place that has already failed a great many times
  // is turned away. A good sign-in clears the account's count. Only FAILURES count against a place:
  // a class signing in from one school's connection is not an attack.
  const limiter = createRateLimiter();
  const address = await requestAddress();
  const account = `${mode}:${email}`;
  if (address) {
    const place = await limiter.peek("login.address", address);
    if (!place.allowed) return { error: place.message, values: submittedValues(formData) };
  }
  const counted = await limiter.hit("login.account", account);
  if (!counted.allowed) return { error: counted.message, values: submittedValues(formData) };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (address) await limiter.hit("login.address", address);
    return {
      // the sign-in service has limits of its own
      error: error.status === 429 ? refusalFor("login.account", 300) : SIGN_IN_FAILED,
      values: submittedValues(formData),
    };
  }
  await limiter.clear("login.account", account);

  redirect(next); // outside any try/catch: redirect() works by throwing
}

export async function signUpAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const parsed = parentSignUpSchema.safeParse({
    displayName: formString(formData, "displayName"),
    email: formString(formData, "email"),
    password: formString(formData, "password"),
    isGuardian: formString(formData, "isGuardian"),
  });
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error), values: submittedValues(formData) };
  }

  const address = await requestAddress();
  if (address) {
    const tooMany = await refusal("signup.address", address);
    if (tooMany) return { error: tooMany, values: submittedValues(formData) };
  }

  const supabase = await createSupabaseServerClient();
  const { siteUrl } = readPublicEnv();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { display_name: parsed.data.displayName },
      emailRedirectTo: `${siteUrl}/auth/callback`,
    },
  });

  if (error) {
    if (error.code === "weak_password") {
      return {
        fieldErrors: { password: "That password is too easy to guess. Try a longer phrase." },
        values: submittedValues(formData),
      };
    }
    if (error.code === "over_email_send_rate_limit" || error.status === 429) {
      return {
        error: "Too many attempts. Please wait a few minutes and try again.",
        values: submittedValues(formData),
      };
    }
    return {
      error: "We couldn't create your account. Please try again.",
      values: submittedValues(formData),
    };
  }

  // Email confirmation disabled (local development): the user is already signed in.
  if (data.session) redirect("/");

  // Same message whether or not the address already exists (no account enumeration).
  return {
    ok: true,
    message:
      "Almost there! Check your email and follow the link to confirm your address, then sign in.",
  };
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}

const LEARNER_ERRORS = {
  USERNAME_TAKEN: "That username is already taken. Please choose another.",
  LEARNER_LIMIT_REACHED: "You've reached the limit for learner accounts on one parent account.",
  UNKNOWN: "We couldn't create the learner account. Please try again.",
} as const;

export async function createLearnerAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  // The acting parent comes from the verified session — never from the form.
  const parent = await requireRole("parent", "/parent/learners/new");

  const parsed = createLearnerSchema.safeParse({
    displayName: formString(formData, "displayName"),
    username: formString(formData, "username"),
    password: formString(formData, "password"),
    grade: formString(formData, "grade"),
  });
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error), values: submittedValues(formData) };
  }

  const tooMany = await refusal("learner.create", parent.id);
  if (tooMany) return { error: tooMany, values: submittedValues(formData) };

  const result = await provisionLearner(
    createSupabaseProvisioningPorts(),
    parent.id,
    parsed.data,
    (id, error) => {
      console.error("[learner-provisioning] could not remove an orphaned auth user", { id, error });
    },
  );
  if (!result.ok) {
    const values = submittedValues(formData);
    if (result.error === "USERNAME_TAKEN")
      return { fieldErrors: { username: LEARNER_ERRORS.USERNAME_TAKEN }, values };
    return { error: LEARNER_ERRORS[result.error], values };
  }

  redirect(`/parent?added=${encodeURIComponent(result.username)}`);
}

export async function setGradeAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const learner = await requireRole("student", "/student/onboarding");
  const parsed = gradeSchema.safeParse(formString(formData, "grade"));
  if (!parsed.success) return { error: "Please choose a grade from 3 to 7." };

  // User-scoped client: row-level security and column privileges limit this to the learner's own
  // grade/onboarding flag. No elevated privileges are needed (or used).
  const supabase = await createSupabaseServerClient();
  const { error, count } = await supabase
    .from("learner_profiles")
    .update({ grade: parsed.data, onboarding_completed: true }, { count: "exact" })
    .eq("profile_id", learner.id);
  if (error || count !== 1) return { error: "We couldn't save your grade. Please try again." };

  redirect("/student");
}
