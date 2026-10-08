import Link from "next/link";
import { QuestionBlock } from "@/components/learn/QuestionBlock";
import { ProgressBar } from "@/components/student/ProgressBar";
import { keepNumbersTogether } from "@/lib/format";
import type { PaperView } from "@/lib/exam/service";
import { BAND_LABELS } from "@/lib/exam/structure";

const letter = (part: number) => String.fromCharCode(96 + part);
const TOPIC_NAMES: Record<string, string> = {
  NUM: "Number",
  OPS: "Operations",
  MEA: "Measures",
  REL: "Relationships",
};

/** A marked practice paper: the mark (labelled for what it is), how it divides up, what to practise, and every answer with its reason. */
export function ExamResults({ view }: { view: PaperView }) {
  const result = view.result;
  if (!result)
    return (
      <p role="alert" className="rounded-2xl border border-border bg-surface p-5 text-lg">
        This paper was finished, but its result could not be read. Please start another paper.
      </p>
    );
  const short = view.shares.shortfalls;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3 rounded-2xl border-2 border-brand bg-surface p-6">
        <p className="text-sm font-bold uppercase tracking-wide text-brand">Your practice score</p>
        <h1 className="text-2xl font-bold leading-snug">{view.title}</h1>
        <p className="text-5xl font-extrabold">
          {result.marksAwarded}{" "}
          <span className="text-2xl font-bold text-muted">out of {result.marksAvailable}</span>
        </p>
        <ProgressBar percent={result.percent} label="Your practice score" />
        <p className="text-lg font-semibold">{result.percent}%</p>
        <p className="text-base text-muted">
          This is a <strong>ZimTutor practice score</strong> on a practice paper. It is not a ZIMSEC
          mark and does not predict one. It tells you what to practise next.
        </p>
        {result.unanswered > 0 ? (
          <p className="text-base">
            {result.unanswered} {result.unanswered === 1 ? "question was" : "questions were"} left
            unanswered.
          </p>
        ) : null}
      </header>

      <section aria-labelledby="skills-heading" className="flex flex-col gap-3">
        <h2 id="skills-heading" className="text-2xl font-bold">
          How you did on each kind of question
        </h2>
        <ul className="grid gap-4 sm:grid-cols-3">
          {result.bands.map((band) => (
            <li
              key={band.band}
              className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4"
            >
              <p className="text-base font-bold">{BAND_LABELS[band.band]}</p>
              <p className="text-2xl font-extrabold">
                {band.awarded}
                <span className="text-base font-semibold text-muted"> of {band.available}</span>
              </p>
              <ProgressBar percent={band.percent} label={`${BAND_LABELS[band.band]}: your score`} />
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted">
          This paper tested knowledge and comprehension{" "}
          {view.shares.achieved.KNOWLEDGE_COMPREHENSION}%, application and analysis{" "}
          {view.shares.achieved.APPLICATION_ANALYSIS}% and problem solving{" "}
          {view.shares.achieved.PROBLEM_SOLVING}%. The Grade 7 examination in your syllabus (
          {view.citation}) aims for {view.shares.official.KNOWLEDGE_COMPREHENSION}%,{" "}
          {view.shares.official.APPLICATION_ANALYSIS}% and {view.shares.official.PROBLEM_SOLVING}%.
          {short.length > 0
            ? ` ZimTutor did not have enough questions to match that exactly for ${short
                .map((s) => BAND_LABELS[s.band].toLowerCase())
                .join(" and ")}.`
            : ""}
        </p>
      </section>

      <section aria-labelledby="topics-heading" className="flex flex-col gap-3">
        <h2 id="topics-heading" className="text-2xl font-bold">
          By topic
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {result.topics.map((topic) => (
            <li
              key={topic.topicCode}
              className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4"
            >
              <p className="flex items-baseline justify-between text-base font-bold">
                <span>{TOPIC_NAMES[topic.topicCode] ?? topic.topicCode}</span>
                <span>
                  {topic.awarded} of {topic.available}
                </span>
              </p>
              <ProgressBar
                percent={topic.percent}
                label={`${TOPIC_NAMES[topic.topicCode] ?? topic.topicCode}: your score`}
              />
            </li>
          ))}
        </ul>
      </section>

      {result.revisit.length > 0 ? (
        <section aria-labelledby="revisit-heading" className="flex flex-col gap-3">
          <h2 id="revisit-heading" className="text-2xl font-bold">
            What to practise next
          </h2>
          <ul className="flex flex-col gap-3">
            {result.revisit.map((r) => (
              <li key={r.objectiveId}>
                <Link
                  href={`/student/learn/${encodeURIComponent(r.objectiveId)}`}
                  className="flex flex-col gap-1 rounded-2xl border border-border bg-surface p-4 hover:bg-background"
                >
                  <span className="text-lg font-semibold">{keepNumbersTogether(r.text)}</span>
                  <span className="text-base text-muted">
                    {r.lost === 1 ? "1 mark" : `${r.lost} marks`} lost here. Practise this goal.
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {result.misconceptions.length > 0 ? (
            <p className="text-base">
              Mistakes that came up more than once:{" "}
              {result.misconceptions.map((m) => `${m.name} (${m.count})`).join(", ")}.
            </p>
          ) : null}
        </section>
      ) : (
        <p className="rounded-2xl border border-emerald-300 bg-emerald-50 p-5 text-lg text-emerald-950">
          Every mark was earned. Well done!
        </p>
      )}

      <section aria-labelledby="review-heading" className="flex flex-col gap-5">
        <h2 id="review-heading" className="text-2xl font-bold">
          Every question, with the answer
        </h2>
        {view.sections.map((section) => (
          <div key={section.id} className="flex flex-col gap-4">
            {view.paperNumber === 2 ? (
              <h3 className="text-xl font-bold">Section {section.id}</h3>
            ) : null}
            {section.questions.map((q) => (
              <details
                key={q.number}
                open={q.parts.some((p) => (p.review?.awarded ?? 0) < 1)}
                className="rounded-2xl border border-border bg-surface p-4"
              >
                <summary className="min-h-11 cursor-pointer text-lg font-semibold">
                  Question {view.paperNumber === 1 ? q.number : `${section.id}${q.number}`}:{" "}
                  {q.parts.reduce((n, p) => n + p.marks * (p.review?.awarded ?? 0), 0)} of {q.marks}
                  {q.counted === false ? " (not counted: you answered other questions better)" : ""}
                </summary>
                <div className="mt-3 flex flex-col gap-5">
                  {q.parts.map((part) => (
                    <div key={part.position} className="flex flex-col gap-2">
                      {q.parts.length > 1 ? (
                        <p className="text-base font-bold text-brand">({letter(part.part)})</p>
                      ) : null}
                      <QuestionBlock question={part.question} />
                      {part.review ? (
                        <div
                          className={`rounded-xl border p-3 text-base ${
                            part.review.awarded >= 1
                              ? "border-emerald-300 bg-emerald-50 text-emerald-950"
                              : "border-amber-300 bg-amber-50 text-amber-950"
                          }`}
                        >
                          <p>
                            <strong>Your answer:</strong>{" "}
                            {part.review.yourAnswer === null
                              ? "not answered"
                              : keepNumbersTogether(part.review.yourAnswer)}
                          </p>
                          <p>
                            <strong>Right answer:</strong>{" "}
                            {keepNumbersTogether(part.review.rightAnswer)}
                          </p>
                          <p className="mt-1">{keepNumbersTogether(part.review.explanation)}</p>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        ))}
      </section>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/student/exams"
          className="inline-flex min-h-12 items-center rounded-xl bg-brand px-6 text-lg font-bold text-brand-contrast"
        >
          Back to practice papers
        </Link>
        <Link
          href="/student"
          className="inline-flex min-h-12 items-center rounded-xl border-2 border-border px-6 text-lg font-semibold"
        >
          Back to my learning
        </Link>
      </div>
    </div>
  );
}
