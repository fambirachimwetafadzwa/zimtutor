"use client";

import { useActionState } from "react";
import { signUpAction } from "@/app/actions/auth";
import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import type { FormState } from "@/lib/forms";

const initial: FormState = {};

export function SignUpForm() {
  const [state, formAction] = useActionState(signUpAction, initial);
  const errors = state.fieldErrors ?? {};
  if (state.ok) return <FormMessage message={state.message} />;
  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <Field
        label="Your first name or nickname"
        name="displayName"
        defaultValue={state.values?.displayName}
        autoComplete="given-name"
        error={errors.displayName}
        hint="Please don't use a full name or contact details."
        required
      />
      <Field
        label="Email address"
        name="email"
        type="email"
        defaultValue={state.values?.email}
        autoComplete="email"
        error={errors.email}
        required
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        error={errors.password}
        hint="At least 8 characters. A short phrase is easy to remember and hard to guess."
        required
      />
      <div className="flex flex-col gap-1.5">
        <label className="flex items-start gap-3 text-base">
          <input
            type="checkbox"
            name="isGuardian"
            defaultChecked={state.values?.isGuardian !== undefined}
            className="mt-1 size-5"
            required
          />
          <span>I am a parent or guardian, and I will manage any learner accounts I create.</span>
        </label>
        {errors.isGuardian ? (
          <p role="alert" className="text-sm font-medium text-red-700">
            {errors.isGuardian}
          </p>
        ) : null}
      </div>
      <FormMessage error={state.error} />
      <SubmitButton pendingLabel="Creating account…">Create parent account</SubmitButton>
    </form>
  );
}
