"use client";

import { useActionState } from "react";
import { startPaperAction } from "@/app/actions/exam";
import { FormMessage } from "@/components/ui/form";
import type { FormState } from "@/lib/forms";

const initial: FormState = {};

export interface PaperChoice {
  paperNumber: 1 | 2;
  title: string;
  about: string;
  full: string;
  short: string;
}

/** Choose a paper and a length. Starting one takes the child straight to it. */
export function StartPaperForm({ choices }: { choices: readonly PaperChoice[] }) {
  const [state, formAction, pending] = useActionState(startPaperAction, initial);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <ul className="grid gap-4 sm:grid-cols-2">
        {choices.map((choice) => (
          <li
            key={choice.paperNumber}
            className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5"
          >
            <h3 className="text-xl font-bold">{choice.title}</h3>
            <p className="text-base text-muted">{choice.about}</p>
            <div className="flex flex-col gap-2">
              <button
                type="submit"
                name="start"
                value={`${choice.paperNumber}:FULL`}
                disabled={pending}
                className="min-h-12 rounded-xl bg-brand px-5 text-base font-bold text-brand-contrast disabled:opacity-50"
              >
                Full paper: {choice.full}
              </button>
              <button
                type="submit"
                name="start"
                value={`${choice.paperNumber}:SHORT`}
                disabled={pending}
                className="min-h-12 rounded-xl border-2 border-brand px-5 text-base font-bold text-brand hover:bg-brand hover:text-brand-contrast disabled:opacity-50"
              >
                Short paper: {choice.short}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <FormMessage error={state.error} />
      {pending ? (
        <p role="status" className="text-base text-muted">
          Putting your paper together…
        </p>
      ) : null}
    </form>
  );
}
