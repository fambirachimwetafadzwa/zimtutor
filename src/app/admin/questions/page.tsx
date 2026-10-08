import Link from "next/link";
import { reviewQuestionAction } from "@/app/actions/review";
import { Breadcrumbs } from "@/components/curriculum/Breadcrumbs";
import { AppPage } from "@/components/layout/PageShell";
import { Picture } from "@/components/learn/pictures";
import { requireRole } from "@/lib/auth/session";
import { keepNumbersTogether } from "@/lib/format";
import {
  FILTERS,
  PAGE_SIZE,
  listQuestions,
  readKeys,
  type QuestionFilter,
  type ReviewAction,
  type ReviewRow,
} from "@/lib/questions/review";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = { title: "Practice questions" };

type Search = Promise<Record<string, string | string[] | undefined>>;

const one = (value: string | string[] | undefined): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

const VERIFICATION_LABEL: Record<string, string> = {
  UNVERIFIED: "Not yet checked",
  ADMIN_REVIEWED: "Checked by a teacher",
  REJECTED: "Rejected",
};

function parseFilter(params: Awaited<Search>): QuestionFilter {
  const verification = one(params.verification);
  const grade = one(params.grade);
  const type = one(params.type);
  const page = Number(one(params.page) ?? 1);
  return {
    ...(verification && (FILTERS.verification as readonly string[]).includes(verification)
      ? { verification }
      : {}),
    ...(grade && (FILTERS.grade as readonly string[]).includes(grade)
      ? { grade: Number(grade) }
      : {}),
    ...(type && (FILTERS.type as readonly string[]).includes(type) ? { type } : {}),
    ...(one(params.objective) ? { objective: one(params.objective)! } : {}),
    ...(one(params.template) ? { template: one(params.template)! } : {}),
    page: Number.isInteger(page) && page >= 1 ? Math.min(page, 10_000) : 1,
  };
}

function actionsFor(row: ReviewRow): Array<{ action: ReviewAction; label: string; style: string }> {
  const approve = {
    action: "APPROVE" as const,
    label: "Approve",
    style: "bg-brand text-brand-contrast",
  };
  const reject = {
    action: "REJECT" as const,
    label: "Reject and retire",
    style: "border-2 border-red-700 text-red-800",
  };
  const reopen = {
    action: "REOPEN" as const,
    label: "Reopen",
    style: "border-2 border-border",
  };
  if (row.verification === "ADMIN_REVIEWED") return [reject, reopen];
  if (row.verification === "REJECTED") return [approve, reopen];
  return [approve, reject];
}

