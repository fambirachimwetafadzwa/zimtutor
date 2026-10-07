import Link from "next/link";
import { notFound } from "next/navigation";
import { AppPage } from "@/components/layout/PageShell";
import { Breadcrumbs } from "@/components/curriculum/Breadcrumbs";
import { Citation } from "@/components/curriculum/Citation";
import { RowItems } from "@/components/curriculum/RowItems";
import { requireRole } from "@/lib/auth/session";
import { getTopicMatrix } from "@/lib/curriculum/queries";
import { GRADES, TOPIC_NAMES, topicCodeFromSlug } from "@/lib/curriculum/schemas";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Params = Promise<{ grade: string; topic: string }>;

function parseParams(grade: string, topic: string) {
  const g = Number(grade);
  const code = topicCodeFromSlug(topic);
  if (!Number.isInteger(g) || !(GRADES as readonly number[]).includes(g) || !code) return null;
  return { grade: g, code };
}

export async function generateMetadata({ params }: { params: Params }) {
  const { grade, topic } = await params;
  const parsed = parseParams(grade, topic);
  return { title: parsed ? `Grade ${parsed.grade} · ${TOPIC_NAMES[parsed.code]}` : "Curriculum" };
}

export default async function TopicPage({ params }: { params: Params }) {
  const { grade, topic } = await params;
  const parsed = parseParams(grade, topic);
  if (!parsed) notFound();
  await requireRole("admin", `/admin/curriculum/${grade}/${topic}`);

  const db = await createSupabaseServerClient();
  const matrix = await getTopicMatrix(db, parsed.grade, parsed.code);
  if (!matrix) notFound();
  const { topic: summary, subtopics } = matrix;

  return (
    <AppPage>
      <Breadcrumbs
        items={[
          { label: "Admin", href: "/admin" },
          { label: "Curriculum", href: "/admin/curriculum" },
          { label: `Grade ${parsed.grade}` },
          { label: summary.topic_name },
        ]}
      />
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">
          Grade {parsed.grade} · {summary.topic_name}
          {summary.scope_text ? (
            <span className="font-normal text-muted"> ({summary.scope_text})</span>
          ) : null}
        </h1>
        <p className="text-muted">
          As printed: <q>{summary.heading_text}</q> ·{" "}
          <Citation page={summary.source_page} label={summary.source_page_label} /> ·{" "}
          {summary.subtopic_count} sub-topics · {summary.objective_count} objectives
        </p>
      </header>

      <nav aria-label="Sub-topics in this topic">
        <ol className="flex flex-wrap gap-2">
          {subtopics.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="inline-flex min-h-11 items-center rounded-xl border border-border bg-surface px-3 text-base hover:bg-background"
              >
                {s.ordinal}. {s.short_name}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {subtopics.map((subtopic) => (
        <section
          key={subtopic.id}
          id={subtopic.id}
          aria-labelledby={`${subtopic.id}-heading`}
          className="flex scroll-mt-6 flex-col gap-4"
        >
          <div className="flex flex-col gap-1 border-b border-border pb-2">
            {subtopic.group_name ? (
              <p className="text-base font-semibold text-muted">{subtopic.group_name}</p>
            ) : null}
            <h2 id={`${subtopic.id}-heading`} className="text-2xl font-semibold">
              {subtopic.ordinal}. {subtopic.name}
            </h2>
            <p className="text-sm text-muted">
              <code>{subtopic.id}</code> ·{" "}
              <Citation
                page={subtopic.source_page}
                label={subtopic.source_page_label}
                end={subtopic.source_page_end}
              />
            </p>
          </div>

          {subtopic.competency_rows.map((row) => (
            <article
              key={row.id}
              aria-label={`Row ${row.ordinal} of ${subtopic.short_name}`}
              className="rounded-2xl border border-border bg-surface p-5 shadow-sm"
            >
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
                <div className="flex flex-col gap-2">
                  <h3 className="text-base font-bold uppercase tracking-wide text-muted">
                    Objectives
                  </h3>
                  <p className="text-sm text-muted">Pupils should be able to:</p>
                  <ul className="flex flex-col gap-2">
                    {row.learning_objectives.map((o) => (
                      <li key={o.id}>
                        <Link
                          href={`/admin/curriculum/objectives/${o.id}`}
                          className="font-semibold underline underline-offset-4"
                        >
                          {o.text}
                        </Link>
                        <div className="text-xs text-muted">
                          <code>{o.id}</code>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex flex-col gap-2">
                  <h3 className="text-base font-bold uppercase tracking-wide text-muted">
                    Content
                  </h3>
                  <RowItems items={row.curriculum_content} />
                </div>
                <div className="flex flex-col gap-2">
                  <h3 className="text-base font-bold uppercase tracking-wide text-muted">
                    Suggested notes and activities
                  </h3>
                  <RowItems items={row.curriculum_activities} />
                </div>
                <div className="flex flex-col gap-2">
                  <h3 className="text-base font-bold uppercase tracking-wide text-muted">
                    Suggested resources
                  </h3>
                  <RowItems items={row.curriculum_resources} />
                </div>
              </div>
              <p className="mt-4 border-t border-border pt-2">
                <Citation
                  page={row.source_page}
                  label={row.source_page_label}
                  end={row.source_page_end}
                />
              </p>
            </article>
          ))}
        </section>
      ))}
    </AppPage>
  );
}
