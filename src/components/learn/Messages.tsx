import { keepNumbersTogether } from "@/lib/format";
import type { Quote } from "@/lib/tutor/store";
import { withoutRestatedQuestion, type MessageView, type TutorView } from "@/lib/tutor/view";
import { QuestionBlock } from "./QuestionBlock";

/**
 * The conversation. The tutor's words, the child's words and the syllabus's words are always visibly
 * different: the syllabus is quoted in its own green box labelled "Official curriculum"; the tutor's
 * own plain wording is "ZimTutor"; wording a language model wrote (and ZimTutor checked) says so.
 */

function SyllabusQuote({ quote, citation }: { quote: Quote; citation: string | null }) {
  return (
    <figure className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-emerald-950">
      <figcaption className="flex flex-wrap items-center gap-2 text-sm font-bold">
        <span className="rounded-full border border-emerald-400 bg-white px-2 py-0.5">
          Official curriculum
        </span>
        <span>{quote.label}</span>
      </figcaption>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-lg">
        {quote.items.map((item, i) => (
          <li key={i}>{keepNumbersTogether(item)}</li>
        ))}
      </ul>
      {citation ? <p className="mt-2 text-sm">{citation}</p> : null}
    </figure>
  );
}

function Who({ message }: { message: MessageView }) {
  if (message.role === "learner") return <span className="font-bold">You</span>;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="font-bold text-brand">ZimTutor</span>
      {message.source === "model" ? (
        <span className="rounded-full border border-violet-300 bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-900">
          AI-written, checked by ZimTutor
        </span>
      ) : null}
    </span>
  );
}

/** Question 1, 2, 3 ... in the order they were asked (computed first: rendering must not count). */
function numberQuestions(messages: readonly MessageView[]): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const m of messages) {
    if (m.kind === "QUESTION" && m.question) numbers.set(m.id, numbers.size + 1);
  }
  return numbers;
}

export function Messages({ view }: { view: TutorView }) {
  const openId = view.openQuestion?.id;
  const numbers = numberQuestions(view.messages);
  return (
    <ol className="flex flex-col gap-4" aria-label="Your lesson so far">
      {view.messages.map((m) => {
        const mine = m.role === "learner";
        const isQuestion = m.kind === "QUESTION" && m.question;
        const questionNumber = numbers.get(m.id) ?? 0;
        const current = isQuestion && m.question!.id === openId;
        return (
          <li
            key={m.id}
            data-message-id={m.id}
            className={`flex scroll-mt-4 ${mine ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`flex max-w-full flex-col gap-2 rounded-2xl border p-4 sm:max-w-[92%] ${
                mine
                  ? "border-brand/30 bg-brand/10"
                  : m.safety
                    ? "border-amber-300 bg-amber-50"
                    : "border-border bg-surface"
              }`}
            >
              <div className="text-sm">
                <Who message={m} />
              </div>

              {m.hint ? (
                <p className="text-sm font-bold uppercase tracking-wide text-brand">
                  Hint {m.hint.number} of {m.hint.of}
                </p>
              ) : null}

              {m.kind === "WORKED_EXAMPLE" && m.question ? (
                <QuestionBlock question={m.question} heading="Example" />
              ) : null}

              {isQuestion && current ? (
                <>
                  <p className="whitespace-pre-line text-lg">{keepNumbersTogether(m.text)}</p>
                  <QuestionBlock question={m.question!} heading={`Question ${questionNumber}`} />
                </>
              ) : isQuestion ? (
                <p className="text-base text-muted">
                  Question {questionNumber}: {keepNumbersTogether(m.question!.stem)}
                </p>
              ) : (
                <p className="whitespace-pre-line text-lg leading-relaxed">
                  {m.kind === "LEARNER_ANSWER" ? (
                    <>
                      <span className="text-muted">My answer: </span>
                      {keepNumbersTogether(m.text)}
                    </>
                  ) : m.kind === "WORKED_EXAMPLE" && m.question ? (
                    keepNumbersTogether(withoutRestatedQuestion(m.text, m.question.stem))
                  ) : (
                    keepNumbersTogether(m.text)
                  )}
                </p>
              )}

              {m.quotes.map((quote, i) => (
                <SyllabusQuote key={i} quote={quote} citation={i === 0 ? m.citation : null} />
              ))}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
