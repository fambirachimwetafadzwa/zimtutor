import Link from "next/link";
import { redirect } from "next/navigation";
import { AppPage } from "@/components/layout/PageShell";
import { StartPaperForm, type PaperChoice } from "@/components/exam/StartPaperForm";
import { ProgressBar } from "@/components/student/ProgressBar";
import { getLearnerProfile, requireRole } from "@/lib/auth/session";
import { createExamDeps } from "@/lib/exam/server";
import { buildPlan, type PaperPlan } from "@/lib/exam/plan";
import { findOpenPaper, listPapers } from "@/lib/exam/service";
import { BAND_LABELS, loadStructure, type OfficialStructure } from "@/lib/exam/structure";
import { formatDay } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = { title: "Practice papers" };

const KIND_WORDS = {
  EXAM_STYLE_PAPER_1: "Paper 1 style (multiple choice)",
  EXAM_STYLE_PAPER_2: "Paper 2 style (structured questions)",
} as const;

/** What a paper is, in the words of its plan: how many questions and how long. */
function describe(plan: PaperPlan): string {
  const questions =
    plan.paperNumber === 1
      ? `${plan.sections[0]!.offered} multiple-choice questions`
      : plan.sections
          .map((s) =>
            s.counted < s.offered
              ? `section ${s.id}: answer ${s.counted} of ${s.offered}`
              : `section ${s.id}: ${s.offered} questions`,
          )
          .join(", ");
  return `${questions}, about ${plan.recommendedMinutes} minutes`;
}

function choices(structure: OfficialStructure): PaperChoice[] {
  return ([1, 2] as const).map((paperNumber) => {
    const full = buildPlan(structure, { paperNumber, length: "FULL" });
    const short = buildPlan(structure, { paperNumber, length: "SHORT" });
    return {
      paperNumber,
      title: KIND_WORDS[full.kind],
      about:
        paperNumber === 1
          ? "Choose the right answer for each question, as in the first Grade 7 paper."
          : "Questions with parts (a), (b), (c) ... Type or choose your answers, as in the second Grade 7 paper.",
      full: describe(full),
      short: describe(short),
    };
  });
}

export default async function ExamsPage() {
  const user = await requireRole("student", "/student/exams");
  const learner = await getLearnerProfile(user.id);
  if (!learner || !learner.onboardingCompleted) redirect("/student/onboarding");

  const db = await createSupabaseServerClient();
  const [structure, open, papers] = await Promise.all([
    loadStructure(db),
    findOpenPaper(createExamDeps(), user.id),
    listPapers(db, user.id, 10),
  ]);
  const sample = buildPlan(structure, { paperNumber: 1, length: "FULL" });

  return (
    <AppPage>
      <section className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Practice papers</h1>
        <p className="text-lg text-muted">
          Try a paper made like the Grade 7 examination in your syllabus ({sample.documentTitle},
          page {sample.citation.label ?? sample.citation.page}). The questions come from your Grade{" "}
          {learner.grade} goals. Nothing is checked until you finish, and then you see what to
          practise next.
        </p>
        <p
          role="note"
          className="rounded-2xl border border-border bg-surface p-4 text-base text-muted"
        >
          A mark on a practice paper is a <strong>ZimTutor practice score</strong>. It is not a
          ZIMSEC result, and it does not tell you what you will get in the real examination.
        </p>
      </section>

      {open ? (
        <section
          aria-labelledby="open-heading"
          className="flex flex-col gap-3 rounded-2xl border-2 border-brand bg-surface p-5"
        >
          <h2 id="open-heading" className="text-2xl font-bold">
            You have a paper in progress
          </h2>
          <p className="text-lg">Your answers so far are saved. Carry on where you stopped.</p>
          <Link
            href={`/student/exams/${open}`}
            className="inline-flex min-h-12 items-center justify-center self-start rounded-xl bg-brand px-6 text-lg font-bold text-brand-contrast"
          >
            Carry on with my paper
          </Link>
        </section>
      ) : (
        <section aria-labelledby="start-heading" className="flex flex-col gap-3">
          <h2 id="start-heading" className="text-2xl font-bold">
            Start a paper
          </h2>
          <StartPaperForm choices={choices(structure)} />
        </section>
      )}

      <section aria-labelledby="past-heading" className="flex flex-col gap-3">
        <h2 id="past-heading" className="text-2xl font-bold">
          My papers
        </h2>
        {papers.filter((p) => p.status === "COMPLETED").length === 0 ? (
          <p className="rounded-2xl border border-border bg-surface p-5 text-lg">
            When you finish a paper, it will be listed here.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {papers
              .filter((p) => p.status === "COMPLETED")
              .map((paper) => (
                <li key={paper.id}>
                  <Link
                    href={`/student/exams/${paper.id}`}
                    className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4 hover:bg-background"
                  >
                    <span className="text-sm font-semibold text-muted">
                      {KIND_WORDS[paper.kind]} · {paper.length === "FULL" ? "full" : "short"} ·{" "}
                      {formatDay(paper.completedAt)}
                    </span>
                    <span className="text-xl font-bold">
                      {paper.marksAwarded} of {paper.marksAvailable} · {paper.percent}%
                      <span className="text-base font-normal text-muted"> practice score</span>
                    </span>
                    <ProgressBar percent={paper.percent ?? 0} label="Practice score" />
                    {paper.bands.length > 0 ? (
                      <span className="text-sm text-muted">
                        {paper.bands.map((b) => `${BAND_LABELS[b.band]} ${b.percent}%`).join(" · ")}
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
          </ul>
        )}
      </section>
    </AppPage>
  );
}
