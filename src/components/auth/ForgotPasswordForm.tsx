"use client";

import { useActionState } from "react";
import { requestPasswordResetAction } from "@/app/actions/recovery";
import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import type { FormState } from "@/lib/forms";

const initial: FormState = {};

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(requestPasswordResetAction, initial);
  if (state.ok) return <FormMessage message={state.message} signal={state} />;
  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <Field
        label="Email address"
        name="email"
        type="email"
        defaultValue={state.values?.email}
        autoComplete="email"
        hint="The address you signed up with."
        required
      />
      <FormMessage error={state.error} signal={state} />
      <SubmitButton pendingLabel="Sending…">Send me a link</SubmitButton>
    </form>
  );
}
