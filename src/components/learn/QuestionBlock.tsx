import { keepNumbersTogether } from "@/lib/format";
import type { PublicQuestion } from "@/lib/questions/bank-rows";
import { Picture } from "./pictures";

/** A question as the child reads it: the words, the picture, and an honest label for where it came from. */
export function QuestionBlock({
  question,
  heading,
}: {
  question: PublicQuestion;
  /** e.g. "Question 3" or "Example". */
  heading?: string;
}) {
  return (
    <article className="flex flex-col gap-3 rounded-2xl border-2 border-brand/30 bg-surface p-5">
      {heading ? (
        <h3 className="text-base font-bold uppercase tracking-wide text-brand">{heading}</h3>
      ) : null}
      <p className="whitespace-pre-line text-xl leading-relaxed">
        {keepNumbersTogether(question.stem)}
      </p>
      {question.stemData ? <Picture data={question.stemData} /> : null}
      <p className="text-sm text-muted">{question.label.text}</p>
    </article>
  );
}
