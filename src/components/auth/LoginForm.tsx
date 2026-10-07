"use client";

import { useActionState } from "react";
import { loginAction } from "@/app/actions/auth";
import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import type { FormState } from "@/lib/forms";

const initial: FormState = {};

export function LoginForm({ mode, next }: { mode: "learner" | "parent"; next: string }) {
  const [state, formAction] = useActionState(loginAction, initial);
  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="next" value={next} />
      {mode === "learner" ? (
        <Field
          label="Your username"
          name="username"
          defaultValue={state.values?.username}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
        />
      ) : (
        <Field
          label="Email address"
          name="email"
          type="email"
          defaultValue={state.values?.email}
          autoComplete="email"
          required
        />
      )}
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      <FormMessage error={state.error} />
      <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
    </form>
  );
}
