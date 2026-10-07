import Link from "next/link";
import { redirect } from "next/navigation";
import { SignUpForm } from "@/components/auth/SignUpForm";
import { CardPage } from "@/components/layout/PageShell";
import { homePathForRole } from "@/lib/auth/roles";
import { getCurrentUser } from "@/lib/auth/session";
import { isPublicEnvConfigured } from "@/lib/env";

export const metadata = { title: "Create a parent account" };

export default async function SignUpPage() {
  const user = await getCurrentUser();
  if (user) redirect(homePathForRole(user.role));

  return (
    <CardPage
      title="Create a parent account"
      intro="Parents and guardians sign up first, then create accounts for their children."
    >
      {!isPublicEnvConfigured() ? (
        <p
          role="alert"
          className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900"
        >
          Sign-up isn&apos;t set up on this server yet.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          <SignUpForm />
          <p className="text-base text-muted">
            Already have an account?{" "}
            <Link
              href="/login?who=parent"
              className="font-semibold text-brand underline underline-offset-4"
            >
              Sign in
            </Link>
            . Read our{" "}
            <Link href="/privacy" className="font-semibold underline underline-offset-4">
              privacy promises
            </Link>
            .
          </p>
        </div>
      )}
    </CardPage>
  );
}
