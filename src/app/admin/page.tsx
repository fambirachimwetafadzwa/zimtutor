import Link from "next/link";
import { AppPage } from "@/components/layout/PageShell";
import { requireRole } from "@/lib/auth/session";
import { getCurriculumDocument, listTopicSummaries } from "@/lib/curriculum/queries";
import { countUnverified } from "@/lib/questions/review";
import { countOpenFlagged } from "@/lib/safety/review";
import { countSupplementalByLabel } from "@/lib/supplemental/service";
import { SOURCE_TYPES, SOURCE_TYPE_INFO } from "@/lib/supplemental/rules";
import { SourceTypeBadge } from "@/components/curriculum/Badges";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = { title: "Administration" };

export default async function AdminHome() {
  await requireRole("admin", "/admin");
  const db = await createSupabaseServerClient();
  const [topics, document, labels, flagged, unverified] = await Promise.all([
    listTopicSummaries(db),
    getCurriculumDocument(db),
    countSupplementalByLabel(db),
    countOpenFlagged(db),
    countUnverified(db),
  ]);
  const totals = topics.reduce(
    (sum, t) => ({
      subtopics: sum.subtopics + t.subtopic_count,
      objectives: sum.objectives + t.objective_count,
    }),
    { subtopics: 0, objectives: 0 },
  );
  const grades = new Set(topics.map((t) => t.grade)).size;

  return (
    <AppPage>
      <h1 className="text-3xl font-bold tracking-tight">Administration</h1>

      <section aria-labelledby="attention-heading" className="flex flex-col gap-3">
        <h2 id="attention-heading" className="text-2xl font-semibold">
          Waiting for you
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2">
          <li>
            <Link
              href="/admin/safety"
              className={`flex h-full flex-col gap-1 rounded-2xl border p-5 shadow-sm hover:brightness-95 ${
                flagged.openWorrying > 0
                  ? "border-red-300 bg-red-50"
                  : flagged.open > 0
                    ? "border-amber-300 bg-amber-50"
                    : "border-border bg-surface"
              }`}
            >
              <span className="text-3xl font-extrabold">{flagged.open}</span>
              <span className="text-lg font-semibold">Flagged messages to look at</span>
              <span className="text-sm text-muted">
                {flagged.openWorrying > 0
                  ? `${flagged.openWorrying} sounded worrying`
                  : "Messages from children that the safety screen flagged"}
              </span>
            </Link>
          </li>
          <li>
            <Link
              href="/admin/questions?verification=UNVERIFIED"
              className="flex h-full flex-col gap-1 rounded-2xl border border-border bg-surface p-5 shadow-sm hover:bg-background"
            >
              <span className="text-3xl font-extrabold">{unverified}</span>
              <span className="text-lg font-semibold">Practice questions not yet checked</span>
              <span className="text-sm text-muted">
                Made by ZimTutor&apos;s templates; children see them as &ldquo;not part of the
                syllabus&rdquo; until a person approves them
              </span>
            </Link>
          </li>
        </ul>
      </section>

      <section aria-labelledby="curriculum-heading" className="flex flex-col gap-4">
        <h2 id="curriculum-heading" className="text-2xl font-semibold">
          Official curriculum
        </h2>
        {document ? (
          <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
            <p className="text-xl font-semibold">{document.title}</p>
            <p className="text-muted">
              {document.organisation} · {document.curriculum_year} · {document.page_count} pages
            </p>
            <dl className="mt-4 grid gap-x-8 gap-y-2 sm:grid-cols-2">
              <Stat label="Grades" value={grades} />
              <Stat label="Topics" value={topics.length} />
              <Stat label="Sub-topics" value={totals.subtopics} />
              <Stat label="Learning objectives" value={totals.objectives} />
            </dl>
            <p className="mt-4 text-sm text-muted">
              Source checksum <code className="break-all">{document.sha256}</code> · extractor{" "}
              {document.extractor_version}
            </p>
            <Link
              href="/admin/curriculum"
              className="mt-4 inline-flex min-h-12 items-center rounded-xl bg-brand px-6 text-lg font-semibold text-brand-contrast hover:brightness-110"
            >
              Browse the curriculum
            </Link>
          </div>
        ) : (
          <p
            role="alert"
            className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-900"
          >
            No curriculum has been loaded yet. Run <code>npm run curriculum:load</code>.
          </p>
        )}
      </section>

      <section aria-labelledby="labels-heading" className="flex flex-col gap-4">
        <h2 id="labels-heading" className="text-2xl font-semibold">
          Supplemental content by label
        </h2>
        <p className="text-muted">
          Material added next to the official curriculum is always labelled. The categories are
          never mixed.
        </p>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SOURCE_TYPES.map((type) => (
            <li key={type} className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <SourceTypeBadge type={type} />
                <Link
                  href={`/admin/supplemental?type=${type}`}
                  className="text-2xl font-bold underline-offset-4 hover:underline"
                  aria-label={`${labels.bySourceType[type] ?? 0} items labelled ${SOURCE_TYPE_INFO[type].label}`}
                >
                  {labels.bySourceType[type] ?? 0}
                </Link>
              </div>
              <p className="mt-2 text-sm text-muted">{SOURCE_TYPE_INFO[type].description}</p>
            </li>
          ))}
        </ul>
      </section>
    </AppPage>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-1.5">
      <dt className="text-muted">{label}</dt>
      <dd className="text-2xl font-bold">{value}</dd>
    </div>
  );
}
