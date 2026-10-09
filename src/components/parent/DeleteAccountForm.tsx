"use client";

import { useActionState } from "react";
import { deleteMyAccountAction } from "@/app/actions/account";
import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import type { FormState } from "@/lib/forms";

const initial: FormState = {};

/** Delete a parent's own account, and the accounts of the children they alone look after. */
export function DeleteAccountForm() {
  const [state, formAction] = useActionState(deleteMyAccountAction, initial);
  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <Field
        label="Your password"
        name="password"
        type="password"
        error={state.fieldErrors?.password}
        autoComplete="current-password"
        required
      />
      <Field
        label="Type the word delete to show that you mean it"
        name="confirm"
        error={state.fieldErrors?.confirm}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        autoComplete="off"
        required
      />
      <FormMessage error={state.error} signal={state} />
      <SubmitButton tone="danger" pendingLabel="Deleting…">
        Delete my account and everything saved about it
      </SubmitButton>
    </form>
  );
}
