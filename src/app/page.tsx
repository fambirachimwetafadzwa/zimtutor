import Link from "next/link";
import { redirect } from "next/navigation";
import { Wordmark } from "@/components/layout/PageShell";
import { homePathForRole } from "@/lib/auth/roles";
import { getCurrentUser } from "@/lib/auth/session";

export default async function HomePage() {
  const user = await getCurrentUser();
  if (user) redirect(homePathForRole(user.role));

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center gap-8 px-6 py-16">
      <Wordmark />
      <div className="flex flex-col gap-4">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Mathematics for Grades 3–7, taught the way the Zimbabwe syllabus teaches it.
        </h1>
        <p className="text-xl text-muted">
          ZimTutor follows the Ministry of Primary and Secondary Education&apos;s Junior Mathematics
          Syllabus (2024–2030). It teaches one learning objective at a time, helps children think
          rather than just giving answers, and moves on only when they are ready.
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Link
          href="/login?who=learner"
          className="inline-flex min-h-14 items-center justify-center rounded-xl bg-brand px-8 py-3 text-xl font-semibold text-brand-contrast shadow-sm hover:brightness-110"
        >
          I&apos;m a learner
        </Link>
        <Link
          href="/signup"
          className="inline-flex min-h-14 items-center justify-center rounded-xl border-2 border-brand px-8 py-3 text-xl font-semibold text-brand hover:bg-surface"
        >
          I&apos;m a parent or guardian
        </Link>
      </div>
      <p className="text-base text-muted">
        We collect as little as possible about children — no email, no location, no advertising.{" "}
        <Link href="/privacy" className="font-medium underline underline-offset-4">
          Read how we protect learners
        </Link>
        .
      </p>
    </main>
  );
}
