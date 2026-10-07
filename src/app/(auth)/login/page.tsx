import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";
import { CardPage } from "@/components/layout/PageShell";
import { homePathForRole } from "@/lib/auth/roles";
import { safeRedirectPath } from "@/lib/auth/redirects";
import { getCurrentUser } from "@/lib/auth/session";
import { isPublicEnvConfigured } from "@/lib/env";

export const metadata = { title: "Sign in" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const who = params.who === "parent" ? "parent" : "learner";
  const requested = typeof params.next === "string" ? params.next : null;

  const user = await getCurrentUser();
  if (user) redirect(safeRedirectPath(requested, homePathForRole(user.role)));

  const next = safeRedirectPath(requested, "/");
  const tab = (target: "learner" | "parent") =>
    `inline-flex min-h-12 flex-1 items-center justify-center rounded-xl px-4 text-lg font-semibold ${
      who === target
        ? "bg-brand text-brand-contrast"
        : "border border-border bg-surface hover:bg-background"
    }`;

  return (
    <CardPage
      title="Sign in"
      intro={who === "learner" ? "Welcome back! Let's do some maths." : undefined}
    >
      {!isPublicEnvConfigured() ? (
        <p
          role="alert"
          className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900"
        >
          Sign-in isn&apos;t set up on this server yet. An administrator needs to add the Supabase
          settings (see <code>.env.example</code>).
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          <div role="tablist" aria-label="Who is signing in?" className="flex gap-3">
            <Link
              role="tab"
              aria-selected={who === "learner"}
              href={`/login?who=learner${requested ? `&next=${encodeURIComponent(next)}` : ""}`}
              className={tab("learner")}
            >
              I&apos;m a learner
            </Link>
            <Link
              role="tab"
              aria-selected={who === "parent"}
              href={`/login?who=parent${requested ? `&next=${encodeURIComponent(next)}` : ""}`}
              className={tab("parent")}
            >
              Parent / guardian
            </Link>
          </div>
          <LoginForm mode={who} next={next} />
          {who === "parent" ? (
            <p className="text-base text-muted">
              New here?{" "}
              <Link
                href="/signup"
                className="font-semibold text-brand underline underline-offset-4"
              >
                Create a parent account
              </Link>
              . Learners are added by their parent after that.
            </p>
          ) : (
            <p className="text-base text-muted">
              Don&apos;t have a username yet? Ask your parent or guardian to create one for you.
            </p>
          )}
        </div>
      )}
    </CardPage>
  );
}