export default async function QuestionsPage({ searchParams }: { searchParams: Search }) {
  await requireRole("admin", "/admin/questions");
  const filter = parseFilter(await searchParams);
  const db = await createSupabaseServerClient();
  const result = await listQuestions(db, filter);
  // The answers are shown so that a reviewer can check them. They are read with the server's own key,
  // after the administrator has been verified above, and never leave this page.
  const keys = await readKeys(createSupabaseAdminClient(), result.rows);

  const link = (page: number) => {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(filter))
      if (k !== "page" && v !== undefined) query.set(k, String(v));
    query.set("page", String(page));
    return `/admin/questions?${query.toString()}`;
  };

  return (
    <AppPage>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Practice questions" }]} />
      <h1 className="text-3xl font-bold tracking-tight">Practice questions</h1>
      <p className="text-lg text-muted">
        The questions ZimTutor has made. A template writes each one and a program checks it, but no
        person has looked at it until you approve it. An approved question is shown to children as
        &ldquo;checked by a teacher&rdquo;; a rejected one is never asked again. Answers are shown
        here so that you can check them: please keep this page to administrators.
      </p>

      <form
        method="get"
        className="grid gap-3 rounded-2xl border border-border bg-surface p-4 sm:grid-cols-5"
      >
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Checked?
          <select
            name="verification"
            defaultValue={filter.verification ?? ""}
            className="min-h-11 rounded-xl border border-border bg-surface px-3 text-base font-normal"
          >
            <option value="">Any</option>
            {FILTERS.verification.map((v) => (
              <option key={v} value={v}>
                {VERIFICATION_LABEL[v]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Grade
          <select
            name="grade"
            defaultValue={filter.grade ? String(filter.grade) : ""}
            className="min-h-11 rounded-xl border border-border bg-surface px-3 text-base font-normal"
          >
            <option value="">Any</option>
            {FILTERS.grade.map((g) => (
              <option key={g} value={g}>
                Grade {g}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Kind of question
          <select
            name="type"
            defaultValue={filter.type ?? ""}
            className="min-h-11 rounded-xl border border-border bg-surface px-3 text-base font-normal"
          >
            <option value="">Any</option>
            {FILTERS.type.map((t) => (
              <option key={t} value={t}>
                {t.toLowerCase().replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Objective starts with
          <input
            name="objective"
            defaultValue={filter.objective ?? ""}
            placeholder="G5-OPS"
            className="min-h-11 rounded-xl border border-border bg-surface px-3 text-base font-normal"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Template starts with
          <input
            name="template"
            defaultValue={filter.template ?? ""}
            placeholder="ops.tf"
            className="min-h-11 rounded-xl border border-border bg-surface px-3 text-base font-normal"
          />
        </label>
        <button
          type="submit"
          className="min-h-11 rounded-xl bg-brand px-5 text-base font-bold text-brand-contrast sm:col-span-5 sm:justify-self-start"
        >
          Show these
        </button>
      </form>

      <p className="text-base text-muted" role="status">
        {result.total === 0
          ? "No question matches."
          : `${result.total} ${result.total === 1 ? "question" : "questions"}, ${PAGE_SIZE} to a page. Page ${result.page} of ${result.pages}.`}
      </p>

      <ol className="flex flex-col gap-5">
        {result.rows.map((row) => {
          const q = row.question;
          const key = keys.get(q.id);
          return (
            <li
              key={q.id}
              className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5 shadow-sm"
            >
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <span className="rounded-full border border-border bg-background px-3 py-0.5 font-bold">
                  {VERIFICATION_LABEL[row.verification] ?? row.verification}
                </span>
                <span className="text-muted">
                  Grade {q.grade} · level {q.difficulty} ·{" "}
                  {q.type.toLowerCase().replaceAll("_", " ")} · {row.status.toLowerCase()}
                </span>
              </p>
              <p className="text-sm text-muted">
                <Link
                  href={`/admin/curriculum/objectives/${encodeURIComponent(q.objectiveId)}`}
                  className="font-mono underline"
                >
                  {q.objectiveId}
                </Link>{" "}
                {row.objectiveText} · <code>{row.generator}</code>
              </p>
              <p className="whitespace-pre-line text-xl">{keepNumbersTogether(q.stem)}</p>
              {q.stemData ? <Picture data={q.stemData} /> : null}
              {q.options ? (
                <ul className="flex flex-col gap-1 text-lg">
                  {q.options.map((o) => (
                    <li key={o.id}>
                      <strong>{o.id}.</strong> {keepNumbersTogether(o.text)}
                    </li>
                  ))}
                </ul>
              ) : null}
              {q.items ? <p className="text-lg">To arrange: {q.items.join(" · ")}</p> : null}
              {q.matching ? (
                <p className="text-lg">
                  Match: {q.matching.left.join(" · ")} with {q.matching.right.join(" · ")}
                </p>
              ) : null}
              {key ? (
                <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-base text-emerald-950">
                  <p>
                    <strong>Right answer:</strong> {keepNumbersTogether(key.answer)}
                  </p>
                  <details className="mt-1">
                    <summary className="min-h-11 cursor-pointer font-semibold">
                      Hints and explanation
                    </summary>
                    <ol className="mt-1 list-decimal pl-6">
                      {key.hints.map((h, i) => (
                        <li key={i}>{keepNumbersTogether(h)}</li>
                      ))}
                    </ol>
                    <p className="mt-2">{keepNumbersTogether(key.explanation)}</p>
                  </details>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-3">
                {actionsFor(row).map((a) => (
                  <form key={a.action} action={reviewQuestionAction}>
                    <input type="hidden" name="questionId" value={q.id} />
                    <button
                      type="submit"
                      name="action"
                      value={a.action}
                      className={`min-h-11 rounded-xl px-5 text-base font-bold ${a.style}`}
                    >
                      {a.label}
                    </button>
                  </form>
                ))}
              </div>
            </li>
          );
        })}
      </ol>

      {result.pages > 1 ? (
        <nav aria-label="Pages" className="flex flex-wrap gap-3">
          {result.page > 1 ? (
            <Link href={link(result.page - 1)} className="font-semibold text-brand underline">
              ← Earlier
            </Link>
          ) : null}
          {result.page < result.pages ? (
            <Link href={link(result.page + 1)} className="font-semibold text-brand underline">
              Later →
            </Link>
          ) : null}
        </nav>
      ) : null}
    </AppPage>
  );
}
