"use client";

import { useActionState } from "react";
import { changeLearnerPasswordAction, removeLearnerAction } from "@/app/actions/account";
import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import type { FormState } from "@/lib/forms";

const initial: FormState = {};

/** What a parent can do about one child's account: a new password, or deleting it. */
export function ManageLearner({
  childId,
  name,
  username,
}: {
  childId: string;
  name: string;
  username: string;
}) {
  const [passwordState, passwordAction] = useActionState(changeLearnerPasswordAction, initial);
  const [removeState, removeAction] = useActionState(removeLearnerAction, initial);
  return (
    <div className="flex flex-col gap-4">
      <details className="rounded-2xl border border-border bg-surface p-5">
        <summary className="cursor-pointer text-lg font-semibold">
          Change {name}&apos;s password
        </summary>
        <form action={passwordAction} className="mt-4 flex flex-col gap-4" noValidate>
          <input type="hidden" name="child" value={childId} />
          <Field
            label="New password"
            name="password"
            type="password"
            error={passwordState.fieldErrors?.password}
            hint="At least 8 characters. Choose something your child can remember. If they were locked out by too many wrong tries, this lets them sign in again."
            autoComplete="new-password"
            required
          />
          <FormMessage
            error={passwordState.error}
            message={passwordState.message}
            signal={passwordState}
          />
          <SubmitButton pendingLabel="Changing…">Change password</SubmitButton>
        </form>
      </details>

      <details className="rounded-2xl border border-red-300 bg-surface p-5">
        <summary className="cursor-pointer text-lg font-semibold text-red-800">
          Delete {name}&apos;s account
        </summary>
        <form action={removeAction} className="mt-4 flex flex-col gap-4" noValidate>
          <input type="hidden" name="child" value={childId} />
          <p className="text-base">
            This deletes {name}&apos;s account and everything saved about it: their progress, every
            lesson, the questions they asked and the answers they gave, and their practice papers.
            It cannot be undone, and nobody at ZimTutor can get it back.
          </p>
          <Field
            label={`Type ${username} to show that you mean it`}
            name="confirm"
            error={removeState.fieldErrors?.confirm}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            required
          />
          <FormMessage error={removeState.error} signal={removeState} />
          <SubmitButton tone="danger" pendingLabel="Deleting…">
            Delete {name}&apos;s account and everything saved about it
          </SubmitButton>
        </form>
      </details>
    </div>
  );
}
