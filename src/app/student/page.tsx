import Link from "next/link";
import { redirect } from "next/navigation";
import { AppPage } from "@/components/layout/PageShell";
import { getLearnerProfile, requireRole } from "@/lib/auth/session";

export const metadata = { title: "My learning" };

export default async function StudentHome() {
  // Layouts do not re-run on every navigation, so each page re-checks access itself.
  const user = await requireRole("student", "/student");
  const learner = await getLearnerProfile(user.id);
  if (!learner || !learner.onboardingCompleted) redirect("/student/onboarding");

  return (
    <AppPage>
      <section className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Hello, {user.displayName}!</h1>
        <p className="text-lg text-muted">You&apos;re in Grade {learner.grade}.</p>
      </section>
      <section className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
        <p className="text-lg">Your lessons are on their way.</p>
        <Link href="/student/onboarding" className="mt-4 inline-block font-semibold text-brand underline underline-offset-4">
          Change my grade
        </Link>
      </section>
    </AppPage>
  );
}
