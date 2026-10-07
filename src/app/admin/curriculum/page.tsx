import Link from "next/link";
import { AppPage } from "@/components/layout/PageShell";
import { Breadcrumbs } from "@/components/curriculum/Breadcrumbs";
import { requireRole } from "@/lib/auth/session";
import { listTopicSummaries, searchObjectives } from "@/lib/curriculum/queries";
import { GRADES, topicSlug } from "@/lib/curriculum/schemas";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = { title: "Curriculum" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function CurriculumIndex({ searchParams }: { searchParams: SearchParams }) {
  await requireRole("admin", "/admin/curriculum");
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.slice(0, 80) : "";
  const db = await createSupabaseServerClient();
  const [topics, hits] = await Promise.all([
    listTopicSummaries(db),
    q ? searchObjectives(db, q) : Promise.resolve([]),
  ]);

  return (
    <AppPage>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Curriculum" }]} />
      <h1 className="text-3xl font-bold tracking-tight">Curriculum browser</h1>
      <p className="text-lg text-muted">
        Grade → Topic → Sub-topic → Objective, exactly as the Revised Junior Mathematics Syllabus
        2024–2030 prints them. Every record shows where in the syllabus it comes from.
      </p>

      <form role="search" className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-64 flex-1 flex-col gap-1.5">
          <label htmlFor="q" className="text-base font-semibold">
            Search objectives
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q}
            placeholder="for example: compare fractions"
            className="min-h-12 rounded-xl border border-border bg-surface px-4 text-lg shadow-sm"
          />
        </div>
        <button
          type="submit"
          className="inline-flex min-h-12 items-center rounded-xl bg-brand px-6 text-lg font-semibold text-brand-contrast hover:brightness-110"
        >
          Search
        </button>
      </form>

      {q ? (
        <section aria-labelledby="results-heading" className="flex flex-col gap-3">
          <h2 id="results-heading" className="text-2xl font-semibold">
            {hits.length === 0
              ? `No objectives match “${q}”`
              : `${hits.length} objective${hits.length === 1 ? "" : "s"} match “${q}”`}
          </h2>
          <ul className="flex flex-col gap-2">
            {hits.map((hit) => (
              <li key={hit.objective_id} className="rounded-xl border border-border bg-surface p-4">
                <Link
                  href={`/admin/curriculum/objectives/${hit.objective_id}`}
                  className="text-lg font-semibold underline underline-offset-4"
                >
                  {hit.objective_text}
                </Link>
                <p className="text-sm text-muted">
                  Grade {hit.grade} · {hit.topic_name} · {hit.subtopic_short_name} ·{" "}
                  <code>{hit.objective_id}</code>
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-5 md:grid-cols-2">
        {GRADES.map((grade) => (
          <section
            key={grade}
            aria-labelledby={`grade-${grade}`}
            className="rounded-2xl border border-border bg-surface p-5 shadow-sm"
          >
            <h2 id={`grade-${grade}`} className="text-2xl font-semibold">
              Grade {grade}
            </h2>
            <ul className="mt-3 flex flex-col gap-2">
              {topics
                .filter((t) => t.grade === grade)
                .map((t) => (
                  <li key={t.topic_id}>
                    <Link
                      href={`/admin/curriculum/${grade}/${topicSlug(t.topic_code)}`}
                      className="flex min-h-12 flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-4 py-2 hover:bg-background"
                    >
                      <span className="text-lg font-semibold">{t.topic_name}</span>
                      <span className="text-sm text-muted">
                        {t.subtopic_count} sub-topic{t.subtopic_count === 1 ? "" : "s"} ·{" "}
                        {t.objective_count} objective
                        {t.objective_count === 1 ? "" : "s"}
                      </span>
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </AppPage>
  );
}
