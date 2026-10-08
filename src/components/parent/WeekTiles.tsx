import type { WeekSummary } from "@/lib/parent/overview";

/** The last seven days in four numbers. */
export function WeekTiles({ week }: { week: WeekSummary }) {
  const items = [
    {
      label: week.lessons === 1 ? "Lesson finished" : "Lessons finished",
      value: String(week.lessons),
    },
    { label: week.days === 1 ? "Day practised" : "Days practised", value: String(week.days) },
    { label: "Minutes", value: String(week.minutes) },
    {
      label: "Right at the first try",
      value: week.firstTryPercent === null ? "–" : `${week.firstTryPercent}%`,
      detail: week.questions > 0 ? `${week.firstTry} of ${week.questions} questions` : undefined,
    },
  ];
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((item) => (
        <li key={item.label} className="rounded-2xl border border-border bg-surface p-4">
          <p className="text-3xl font-extrabold">{item.value}</p>
          <p className="text-base font-semibold">{item.label}</p>
          {item.detail ? <p className="text-sm text-muted">{item.detail}</p> : null}
        </li>
      ))}
    </ul>
  );
}
