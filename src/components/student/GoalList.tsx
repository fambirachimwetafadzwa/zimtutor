import Link from "next/link";
import { keepNumbersTogether } from "@/lib/format";
import type { GoalRow } from "@/lib/student/dashboard";
import { ProgressBar } from "./ProgressBar";

const CHIP: Record<string, string> = {
  MASTERED: "border-emerald-300 bg-emerald-50 text-emerald-950",
  REVIEW: "border-amber-300 bg-amber-50 text-amber-950",
  NOT_STARTED: "border-border bg-background text-muted",
};
const IN_PROGRESS_CHIP = "border-sky-300 bg-sky-50 text-sky-950";

/** The goals of a sub-topic, each with where it stands and a way in. */
export function GoalList({ goals }: { goals: readonly GoalRow[] }) {
  return (
    <ul className="flex flex-col divide-y divide-border">
      {goals.map((row) => (
        <li key={row.goal.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
          <div className="flex grow flex-col gap-2">
            <p className="text-lg">{keepNumbersTogether(row.goal.text)}</p>
            <div className="flex items-center gap-3">
              <span
                className={`rounded-full border px-3 py-0.5 text-sm font-bold ${CHIP[row.state] ?? IN_PROGRESS_CHIP}`}
              >
                {row.stateLabel}
              </span>
              <div className="max-w-40 grow">
                <ProgressBar
                  percent={row.percent}
                  label={`${row.goal.text}: how well you know it`}
                />
              </div>
              <span className="text-sm font-semibold text-muted">{row.percent}%</span>
            </div>
          </div>
          <Link
            href={row.href}
            className="inline-flex min-h-11 items-center justify-center self-start rounded-xl border-2 border-brand px-5 text-base font-bold text-brand hover:bg-brand hover:text-brand-contrast sm:self-center"
          >
            {row.action}
          </Link>
        </li>
      ))}
    </ul>
  );
}
