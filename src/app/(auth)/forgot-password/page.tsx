import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { CardPage } from "@/components/layout/PageShell";

export const metadata = { title: "Forgot your password?" };

export default function ForgotPasswordPage() {
  return (
    <CardPage
      title="Forgot your password?"
      intro="Parents and guardians can choose a new one by email."
    >
      <div className="flex flex-col gap-6">
        <ForgotPasswordForm />
        <p className="text-base text-muted">
          A child who has forgotten their password should ask their parent or guardian: they can
          choose a new one on the child&apos;s page.
        </p>
        <p className="text-base">
          <Link
            href="/login?who=parent"
            className="font-semibold text-brand underline underline-offset-4"
          >
            ← Back to sign in
          </Link>
        </p>
      </div>
    </CardPage>
  );
}
