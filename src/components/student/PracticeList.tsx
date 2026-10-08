import Link from "next/link";
import { keepNumbersTogether } from "@/lib/format";
import type { PracticeItem } from "@/lib/student/dashboard";

const CHIP: Record<PracticeItem["kind"], string> = {
  REVIEW_DUE: "border-amber-300 bg-amber-50 text-amber-950",
  FOUNDATION_CHECK: "border-sky-300 bg-sky-50 text-sky-950",
  CONTINUE: "border-emerald-300 bg-emerald-50 text-emerald-950",
  START_NEW: "border-border bg-background text-foreground",
};

/** More things to practise, each with why. */
export function PracticeList({ items }: { items: readonly PracticeItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={`${item.kind}:${item.goal.id}`}>
          <Link
            href={item.href}
            className="flex flex-col gap-1 rounded-2xl border border-border bg-surface p-4 hover:bg-background"
          >
            <span
              className={`self-start rounded-full border px-3 py-0.5 text-sm font-bold ${CHIP[item.kind]}`}
            >
              {item.label}
            </span>
            <span className="text-lg font-semibold">{keepNumbersTogether(item.goal.text)}</span>
            <span className="text-base text-muted">{item.reason}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
