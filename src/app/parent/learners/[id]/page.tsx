import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AppPage } from "@/components/layout/PageShell";
import { MasteredList, NeedsHandList } from "@/components/parent/GoalLists";
import { WeekTiles } from "@/components/parent/WeekTiles";
import { RecentWork } from "@/components/student/RecentWork";
import { Tiles } from "@/components/student/Tiles";
import { TopicCards } from "@/components/student/TopicCards";
import { requireRole } from "@/lib/auth/session";
import { formatDay } from "@/lib/format";
import { loadParentOverview } from "@/lib/parent/server";

type Params = Promise<{ id: string }>;

export const metadata = { title: "My learner's progress" };

export default async function LearnerOverviewPage({ params }: { params: Params }) {
  const { id } = await params;
  await requireRole("parent", `/parent/learners/${id}`);
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) notFound();

  const overview = await loadParentOverview(parsed.data);
  if (!overview) notFound(); // not this parent's child

  const { learner } = overview;
  return (
    <AppPage>
      <section className="flex flex-col gap-1">
        <Link href="/parent" className="text-base font-semibold text-brand underline">
          ← My learners
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">{learner.name}</h1>
        <p className="text-lg text-muted">
          Grade {learner.grade} · username <span className="font-mono">{learner.username}</span>
          {overview.lastActive ? ` · last lesson ${formatDay(overview.lastActive)}` : ""}
        </p>
      </section>

      <p
        role="note"
        className="rounded-2xl border border-border bg-surface p-4 text-base text-muted"
      >
        For {learner.name}&apos;s privacy, ZimTutor shows you what they worked on and how it went.
        It does not show what they typed or what the tutor said, or their individual answers. The
        percentages are ZimTutor&apos;s own estimates of how well each goal is known. They are not
        exam marks.
      </p>

      <section aria-labelledby="week-heading" className="flex flex-col gap-3">
        <h2 id="week-heading" className="text-2xl font-bold">
          The last seven days
        </h2>
        <WeekTiles week={overview.week} />
      </section>

      <section aria-labelledby="progress-heading" className="flex flex-col gap-4">
        <h2 id="progress-heading" className="text-2xl font-bold">
          Progress through the Grade {learner.grade} syllabus
        </h2>
        <Tiles
          tiles={overview.tiles}
          note={`${overview.tiles.total} goals in Grade ${learner.grade} that ZimTutor can practise. Others are done with real materials.`}
        />
        <TopicCards topics={overview.topics} />
      </section>

      <section aria-labelledby="hand-heading" className="flex flex-col gap-3">
        <h2 id="hand-heading" className="text-2xl font-bold">
          Where {learner.name} could use a hand
        </h2>
        <NeedsHandList items={overview.needsHand} name={learner.name} />
      </section>

      <section aria-labelledby="mastered-heading" className="flex flex-col gap-3">
        <h2 id="mastered-heading" className="text-2xl font-bold">
          Recently mastered
        </h2>
        <MasteredList items={overview.recentlyMastered} />
      </section>

      <section aria-labelledby="recent-heading" className="flex flex-col gap-3">
        <h2 id="recent-heading" className="text-2xl font-bold">
          Lessons {learner.name} finished
        </h2>
        <RecentWork
          items={overview.recent}
          empty={`${learner.name} has not finished a lesson yet.`}
        />
      </section>
    </AppPage>
  );
}
