"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { lessonAction, startLessonAction } from "@/app/actions/tutor";
import { keepNumbersTogether } from "@/lib/format";
import type { LearnerAnswer } from "@/lib/marking/spec";
import type { TutorAction } from "@/lib/tutor/actions";
import type { LessonMode } from "@/lib/tutor/state";
import { announcementFor, type TutorView } from "@/lib/tutor/view";
import { AnswerForm } from "./AnswerForm";
import { Messages } from "./Messages";

/**
 * The lesson screen. The browser only ever asks for the next step (a button, an answer, a question);
 * everything that matters — marking, hints, mastery, what comes next — is decided on the server, and
 * what comes back is the lesson as the child may see it.
 */

export interface GoalSummary {
  id: string;
  text: string;
  grade: number;
  topic: string;
  subtopic: string;
}

const primary =
  "min-h-12 rounded-xl bg-brand px-6 text-lg font-bold text-brand-contrast disabled:opacity-50";
const secondary =
  "min-h-11 rounded-xl border-2 border-border bg-surface px-4 text-base font-semibold hover:bg-background disabled:opacity-50";

function MasteryChip({ mastery }: { mastery: NonNullable<TutorView["mastery"]> }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3 text-base font-semibold">
        <span>{mastery.label}</span>
        <span>{mastery.percent}%</span>
      </div>
      <div
        role="progressbar"
        aria-label="How well you know this goal"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={mastery.percent}
        className="h-3 w-full overflow-hidden rounded-full bg-border"
      >
        <div className="h-full rounded-full bg-brand" style={{ width: `${mastery.percent}%` }} />
      </div>
      <p className="text-sm text-muted">This is ZimTutor&apos;s own estimate, not an exam mark.</p>
    </div>
  );
}

