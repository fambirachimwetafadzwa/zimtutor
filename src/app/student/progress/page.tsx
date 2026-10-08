import Link from "next/link";
import { redirect } from "next/navigation";
import { AppPage } from "@/components/layout/PageShell";
import { GoalList } from "@/components/student/GoalList";
import { ProgressBar } from "@/components/student/ProgressBar";
import { Tiles } from "@/components/student/Tiles";
import { getLearnerProfile, requireRole } from "@/lib/auth/session";
import { loadProgressScreen } from "@/lib/student/server";

export const metadata = { title: "My progress" };

export default async function ProgressPage() {
  const user = await requireRole("student", "/student/progress");
  const learner = await getLearnerProfile(user.id);
  if (!learner || !learner.onboardingCompleted) redirect("/student/onboarding");

  const screen = await loadProgressScreen(user.id);

  return (
    <AppPage>
      <section className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">My progress</h1>
        <p className="text-lg text-muted">
          Every goal in your Grade {screen.grade} syllabus that ZimTutor can practise with you.{" "}
          <Link href="/student" className="font-semibold text-brand underline">
            Back to my learning
          </Link>
        </p>
      </section>

      <Tiles tiles={screen.tiles} />

      {screen.topics.map((topic) => (
        <section
          key={topic.topicId}
          id={`topic-${topic.topicCode}`}
          aria-labelledby={`heading-${topic.topicCode}`}
          className="flex scroll-mt-6 flex-col gap-4"
        >
          <div className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id={`heading-${topic.topicCode}`} className="text-2xl font-bold">
                {topic.name}
              </h2>
              <span className="text-2xl font-extrabold">{topic.percent}%</span>
            </div>
            <ProgressBar percent={topic.percent} label={`${topic.name}: how well you know it`} />
            <p className="text-base text-muted">
              {topic.mastered} of {topic.total} goals mastered
              {topic.review > 0 ? ` · ${topic.review} to review` : ""}
            </p>
          </div>
          <div className="flex flex-col gap-3">
            {topic.subtopics.map((sub) => (
              <details
                key={sub.subtopicId}
                open={sub.goals.some((g) => g.state !== "NOT_STARTED" && g.state !== "MASTERED")}
                className="rounded-2xl border border-border bg-surface px-5 py-3"
              >
                <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2 text-lg font-semibold">
                  <span>{sub.name}</span>
                  <span className="text-base font-normal text-muted">
                    {sub.mastered} of {sub.total} mastered
                  </span>
                </summary>
                <GoalList goals={sub.goals} />
              </details>
            ))}
          </div>
        </section>
      ))}

      {screen.handsOn > 0 ? (
        <p className="rounded-2xl border border-border bg-surface p-5 text-base text-muted">
          {screen.handsOn} more {screen.handsOn === 1 ? "goal in" : "goals in"} your syllabus{" "}
          {screen.handsOn === 1 ? "is" : "are"} done with real things (like coins, rulers and
          shapes), so they are not shown here. Practise them with real things at school or at home.
        </p>
      ) : null}
    </AppPage>
  );
}
