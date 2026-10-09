"use client";

import { useActionState } from "react";
import { setNewPasswordAction } from "@/app/actions/recovery";
import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import type { FormState } from "@/lib/forms";

const initial: FormState = {};

export function ResetPasswordForm() {
  const [state, formAction] = useActionState(setNewPasswordAction, initial);
  const errors = state.fieldErrors ?? {};
  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <Field
        label="New password"
        name="password"
        type="password"
        error={errors.password}
        hint="At least 8 characters. A short phrase is easy to remember and hard to guess."
        autoComplete="new-password"
        required
      />
      <Field
        label="The same password again"
        name="again"
        type="password"
        error={errors.again}
        autoComplete="new-password"
        required
      />
      <FormMessage error={state.error} signal={state} />
      <SubmitButton pendingLabel="Saving…">Save my new password</SubmitButton>
    </form>
  );
}
