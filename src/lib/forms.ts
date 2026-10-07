import type { z } from "zod";

/** Shape returned by every Server Action used with useActionState. */
export interface FormState {
  ok?: boolean;
  /** A single, plain-language message for the whole form. */
  error?: string;
  /** First problem per field, keyed by field name. */
  fieldErrors?: Record<string, string>;
  message?: string;
  /**
   * What the person typed, returned with a failure so the form can show it again: React clears
   * uncontrolled fields after every Server Action, and making someone retype a whole form because
   * one field was wrong is unkind. Never contains passwords.
   */
  values?: Record<string, string>;
  /**
   * Changes with every result. Forms that contain CONTROLLED fields use it as a React `key`: React
   * resets the DOM of a form after each action but not the state of controlled fields, so they are
   * re-created from the returned values instead.
   */
  nonce?: string;
}

export const withNonce = (state: FormState): FormState => ({
  ...state,
  nonce: Math.random().toString(36).slice(2),
});

export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

export function formString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Submitted text fields to hand back with an error. Passwords are never echoed. */
export function submittedValues(
  formData: FormData,
  omit: readonly string[] = ["password"],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    // Next.js adds its own "$ACTION_…" bookkeeping fields to every submission: not user input.
    if (typeof value === "string" && !omit.includes(key) && !key.startsWith("$ACTION")) {
      out[key] = value;
    }
  }
  return out;
}
