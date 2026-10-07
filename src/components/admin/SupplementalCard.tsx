import Link from "next/link";
import { RelabelForm } from "@/components/admin/SupplementalForms";
import { SourceTypeBadge, StatusBadge } from "@/components/curriculum/Badges";
import { KIND_LABELS, type Kind } from "@/lib/supplemental/rules";
import type { SupplementalItem } from "@/lib/supplemental/service";

/** One supplemental item with its label, citation (if official) and a control to change the label. */
export function SupplementalCard({
  item,
  documents,
  showObjectiveLink = false,
  objectiveId,
}: {
  item: SupplementalItem;
  documents: Array<{ id: string; title: string }>;
  showObjectiveLink?: boolean;
  objectiveId?: string;
}) {
  const documentTitle =
    documents.find((d) => d.id === item.source_document_id)?.title ?? item.source_document_id;
  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <SourceTypeBadge type={item.source_type} />
        <StatusBadge status={item.verification_status} />
        <span className="text-sm text-muted">{KIND_LABELS[item.kind as Kind] ?? item.kind}</span>
      </div>
      {item.title ? <h3 className="text-xl font-semibold">{item.title}</h3> : null}
      <p className="whitespace-pre-wrap">{item.body}</p>
      {item.source_document_id ? (
        <p className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm">
          Cited from <strong>{documentTitle}</strong>, PDF page {item.source_page}:{" "}
          <q>{item.source_text}</q>
        </p>
      ) : null}
      <p className="text-sm text-muted">
        Added {new Date(item.created_at).toLocaleDateString("en-GB")}
        {showObjectiveLink && item.objective_id ? (
          <>
            {" "}
            ·{" "}
            <Link
              href={`/admin/curriculum/objectives/${item.objective_id}`}
              className="underline underline-offset-4"
            >
              <code>{item.objective_id}</code>
            </Link>
          </>
        ) : null}
      </p>
      <details className="rounded-xl border border-border p-3">
        <summary className="min-h-11 cursor-pointer text-base font-semibold">Change label</summary>
        <div className="mt-3">
          <RelabelForm
            item={item}
            objectiveId={objectiveId ?? item.objective_id ?? undefined}
            documents={documents}
          />
        </div>
      </details>
    </article>
  );
}
