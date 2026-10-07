import Link from "next/link";
import { notFound } from "next/navigation";
import { AppPage } from "@/components/layout/PageShell";
import { SourceTypeBadge, StatusBadge } from "@/components/curriculum/Badges";
import { Breadcrumbs } from "@/components/curriculum/Breadcrumbs";
import { Citation, pageCitation } from "@/components/curriculum/Citation";
import { RowItems } from "@/components/curriculum/RowItems";
import { requireRole } from "@/lib/auth/session";
import { getObjectiveDetail, listDocuments } from "@/lib/curriculum/queries";
import { listSupplemental } from "@/lib/supplemental/service";
import { AddSupplementalForm } from "@/components/admin/SupplementalForms";
import { SupplementalCard } from "@/components/admin/SupplementalCard";
import { topicSlug } from "@/lib/curriculum/schemas";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { id } = await params;
  return { title: `Objective ${id}` };
}

export default async function ObjectivePage({ params }: { params: Params }) {
  const { id } = await params;
  await requireRole("admin", `/admin/curriculum/objectives/${id}`);
  const db = await createSupabaseServerClient();
  const [detail, supplemental, documents] = await Promise.all([
    getObjectiveDetail(db, id),
    listSupplemental(db, { objectiveId: id }),
    listDocuments(db),
  ]);
  if (!detail) notFound();
  const { context: c, document, row, siblings, chunk } = detail;

  const index = siblings.findIndex((s) => s.id === c.objective_id);
  const previous = index > 0 ? siblings[index - 1] : undefined;
  const next = index >= 0 ? siblings[index + 1] : undefined;
  const sameRow = siblings.filter(
    (s) => s.competency_row_id === c.competency_row_id && s.id !== c.objective_id,
  );
  const topicHref = `/admin/curriculum/${c.grade}/${topicSlug(c.topic_code)}`;

  return (
    <AppPage>
      <Breadcrumbs
        items={[
          { label: "Admin", href: "/admin" },
          { label: "Curriculum", href: "/admin/curriculum" },
          { label: `Grade ${c.grade}`, href: topicHref },
          { label: c.topic_name, href: topicHref },
          { label: c.subtopic_short_name, href: `${topicHref}#${c.subtopic_id}` },
          { label: c.objective_id },
        ]}
      />

      <header className="flex flex-col gap-3">
        <p className="text-base text-muted">Pupils should be able to:</p>
        <h1 className="text-3xl font-bold tracking-tight">{c.objective_text}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <SourceTypeBadge type={c.source_type} />
          <StatusBadge status={c.verification_status} />
          <code className="rounded bg-background px-2 py-0.5 text-sm">{c.objective_id}</code>
        </div>
        <p className="text-sm text-muted">
          The identifier is ZimTutor&apos;s own, derived from the grade, topic, sub-topic and order.
          It is not a Ministry identifier.
        </p>
      </header>

      <section
        aria-labelledby="provenance"
        className="rounded-2xl border border-border bg-surface p-5 shadow-sm"
      >
        <h2 id="provenance" className="text-2xl font-semibold">
          Where this comes from
        </h2>
        <dl className="mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-[max-content_1fr]">
          <dt className="font-semibold">Document</dt>
          <dd>{document.title}</dd>
          <dt className="font-semibold">Organisation</dt>
          <dd>{c.organisation}</dd>
          <dt className="font-semibold">Curriculum year</dt>
          <dd>{c.curriculum_year}</dd>
          <dt className="font-semibold">Location</dt>
          <dd>{pageCitation(c.source_page, c.source_page_label, c.source_page_end)}</dd>
          <dt className="font-semibold">Hierarchy</dt>
          <dd>
            {c.subject_name} › Grade {c.grade} › {c.topic_name}
            {c.topic_scope_text ? ` (${c.topic_scope_text})` : ""} › {c.subtopic_name}
            {c.subtopic_group_name ? ` — group “${c.subtopic_group_name}”` : ""}
          </dd>
          <dt className="font-semibold">Source checksum</dt>
          <dd className="break-all text-sm">{document.sha256}</dd>
        </dl>
        <h3 className="mt-4 text-base font-semibold">Wording exactly as extracted from the page</h3>
        <blockquote className="mt-1 border-l-4 border-border pl-4 text-lg">
          {c.source_text}
        </blockquote>
      </section>

      <section aria-labelledby="row-content" className="flex flex-col gap-4">
        <div>
          <h2 id="row-content" className="text-2xl font-semibold">
            The printed row this objective belongs to
          </h2>
          <p className="text-muted">
            The syllabus prints objectives, content, activities and resources side by side. They are
            shared by every objective in the row; the syllabus does not pair them one-to-one.{" "}
            <Citation
              page={row.source_page}
              label={row.source_page_label}
              end={row.source_page_end}
            />
          </p>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          <Panel title="Content">
            <RowItems items={row.curriculum_content} />
          </Panel>
          <Panel title="Suggested notes and activities">
            <RowItems items={row.curriculum_activities} />
          </Panel>
          <Panel title="Suggested resources">
            <RowItems items={row.curriculum_resources} />
          </Panel>
        </div>
        {sameRow.length > 0 ? (
          <Panel title="Other objectives in this row">
            <ul className="flex list-disc flex-col gap-1.5 pl-5">
              {sameRow.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/admin/curriculum/objectives/${s.id}`}
                    className="underline underline-offset-4"
                  >
                    {s.text}
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}
      </section>

      <section aria-labelledby="supplemental" className="flex flex-col gap-4">
        <div>
          <h2 id="supplemental" className="text-2xl font-semibold">
            Supplemental material for this objective
          </h2>
          <p className="text-muted">
            Anything added here sits beside the official curriculum and keeps its own label. It
            never changes the official text above.
          </p>
        </div>
        {supplemental.length === 0 ? (
          <p className="rounded-xl border border-border bg-surface p-4">
            Nothing has been added yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {supplemental.map((item) => (
              <li key={item.id}>
                <SupplementalCard item={item} documents={documents} objectiveId={c.objective_id} />
              </li>
            ))}
          </ul>
        )}
        <details className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <summary className="min-h-11 cursor-pointer text-lg font-semibold">
            Add material for this objective
          </summary>
          <div className="mt-4">
            <AddSupplementalForm objectiveId={c.objective_id} documents={documents} />
          </div>
        </details>
      </section>

      <section aria-labelledby="chunk" className="flex flex-col gap-2">
        <h2 id="chunk" className="text-2xl font-semibold">
          What the tutor retrieves
        </h2>
        {chunk ? (
          <>
            <p className="text-muted">
              This exact text is what curriculum retrieval returns for this objective
              {chunk.embeddingModel
                ? ` (embedded with ${chunk.embeddingModel})`
                : " (not embedded yet)"}
              .
            </p>
            <pre className="overflow-x-auto rounded-2xl border border-border bg-surface p-4 text-sm whitespace-pre-wrap">
              {chunk.content}
            </pre>
          </>
        ) : (
          <p
            role="alert"
            className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900"
          >
            No retrieval chunk exists for this objective. Run <code>npm run curriculum:load</code>.
          </p>
        )}
      </section>

      <nav
        aria-label="Neighbouring objectives"
        className="flex flex-wrap justify-between gap-3 border-t border-border pt-4"
      >
        {previous ? (
          <Link
            href={`/admin/curriculum/objectives/${previous.id}`}
            className="inline-flex min-h-12 items-center rounded-xl border border-border bg-surface px-4 hover:bg-background"
          >
            ← {previous.text}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link
            href={`/admin/curriculum/objectives/${next.id}`}
            className="inline-flex min-h-12 items-center rounded-xl border border-border bg-surface px-4 hover:bg-background"
          >
            {next.text} →
          </Link>
        ) : null}
      </nav>
    </AppPage>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <h3 className="text-base font-bold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </div>
  );
}
