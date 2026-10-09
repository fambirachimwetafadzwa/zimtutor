import { Breadcrumbs } from "@/components/curriculum/Breadcrumbs";
import { AppPage } from "@/components/layout/PageShell";
import { SafetyReviewForm } from "@/components/admin/SafetyReviewForm";
import { requireRole } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { listFlagged } from "@/lib/safety/review";
import { CATEGORY_LABELS, OUTCOME_LABELS, countFlagged } from "@/lib/safety/rules";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = { title: "Flagged messages" };

export default async function SafetyPage() {
  await requireRole("admin", "/admin/safety");
  const db = await createSupabaseServerClient();
  const items = await listFlagged(db);
  const counts = countFlagged(items);

  return (
    <AppPage>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Flagged messages" }]} />
      <h1 className="text-3xl font-bold tracking-tight">Flagged messages</h1>
      <p className="text-lg text-muted">
        Messages from children that ZimTutor&apos;s safety screen flagged: ones that sounded
        worrying, and ones that held personal details (already replaced by [removed]). You can read
        these and nothing else of a conversation. The screen is a net, not a guarantee. Look at
        every message here, and follow your organisation&apos;s safeguarding procedure for anything
        that worries you: ZimTutor does not contact anyone itself.
      </p>

      <p
        role="status"
        className={`rounded-xl border px-4 py-3 text-lg ${
          counts.openWorrying > 0
            ? "border-red-300 bg-red-50 text-red-900"
            : counts.open > 0
              ? "border-amber-300 bg-amber-50 text-amber-950"
              : "border-emerald-300 bg-emerald-50 text-emerald-950"
        }`}
      >
        {counts.open === 0
          ? "Nothing is waiting for you."
          : `${counts.open} waiting for you${counts.openWorrying > 0 ? `, ${counts.openWorrying} of them sounded worrying` : ""}.`}{" "}
        {counts.reviewed} already reviewed.
      </p>

      {items.length === 0 ? (
        <p className="rounded-2xl border border-border bg-surface p-6 text-lg">
          The safety screen has not flagged any message yet.
        </p>
      ) : (
        <ol className="flex flex-col gap-4">
          {items.map((item) => (
            <li
              key={item.messageId}
              className={`flex flex-col gap-3 rounded-2xl border bg-surface p-5 shadow-sm ${
                item.review === null && item.categories.includes("WELLBEING")
                  ? "border-red-300"
                  : "border-border"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {item.categories.map((c) => (
                  <span
                    key={c}
                    className="rounded-full border border-border bg-background px-3 py-0.5 font-bold"
                  >
                    {CATEGORY_LABELS[c] ?? c}
                  </span>
                ))}
                <span className="text-muted">
                  {item.learnerName}
                  {item.grade ? ` · Grade ${item.grade}` : ""} · {formatDateTime(item.at)}
                </span>
              </div>
              <blockquote className="whitespace-pre-line rounded-xl border-l-4 border-border bg-background p-4 text-lg">
                {item.content}
              </blockquote>
              {item.review ? (
                <p className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-base text-emerald-950">
                  <strong>{OUTCOME_LABELS[item.review.outcome]}</strong>
                  {item.review.note ? `: ${item.review.note}` : ""}
                </p>
              ) : null}
              <details open={item.review === null}>
                <summary className="min-h-11 cursor-pointer text-base font-semibold">
                  {item.review ? "Change the decision" : "Record your decision"}
                </summary>
                <div className="mt-3">
                  <SafetyReviewForm messageId={item.messageId} current={item.review} />
                </div>
              </details>
            </li>
          ))}
        </ol>
      )}
    </AppPage>
  );
}
