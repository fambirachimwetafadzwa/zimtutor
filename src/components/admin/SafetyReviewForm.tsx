"use client";

import { useActionState } from "react";
import { reviewFlaggedAction } from "@/app/actions/review";
import { FormMessage, SelectField, SubmitButton, TextAreaField } from "@/components/ui/form";
import type { FormState } from "@/lib/forms";
import { OUTCOMES, OUTCOME_LABELS, type Outcome } from "@/lib/safety/rules";

const initial: FormState = {};

export function SafetyReviewForm({
  messageId,
  current,
}: {
  messageId: string;
  current: { outcome: Outcome; note: string | null } | null;
}) {
  const [state, formAction] = useActionState(reviewFlaggedAction, initial);
  const errors = state.fieldErrors ?? {};
  const id = `review-${messageId}`;
  return (
    <form action={formAction} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="messageId" value={messageId} />
      <SelectField
        label="Your decision"
        name="outcome"
        id={`${id}-outcome`}
        defaultValue={state.values?.outcome ?? current?.outcome ?? ""}
        error={errors.outcome}
        options={[
          { value: "", label: "Choose…" },
          ...OUTCOMES.map((o) => ({ value: o, label: OUTCOME_LABELS[o] })),
        ]}
      />
      <TextAreaField
        label="Note (optional)"
        name="note"
        id={`${id}-note`}
        defaultValue={state.values?.note ?? current?.note ?? ""}
        error={errors.note}
        hint="Do not write the child's name, contact details or anything else that identifies them."
        maxLength={1000}
      />
      <FormMessage error={state.error} message={state.message} />
      <SubmitButton pendingLabel="Saving…">
        {current ? "Change my decision" : "Save my decision"}
      </SubmitButton>
    </form>
  );
}
