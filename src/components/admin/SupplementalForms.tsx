"use client";

import { useActionState } from "react";
import { createSupplementalAction, relabelSupplementalAction } from "@/app/actions/supplemental";
import { LabelFields } from "@/components/admin/LabelFields";
import { Field, FormMessage, SelectField, SubmitButton, TextAreaField } from "@/components/ui/form";
import type { FormState } from "@/lib/forms";
import { KINDS, KIND_LABELS } from "@/lib/supplemental/rules";

const initial: FormState = {};
type Documents = Array<{ id: string; title: string }>;

/** Label defaults taken from what was just submitted (so a refused save keeps everything typed). */
function submittedLabel(values: Record<string, string> | undefined) {
  return {
    sourceType: values?.sourceType,
    verificationStatus: values?.verificationStatus,
    sourceDocumentId: values?.sourceDocumentId,
    sourcePage: values?.sourcePage ? Number(values.sourcePage) : undefined,
    sourceText: values?.sourceText,
  };
}

export function AddSupplementalForm({
  objectiveId,
  documents,
}: {
  objectiveId: string;
  documents: Documents;
}) {
  const [state, formAction] = useActionState(createSupplementalAction, initial);
  const errors = state.fieldErrors ?? {};
  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="objectiveId" value={objectiveId} />
      <SelectField
        label="Kind of material"
        name="kind"
        id="add-kind"
        defaultValue={state.values?.kind ?? "NOTE"}
        error={errors.kind}
        options={KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }))}
      />
      <Field
        label="Title (optional)"
        name="title"
        id="add-title"
        defaultValue={state.values?.title}
        error={errors.title}
        maxLength={120}
      />
      <TextAreaField
        label="Content"
        name="body"
        id="add-body"
        defaultValue={state.values?.body}
        error={errors.body}
        required
      />
      <LabelFields
        // Controlled fields are re-created after every result (see FormState.nonce).
        key={state.nonce ?? "initial"}
        idPrefix="add"
        documents={documents}
        errors={errors}
        defaults={submittedLabel(state.values)}
      />
      <FormMessage error={state.error} message={state.message} />
      <SubmitButton pendingLabel="Saving…">Save with this label</SubmitButton>
    </form>
  );
}

export function RelabelForm({
  item,
  objectiveId,
  documents,
}: {
  item: {
    id: string;
    source_type: string;
    verification_status: string;
    source_document_id: string | null;
    source_page: number | null;
    source_text: string | null;
  };
  objectiveId?: string;
  documents: Documents;
}) {
  const [state, formAction] = useActionState(relabelSupplementalAction, initial);
  const errors = state.fieldErrors ?? {};
  const prefix = `relabel-${item.id}`;
  const submitted = submittedLabel(state.values);
  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="id" value={item.id} />
      {objectiveId ? <input type="hidden" name="objectiveId" value={objectiveId} /> : null}
      <LabelFields
        // Re-created when the stored label changes, so it always starts from the stored state.
        key={`${item.source_type}-${item.verification_status}-${state.nonce ?? "initial"}`}
        idPrefix={prefix}
        documents={documents}
        errors={errors}
        defaults={{
          sourceType: submitted.sourceType ?? item.source_type,
          verificationStatus:
            submitted.verificationStatus ??
            (item.verification_status === "VERIFIED_FROM_SOURCE"
              ? "ADMIN_REVIEWED"
              : item.verification_status),
          sourceDocumentId: submitted.sourceDocumentId ?? item.source_document_id,
          sourcePage: submitted.sourcePage ?? item.source_page,
          sourceText: submitted.sourceText ?? item.source_text,
        }}
      />
      <Field
        label="Reason for the change (kept in the audit log)"
        name="reason"
        id={`${prefix}-reason`}
        defaultValue={state.values?.reason}
        error={errors.reason}
        maxLength={500}
      />
      <FormMessage error={state.error} message={state.message} />
      <SubmitButton pendingLabel="Saving…">Change label</SubmitButton>
    </form>
  );
}
