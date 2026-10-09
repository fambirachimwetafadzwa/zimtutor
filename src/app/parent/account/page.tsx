import Link from "next/link";
import { AppPage } from "@/components/layout/PageShell";
import { DeleteAccountForm } from "@/components/parent/DeleteAccountForm";
import { requireRole } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = { title: "My account" };

export default async function ParentAccountPage() {
  await requireRole("parent", "/parent/account");

  // User-scoped client: row-level security returns only this parent's own children.
  const supabase = await createSupabaseServerClient();
  const { data: learners } = await supabase
    .from("learner_profiles")
    .select("profile_id, username")
    .order("created_at", { ascending: true });
  const ids = (learners ?? []).map((l) => l.profile_id as string);
  const { data: names } = ids.length
    ? await supabase.from("profiles").select("id, display_name").in("id", ids)
    : { data: [] };
  const nameById = new Map((names ?? []).map((n) => [n.id as string, n.display_name as string]));

  return (
    <AppPage>
      <section className="flex flex-col gap-1">
        <Link href="/parent" className="text-base font-semibold text-brand underline">
          ← My learners
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">My account</h1>
      </section>

      <section
        aria-labelledby="delete-heading"
        className="flex flex-col gap-4 rounded-2xl border border-red-300 bg-surface p-6"
      >
        <h2 id="delete-heading" className="text-2xl font-bold text-red-800">
          Delete my account
        </h2>
        <p className="text-lg">
          This deletes your account and everything saved about it. It also deletes the account of
          every learner you look after
          {(learners ?? []).length > 0 ? ":" : " (you have not added any)."}
        </p>
        {(learners ?? []).length > 0 ? (
          <ul className="list-disc pl-6 text-lg">
            {(learners ?? []).map((l) => (
              <li key={l.profile_id as string}>
                {nameById.get(l.profile_id as string) ?? "Learner"} (
                <span className="font-mono">{l.username as string}</span>)
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-base text-muted">
          For each learner that means their progress, every lesson, the questions they asked, the
          answers they gave and their practice papers. It cannot be undone, and nobody at ZimTutor
          can get any of it back. To delete just one learner, open their page and use &ldquo;Delete
          account&rdquo; there.
        </p>
        <DeleteAccountForm />
      </section>
    </AppPage>
  );
}
