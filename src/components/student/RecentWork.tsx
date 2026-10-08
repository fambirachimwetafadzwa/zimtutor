import { formatDay, keepNumbersTogether } from "@/lib/format";
import type { RecentItem } from "@/lib/student/dashboard";

const MODE_WORDS: Record<RecentItem["mode"], string> = {
  LEARN: "Lesson",
  PRACTISE: "Practice",
  REVIEW: "Review",
  FOUNDATION: "Basics check",
};

/** Finished lessons: what was worked on, how it went, in counts and words. Never what was said. */
export function RecentWork({
  items,
  empty = "When you finish a lesson, it will show up here.",
}: {
  items: readonly RecentItem[];
  /** What to say when there is nothing yet. */
  empty?: string;
}) {
  if (items.length === 0)
    return <p className="rounded-2xl border border-border bg-surface p-5 text-lg">{empty}</p>;
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <li
          key={item.sessionId}
          className="flex flex-col gap-1 rounded-2xl border border-border bg-surface p-4"
        >
          <p className="text-sm font-semibold text-muted">
            {MODE_WORDS[item.mode]}
            {item.endedAt ? ` · ${formatDay(item.endedAt)}` : ""}
            {item.goal ? ` · ${item.goal.topicName}` : ""}
          </p>
          <p className="text-lg font-semibold">
            {item.goal
              ? keepNumbersTogether(item.goal.text)
              : "A goal that is no longer in the syllabus"}
          </p>
          <p className="text-base text-muted">
            {item.questions} {item.questions === 1 ? "question" : "questions"}, {item.firstTry}{" "}
            right at the first try
            {item.outcome ? ` · ${item.outcome}` : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}
