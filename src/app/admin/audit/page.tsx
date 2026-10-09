import { AppPage } from "@/components/layout/PageShell";
import { Breadcrumbs } from "@/components/curriculum/Breadcrumbs";
import { requireRole } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listAuditLog } from "@/lib/supplemental/service";

export const metadata = { title: "Audit log" };

const ACTION_LABELS: Record<string, string> = {
  SUPPLEMENTAL_CREATED: "Added supplemental content",
  SUPPLEMENTAL_RELABELLED: "Changed a content label",
  SAFETY_REVIEWED: "Reviewed a flagged message",
  SAFETY_RE_REVIEWED: "Changed a decision about a flagged message",
  QUESTION_APPROVED: "Approved a practice question",
  QUESTION_REJECTED: "Rejected a practice question",
  QUESTION_REOPENED: "Reopened a decision about a practice question",
};

export default async function AuditPage() {
  await requireRole("admin", "/admin/audit");
  const db = await createSupabaseServerClient();
  const entries = await listAuditLog(db, 100);

  return (
    <AppPage>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Audit log" }]} />
      <h1 className="text-3xl font-bold tracking-tight">Audit log</h1>
      <p className="text-lg text-muted">
        Every change an administrator makes to labelled content, with the state before and after.
        Entries cannot be edited or deleted from the application. Times are Zimbabwe time (UTC+2).
      </p>
      {entries.length === 0 ? (
        <p className="rounded-2xl border border-border bg-surface p-6 text-lg">
          No changes have been recorded yet.
        </p>
      ) : (
        <ol className="flex flex-col gap-3">
          {entries.map((e) => (
            <li key={e.id} className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
              <p className="font-semibold">{ACTION_LABELS[e.action] ?? e.action}</p>
              <p className="text-sm text-muted">
                {formatDateTime(e.created_at)} · {e.entity_type} <code>{e.entity_id}</code>
              </p>
              <details className="mt-2">
                <summary className="min-h-11 cursor-pointer text-base">
                  Show before and after
                </summary>
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  <State title="Before" value={e.before_state} />
                  <State title="After" value={e.after_state} />
                </div>
              </details>
            </li>
          ))}
        </ol>
      )}
    </AppPage>
  );
}

function State({ title, value }: { title: string; value: unknown }) {
  return (
    <div>
      <h3 className="text-sm font-bold uppercase tracking-wide text-muted">{title}</h3>
      <pre className="overflow-x-auto rounded-xl bg-background p-3 text-sm whitespace-pre-wrap">
        {value === null || value === undefined ? "—" : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
