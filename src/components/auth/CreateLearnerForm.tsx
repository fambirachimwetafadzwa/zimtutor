"use client";

import { useActionState } from "react";
import { createLearnerAction } from "@/app/actions/auth";
import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import type { FormState } from "@/lib/forms";

const initial: FormState = {};
const GRADES = [3, 4, 5, 6, 7] as const;

export function CreateLearnerForm() {
  const [state, formAction] = useActionState(createLearnerAction, initial);
  const errors = state.fieldErrors ?? {};
  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <Field
        label="Learner's first name or nickname"
        name="displayName"
        defaultValue={state.values?.displayName}
        error={errors.displayName}
        hint="This is shown to your child. Please don't use a full name."
        autoComplete="off"
        required
      />
      <Field
        label="Username"
        name="username"
        defaultValue={state.values?.username}
        error={errors.username}
        hint="Your child types this to sign in. 3–24 letters or numbers, no spaces."
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        autoComplete="off"
        required
      />
      <Field
        label="Password"
        name="password"
        type="password"
        error={errors.password}
        hint="At least 8 characters. Choose something your child can remember."
        autoComplete="new-password"
        required
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="text-base font-semibold">Grade</legend>
        <div className="flex flex-wrap gap-3">
          {GRADES.map((g) => (
            <label key={g} className="cursor-pointer">
              <input
                type="radio"
                name="grade"
                value={g}
                defaultChecked={state.values?.grade === String(g)}
                className="peer sr-only"
                required
              />
              <span className="inline-flex min-h-12 min-w-16 items-center justify-center rounded-xl border-2 border-border bg-surface px-4 text-lg font-semibold peer-checked:border-brand peer-checked:bg-brand peer-checked:text-brand-contrast peer-focus-visible:outline-3 peer-focus-visible:outline-accent">
                {g}
              </span>
            </label>
          ))}
        </div>
        {errors.grade ? (
          <p role="alert" className="text-sm font-medium text-red-700">
            {errors.grade}
          </p>
        ) : null}
      </fieldset>
      <FormMessage error={state.error} signal={state} />
      <SubmitButton pendingLabel="Creating…">Create learner account</SubmitButton>
    </form>
  );
}