export function Lesson({
  goal,
  initialView,
  mode,
  forObjectiveId,
}: {
  goal: GoalSummary;
  initialView: TutorView | null;
  mode?: LessonMode;
  forObjectiveId?: string;
}) {
  const [view, setView] = useState<TutorView | null>(initialView);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [pending, startTransition] = useTransition();
  const [question, setQuestion] = useState("");
  const askId = useId();
  const bottom = useRef<HTMLDivElement>(null);
  const seen = useRef(new Set(initialView?.messages.map((m) => m.id) ?? []));
  const firstAdded = useRef<string | null>(null);

  const apply = (next: TutorView) => {
    const added = next.messages.filter((m) => !seen.current.has(m.id));
    const fresh = added.filter((m) => m.role === "tutor");
    for (const m of next.messages) seen.current.add(m.id);
    firstAdded.current = added[0]?.id ?? null;
    setAnnouncement(fresh.map(announcementFor).join(" "));
    setView(next);
  };

  // after each step: show the start of what is new (a screen full of text, not its last line) and put
  // the cursor where the child goes next
  useEffect(() => {
    if (!view) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const behavior = reduce ? "auto" : "smooth";
    const target = firstAdded.current
      ? document.querySelector(`[data-message-id="${CSS.escape(firstAdded.current)}"]`)
      : null;
    firstAdded.current = null;
    if (target) target.scrollIntoView({ behavior, block: "start" });
    else bottom.current?.scrollIntoView({ behavior, block: "nearest" });
    const next = document.querySelector<HTMLElement>("[data-autofocus]");
    next?.focus({ preventScroll: true });
  }, [view?.rev, view?.messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = () => {
    setError(null);
    startTransition(async () => {
      const result = await startLessonAction({
        objectiveId: goal.id,
        ...(mode ? { mode } : {}),
        ...(forObjectiveId ? { forObjectiveId } : {}),
      });
      if (result.ok) apply(result.view);
      else setError(result.error);
    });
  };

  const run = (action: TutorAction) => {
    if (!view || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await lessonAction({ sessionId: view.sessionId, action });
      if (result.ok) apply(result.view);
      else setError(result.error);
    });
  };

  const header = (
    <header className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5">
      <p className="text-sm font-semibold text-muted">
        Grade {goal.grade} · {goal.topic} · {goal.subtopic}
      </p>
      <p className="-mb-2 text-sm font-bold uppercase tracking-wide text-brand">Learning goal</p>
      <h1 className="text-2xl font-bold leading-snug">{keepNumbersTogether(goal.text)}</h1>
      {view?.mastery ? <MasteryChip mastery={view.mastery} /> : null}
      {view && view.status === "ACTIVE" ? (
        <p className="text-base text-muted">
          Questions answered: {view.progress.resolved} of {view.progress.limit}
        </p>
      ) : null}
    </header>
  );

  if (!view) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        {error ? (
          <p
            role="alert"
            className="rounded-xl border border-red-300 bg-red-50 p-4 text-lg text-red-900"
          >
            {error}
          </p>
        ) : null}
        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5">
          <p className="text-lg">
            Ready to learn this? ZimTutor will explain it, show you an example, and then ask you
            some questions.
          </p>
          <button
            type="button"
            className={primary}
            onClick={start}
            disabled={pending}
            data-autofocus
          >
            {pending ? "Starting…" : "Start"}
          </button>
        </div>
      </div>
    );
  }

  const can = (name: TutorView["actions"][number]) => view.actions.includes(name);
  const open = view.openQuestion;

  return (
    <div className="flex flex-col gap-6" aria-busy={pending}>
      {header}
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      <Messages view={view} />

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-red-300 bg-red-50 p-4 text-lg text-red-900"
        >
          {error}
        </p>
      ) : null}

      {view.status === "ACTIVE" ? (
        <section
          aria-label="What to do next"
          className="flex flex-col gap-4 rounded-2xl border-2 border-brand/40 bg-surface p-5"
        >
          {can("CONTINUE") ? (
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className={primary}
                disabled={pending}
                onClick={() => run({ type: "CONTINUE" })}
                data-autofocus
              >
                Next
              </button>
              {can("SKIP_LESSON") ? (
                <button
                  type="button"
                  className={secondary}
                  disabled={pending}
                  onClick={() => run({ type: "SKIP_LESSON" })}
                >
                  I already know this
                </button>
              ) : null}
            </div>
          ) : null}

          {can("ANSWER") && open ? (
            <>
              <AnswerForm
                key={open.id}
                question={open}
                wrongTries={view.tries?.used ?? 0}
                disabled={pending}
                onSubmit={(answer: LearnerAnswer) =>
                  run({ type: "ANSWER", questionId: open.id, answer })
                }
              />
              <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
                {can("HINT") ? (
                  <button
                    type="button"
                    className={secondary}
                    disabled={pending}
                    onClick={() => run({ type: "HINT" })}
                  >
                    Give me a hint ({view.hintsLeft} left)
                  </button>
                ) : null}
                {can("SHOW_ANSWER") ? (
                  <button
                    type="button"
                    className={secondary}
                    disabled={pending}
                    onClick={() => run({ type: "SHOW_ANSWER" })}
                  >
                    Show me how
                  </button>
                ) : null}
                {can("SKIP_QUESTION") ? (
                  <button
                    type="button"
                    className={secondary}
                    disabled={pending}
                    onClick={() => run({ type: "SKIP_QUESTION" })}
                  >
                    A different question
                  </button>
                ) : null}
                {view.tries ? (
                  <span className="text-base text-muted">
                    Tries left: {Math.max(0, view.tries.max - view.tries.used)}
                  </span>
                ) : null}
              </div>
            </>
          ) : null}

          {can("NEXT_QUESTION") ? (
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className={primary}
                disabled={pending}
                onClick={() => run({ type: "NEXT_QUESTION" })}
                data-autofocus
              >
                Next question
              </button>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3">
            {can("EXPLAIN_AGAIN") ? (
              <button
                type="button"
                className={secondary}
                disabled={pending}
                onClick={() => run({ type: "EXPLAIN_AGAIN" })}
              >
                Explain it again
              </button>
            ) : null}
            {can("END") ? (
              <button
                type="button"
                className={secondary}
                disabled={pending}
                onClick={() => run({ type: "END" })}
              >
                Stop for now
              </button>
            ) : null}
          </div>

          {can("ASK") ? (
            <details className="rounded-xl border border-border p-3">
              <summary className="cursor-pointer text-base font-semibold">
                Ask ZimTutor a question
              </summary>
              <form
                className="mt-3 flex flex-col gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const text = question.trim();
                  if (!text) return;
                  setQuestion("");
                  run({ type: "ASK", text });
                }}
              >
                <label htmlFor={askId} className="text-base">
                  Type your question about this goal. Please do not write your name, phone number or
                  where you live.
                </label>
                <textarea
                  id={askId}
                  className="min-h-24 w-full rounded-xl border-2 border-border bg-surface p-3 text-lg"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  maxLength={500}
                  readOnly={pending}
                />
                <button
                  type="submit"
                  className={secondary}
                  disabled={pending || question.trim() === ""}
                >
                  Send
                </button>
              </form>
            </details>
          ) : null}
        </section>
      ) : (
        <section
          aria-label="Lesson finished"
          className="flex flex-col gap-4 rounded-2xl border-2 border-brand/40 bg-surface p-5"
        >
          <h2 className="text-xl font-bold">That lesson is finished</h2>
          <p className="text-lg">
            You answered {view.progress.resolved}{" "}
            {view.progress.resolved === 1 ? "question" : "questions"} and got{" "}
            {view.progress.firstTry} right at the first try.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/student" className={`${primary} inline-flex items-center`} data-autofocus>
              Back to my learning
            </Link>
            <button type="button" className={secondary} disabled={pending} onClick={start}>
              Practise this goal again
            </button>
          </div>
        </section>
      )}
      <div ref={bottom} />
    </div>
  );
}
