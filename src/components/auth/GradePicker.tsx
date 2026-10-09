"use client";

import { useActionState } from "react";
import { setGradeAction } from "@/app/actions/auth";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import type { FormState } from "@/lib/forms";

const initial: FormState = {};
const GRADES = [3, 4, 5, 6, 7] as const;

export function GradePicker({ current }: { current?: number }) {
  const [state, formAction] = useActionState(setGradeAction, initial);
  return (
    <form action={formAction} className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">Choose your grade</legend>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {GRADES.map((g) => (
            <label key={g} className="cursor-pointer">
              <input
                type="radio"
                name="grade"
                value={g}
                defaultChecked={current === g}
                className="peer sr-only"
                required
              />
              <span className="flex min-h-24 flex-col items-center justify-center rounded-2xl border-2 border-border bg-surface text-xl font-bold shadow-sm peer-checked:border-brand peer-checked:bg-brand peer-checked:text-brand-contrast peer-focus-visible:outline-3 peer-focus-visible:outline-accent">
                <span className="text-sm font-medium opacity-80">Grade</span>
                <span className="text-3xl">{g}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <FormMessage error={state.error} signal={state} />
      <SubmitButton pendingLabel="Saving…">Continue</SubmitButton>
    </form>
  );
}
