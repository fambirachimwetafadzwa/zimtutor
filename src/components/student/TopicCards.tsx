import Link from "next/link";
import type { TopicCard } from "@/lib/student/dashboard";
import { ProgressBar } from "./ProgressBar";

/** One card per topic: how much of it the learner knows, with a bar and the counts in words. */
export function TopicCards({
  topics,
  linkTo,
}: {
  topics: readonly TopicCard[];
  /** Where a card leads; omitted when the cards are only for reading. */
  linkTo?: (topic: TopicCard) => string;
}) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {topics.map((topic) => {
        const body = (
          <>
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-xl font-bold">{topic.name}</h3>
              <span className="text-xl font-extrabold">{topic.percent}%</span>
            </div>
            <ProgressBar percent={topic.percent} label={`${topic.name}: how well you know it`} />
            <p className="text-base text-muted">
              {topic.mastered} of {topic.total} goals mastered
              {topic.review > 0 ? ` · ${topic.review} to review` : ""}
            </p>
            {topic.recommended ? (
              <p className="text-sm font-bold text-brand">Good place to practise next</p>
            ) : null}
          </>
        );
        const style = `flex flex-col gap-3 rounded-2xl border bg-surface p-5 shadow-sm ${
          topic.recommended ? "border-brand" : "border-border"
        }`;
        return (
          <li key={topic.topicId}>
            {linkTo ? (
              <Link href={linkTo(topic)} className={`${style} h-full hover:bg-background`}>
                {body}
              </Link>
            ) : (
              <div className={`${style} h-full`}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
