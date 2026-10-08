import Link from "next/link";
import { redirect } from "next/navigation";
import { AppPage } from "@/components/layout/PageShell";
import { MainCard } from "@/components/student/MainCard";
import { PracticeList } from "@/components/student/PracticeList";
import { RecentWork } from "@/components/student/RecentWork";
import { Tiles } from "@/components/student/Tiles";
import { TopicCards } from "@/components/student/TopicCards";
import { getLearnerProfile, requireRole } from "@/lib/auth/session";
import { loadDashboard } from "@/lib/student/server";

export const metadata = { title: "My learning" };

export default async function StudentHome() {
  // Layouts do not re-run on every navigation, so each page re-checks access itself.
  const user = await requireRole("student", "/student");
  const learner = await getLearnerProfile(user.id);
  if (!learner || !learner.onboardingCompleted) redirect("/student/onboarding");

  const dashboard = await loadDashboard(user.id);

  return (
    <AppPage>
      <section className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Hello, {user.displayName}!</h1>
        <p className="text-lg text-muted">
          You&apos;re in Grade {dashboard.grade}.{" "}
          <Link href="/student/onboarding" className="font-semibold text-brand underline">
            Change my grade
          </Link>
        </p>
      </section>

      <MainCard card={dashboard.main} />

      {dashboard.practice.length > 0 ? (
        <section aria-labelledby="practice-heading" className="flex flex-col gap-3">
          <h2 id="practice-heading" className="text-2xl font-bold">
            More to practise
          </h2>
          <PracticeList items={dashboard.practice} />
        </section>
      ) : null}

      <section aria-labelledby="progress-heading" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="progress-heading" className="text-2xl font-bold">
            My progress
          </h2>
          <Link href="/student/progress" className="text-lg font-semibold text-brand underline">
            See every goal
          </Link>
        </div>
        <Tiles tiles={dashboard.tiles} />
        <TopicCards
          topics={dashboard.topics}
          linkTo={(t) => `/student/progress#topic-${t.topicCode}`}
        />
        <p className="text-sm text-muted">
          The bars are ZimTutor&apos;s own estimate of how well you know each goal. They are not
          exam marks.
        </p>
      </section>

      <section aria-labelledby="recent-heading" className="flex flex-col gap-3">
        <h2 id="recent-heading" className="text-2xl font-bold">
          My recent work
        </h2>
        <RecentWork items={dashboard.recent} />
      </section>
    </AppPage>
  );
}
