import { formatDay, keepNumbersTogether } from "@/lib/format";
import type { NeedsHand, RecentlyMastered } from "@/lib/parent/overview";

/** Goals the child is finding tricky. Said kindly, with the numbers behind it. */
export function NeedsHandList({ items, name }: { items: readonly NeedsHand[]; name: string }) {
  if (items.length === 0)
    return (
      <p className="rounded-2xl border border-border bg-surface p-5 text-lg">
        Nothing stands out right now. {name} is not stuck on any goal.
      </p>
    );
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <li
          key={item.goal.id}
          className="flex flex-col gap-1 rounded-2xl border border-amber-300 bg-amber-50 p-4"
        >
          <p className="text-sm font-semibold text-amber-950">
            {item.goal.topicName} · {item.goal.subtopicName}
          </p>
          <p className="text-lg font-semibold">{keepNumbersTogether(item.goal.text)}</p>
          <p className="text-base">
            {name} has found this one tricky: {item.recentRight} of the last {item.recentCount}{" "}
            answers were right without help. ZimTutor is giving easier questions and revisiting the
            basics.
          </p>
        </li>
      ))}
    </ul>
  );
}

export function MasteredList({ items }: { items: readonly RecentlyMastered[] }) {
  if (items.length === 0)
    return (
      <p className="rounded-2xl border border-border bg-surface p-5 text-lg">
        No goal has been mastered yet.
      </p>
    );
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <li
          key={item.goal.id}
          className="flex flex-col gap-1 rounded-2xl border border-emerald-300 bg-emerald-50 p-4"
        >
          <p className="text-sm font-semibold text-emerald-950">
            {item.goal.topicName} · mastered {formatDay(item.masteredAt)}
          </p>
          <p className="text-lg font-semibold">{keepNumbersTogether(item.goal.text)}</p>
        </li>
      ))}
    </ul>
  );
}
