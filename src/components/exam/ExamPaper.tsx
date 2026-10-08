"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { finishPaperAction, saveAnswerAction } from "@/app/actions/exam";
import { AnswerForm } from "@/components/learn/AnswerForm";
import { QuestionBlock } from "@/components/learn/QuestionBlock";
import type { PaperView } from "@/lib/exam/service";
import type { LearnerAnswer } from "@/lib/marking/spec";
import { describeLearnerAnswer } from "@/lib/tutor/answers";

/**
 * A practice paper while it is being written. Every answer is saved as soon as the child presses "Save
 * my answer", and can be changed until the paper is finished. Nothing is checked on the way: the paper
 * is marked once, at the end, as in an examination.
 */

const primary =
  "min-h-12 rounded-xl bg-brand px-6 text-lg font-bold text-brand-contrast disabled:opacity-50";
const secondary =
  "min-h-11 rounded-xl border-2 border-border bg-surface px-4 text-base font-semibold hover:bg-background disabled:opacity-50";

const letter = (part: number) => String.fromCharCode(96 + part);

export function ExamPaper({ view }: { view: PaperView }) {
  const router = useRouter();
  const parts = view.sections.flatMap((s) => s.questions.flatMap((q) => q.parts));
  const [saved, setSaved] = useState<Record<number, LearnerAnswer>>(() =>
    Object.fromEntries(parts.filter((p) => p.saved !== null).map((p) => [p.position, p.saved!])),
  );
  const [busy, setBusy] = useState<number | null>(null);
  const [problems, setProblems] = useState<Record<number, string>>({});
  const [asking, setAsking] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(() =>
    Math.max(0, Math.round((Date.now() - Date.parse(view.startedAt)) / 60_000)),
  );

  useEffect(() => {
    const tick = setInterval(
      () => setMinutes(Math.max(0, Math.round((Date.now() - Date.parse(view.startedAt)) / 60_000))),
      30_000,
    );
    return () => clearInterval(tick);
  }, [view.startedAt]);

  const answered = parts.filter((p) => saved[p.position] !== undefined).length;
  const left = parts.length - answered;

  const save = async (position: number, answer: LearnerAnswer) => {
    setBusy(position);
    setProblems((p) => ({ ...p, [position]: "" }));
    const result = await saveAnswerAction({ setId: view.id, position, answer });
    setBusy(null);
    if (result.ok) setSaved((s) => ({ ...s, [position]: answer }));
    else setProblems((p) => ({ ...p, [position]: result.error }));
  };

  const finish = async () => {
    setFinishing(true);
    setError(null);
    const result = await finishPaperAction({ setId: view.id });
    if (result.ok) router.refresh();
    else {
      setError(result.error);
      setFinishing(false);
    }
  };

  const showStatus = (position: number, question: (typeof parts)[number]["question"]) =>
    saved[position] === undefined ? null : (
      <p className="text-base font-semibold text-emerald-900" role="status">
        Saved: {describeLearnerAnswer(saved[position], question)}
      </p>
    );

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5">
        <p className="text-sm font-bold uppercase tracking-wide text-brand">Practice paper</p>
        <h1 className="text-2xl font-bold leading-snug">{view.title}</h1>
        <p className="text-base text-muted">
          Grade {view.grade} · {view.length === "FULL" ? "full paper" : "short paper"} · out of{" "}
          {view.marksAvailable} marks
          {view.recommendedMinutes
            ? ` · suggested time ${view.recommendedMinutes} minutes (you have used about ${minutes})`
            : ""}
        </p>
        <p className="text-base">
          This paper has the shape of the Grade 7 examination in your syllabus ({view.citation}).
          Nothing is checked until you finish. You can change an answer until then. A mark on a
          practice paper is a <strong>ZimTutor practice score</strong>: it is not a ZIMSEC result.
        </p>
        <p className="text-lg font-semibold" role="status">
          You have answered {answered} of {parts.length}.
        </p>
        <nav aria-label="Jump to a question" className="flex flex-wrap gap-2">
          {view.sections.flatMap((s) =>
            s.questions.map((q) => {
              const done = q.parts.every((p) => saved[p.position] !== undefined);
              const some = q.parts.some((p) => saved[p.position] !== undefined);
              return (
                <a
                  key={`${s.id}${q.number}`}
                  href={`#q-${s.id}${q.number}`}
                  aria-label={`Question ${s.id}${q.number}, ${done ? "answered" : some ? "partly answered" : "not answered"}`}
                  className={`flex size-9 items-center justify-center rounded-full border-2 text-sm font-bold ${
                    done
                      ? "border-brand bg-brand text-brand-contrast"
                      : some
                        ? "border-brand bg-brand/20"
                        : "border-border bg-surface"
                  }`}
                >
                  {view.paperNumber === 1 ? q.number : `${s.id}${q.number}`}
                </a>
              );
            }),
          )}
        </nav>
      </header>

      {view.sections.map((section) => (
        <section
          key={section.id}
          aria-labelledby={`section-${section.id}`}
          className="flex flex-col gap-5"
        >
          <div className="flex flex-col gap-1">
            <h2 id={`section-${section.id}`} className="text-2xl font-bold">
              {view.paperNumber === 1 ? "The questions" : `Section ${section.id}`}
            </h2>
            <p className="text-base text-muted">
              {section.label}
              {section.counted < section.offered
                ? `. Only your best ${section.counted} answers count in this practice paper.`
                : ""}
            </p>
          </div>
          {section.questions.map((q) => (
            <article
              key={q.number}
              id={`q-${section.id}${q.number}`}
              aria-label={`Question ${section.id}${q.number}`}
              className="flex scroll-mt-4 flex-col gap-4 rounded-2xl border-2 border-border bg-surface p-5"
            >
              <h3 className="text-lg font-bold">
                Question {view.paperNumber === 1 ? q.number : `${section.id}${q.number}`}{" "}
                <span className="font-normal text-muted">
                  ({q.marks} {q.marks === 1 ? "mark" : "marks"})
                </span>
              </h3>
              {q.parts.map((part) => (
                <div key={part.position} className="flex flex-col gap-3">
                  {q.parts.length > 1 ? (
                    <p className="text-base font-bold text-brand">({letter(part.part)})</p>
                  ) : null}
                  <QuestionBlock question={part.question} />
                  <AnswerForm
                    key={part.position}
                    question={part.question}
                    disabled={busy === part.position}
                    submitLabel={
                      saved[part.position] === undefined ? "Save my answer" : "Change my answer"
                    }
                    initial={saved[part.position] ?? null}
                    onSubmit={(answer) => save(part.position, answer)}
                  />
                  {showStatus(part.position, part.question)}
                  {problems[part.position] ? (
                    <p role="alert" className="text-base font-semibold text-red-800">
                      {problems[part.position]}
                    </p>
                  ) : null}
                </div>
              ))}
            </article>
          ))}
        </section>
      ))}

      <section
        aria-label="Finish the paper"
        className="flex flex-col gap-4 rounded-2xl border-2 border-brand/40 bg-surface p-5"
      >
        {error ? (
          <p
            role="alert"
            className="rounded-xl border border-red-300 bg-red-50 p-4 text-lg text-red-900"
          >
            {error}
          </p>
        ) : null}
        {!asking ? (
          <button
            type="button"
            className={primary}
            onClick={() => setAsking(true)}
            disabled={finishing}
          >
            Finish and mark my paper
          </button>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-lg">
              {left === 0
                ? "You have answered every question. Mark your paper now?"
                : `You have not answered ${left} ${left === 1 ? "question" : "questions"}. They will get no marks. Mark your paper now?`}
            </p>
            <div className="flex flex-wrap gap-3">
              <button type="button" className={primary} onClick={finish} disabled={finishing}>
                {finishing ? "Marking…" : "Yes, mark it"}
              </button>
              <button
                type="button"
                className={secondary}
                onClick={() => setAsking(false)}
                disabled={finishing}
              >
                No, go back
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
