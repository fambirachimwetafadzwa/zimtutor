"use client";

import { useRef, useState } from "react";
import { Field, SelectField, TextAreaField } from "@/components/ui/form";
import {
  REVIEW_STATUSES,
  SOURCE_TYPES,
  SOURCE_TYPE_INFO,
  STATUS_LABELS,
  isOfficial,
  type SourceType,
} from "@/lib/supplemental/rules";

/**
 * The label controls shared by "add" and "relabel": category, review status and — for the two
 * official categories only — the citation (document, page and the exact wording).
 */
export function LabelFields({
  idPrefix,
  documents,
  errors,
  defaults,
}: {
  idPrefix: string;
  documents: Array<{ id: string; title: string }>;
  errors: Record<string, string>;
  defaults?: {
    sourceType?: string;
    verificationStatus?: string;
    sourceDocumentId?: string | null;
    sourcePage?: number | null;
    sourceText?: string | null;
  };
}) {
  const [sourceType, setSourceType] = useState<SourceType>(
    (defaults?.sourceType as SourceType | undefined) ?? "SUPPLEMENTAL",
  );
  const statusRef = useRef<HTMLSelectElement>(null);
  const official = isOfficial(sourceType);

  // The rules tie a label to a status: official labels are reviewed by definition, and content of
  // unknown origin cannot be called reviewed. Choosing the label moves the status to match.
  //
  // The selects are UNCONTROLLED (defaultValue): React resets a form's DOM after every Server
  // Action, which returns uncontrolled fields to their defaults — taken from what was submitted —
  // but would leave a controlled select showing its first option.
  function chooseSourceType(next: SourceType) {
    setSourceType(next);
    if (statusRef.current) {
      if (isOfficial(next)) statusRef.current.value = "ADMIN_REVIEWED";
      else if (next === "UNVERIFIED") statusRef.current.value = "UNVERIFIED";
    }
  }

  return (
    <>
      <SelectField
        label="Label"
        name="sourceType"
        defaultValue={sourceType}
        onChange={(e) => chooseSourceType(e.target.value as SourceType)}
        hint={SOURCE_TYPE_INFO[sourceType].description}
        error={errors.sourceType}
        options={SOURCE_TYPES.map((t) => ({ value: t, label: SOURCE_TYPE_INFO[t].label }))}
        id={`${idPrefix}-sourceType`}
      />
      <SelectField
        label="Review status"
        name="verificationStatus"
        ref={statusRef}
        defaultValue={
          defaults?.verificationStatus ?? (isOfficial(sourceType) ? "ADMIN_REVIEWED" : "UNVERIFIED")
        }
        error={errors.verificationStatus}
        options={REVIEW_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
        id={`${idPrefix}-verificationStatus`}
      />
      {official ? (
        <fieldset className="flex flex-col gap-4 rounded-xl border border-emerald-300 bg-emerald-50/50 p-4">
          <legend className="px-1 text-base font-semibold">
            Citation (required for official labels)
          </legend>
          <SelectField
            label="Source document"
            name="sourceDocumentId"
            defaultValue={defaults?.sourceDocumentId ?? documents[0]?.id ?? ""}
            error={errors.sourceDocumentId}
            options={documents.map((d) => ({ value: d.id, label: d.title }))}
            id={`${idPrefix}-sourceDocumentId`}
          />
          <Field
            label="Page (PDF page number)"
            name="sourcePage"
            type="number"
            min={1}
            defaultValue={defaults?.sourcePage ?? undefined}
            error={errors.sourcePage}
            id={`${idPrefix}-sourcePage`}
          />
          <TextAreaField
            label="Exact wording on that page"
            name="sourceText"
            defaultValue={defaults?.sourceText ?? ""}
            error={errors.sourceText}
            hint="Copied exactly as printed. It is checked against the stored text of the page."
            id={`${idPrefix}-sourceText`}
            rows={3}
          />
        </fieldset>
      ) : null}
    </>
  );
}
