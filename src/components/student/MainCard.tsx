import Link from "next/link";
import { keepNumbersTogether } from "@/lib/format";
import type { MainCard as MainCardData } from "@/lib/student/dashboard";

/** The one thing to do now. A single large button, and a reason in plain words. */
export function MainCard({ card }: { card: MainCardData }) {
  return (
    <section
      aria-labelledby="main-card-heading"
      className="flex flex-col gap-4 rounded-3xl border-2 border-brand bg-surface p-6 shadow-sm"
    >
      <h2 id="main-card-heading" className="text-sm font-bold uppercase tracking-wide text-brand">
        {card.headline}
      </h2>
      {card.goal ? (
        <div className="flex flex-col gap-1">
          <p className="text-2xl font-bold leading-snug">{keepNumbersTogether(card.goal.text)}</p>
          <p className="text-base text-muted">
            Grade {card.goal.grade} · {card.goal.topicName} · {card.goal.subtopicName}
          </p>
        </div>
      ) : null}
      {card.reason ? <p className="text-lg">{card.reason}</p> : null}
      {card.href && card.action ? (
        <Link
          href={card.href}
          className="inline-flex min-h-14 items-center justify-center self-start rounded-2xl bg-brand px-8 text-xl font-bold text-brand-contrast hover:brightness-110"
        >
          {card.action}
        </Link>
      ) : null}
    </section>
  );
}
