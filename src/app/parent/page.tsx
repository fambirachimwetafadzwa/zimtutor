import Link from "next/link";
import { AppPage } from "@/components/layout/PageShell";
import { requireRole } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = { title: "My learners" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ParentHome({ searchParams }: { searchParams: SearchParams }) {
  await requireRole("parent", "/parent");
  const params = await searchParams;
  const added = typeof params.added === "string" ? params.added : null;

  // User-scoped client: row-level security returns only this parent's own children.
  const supabase = await createSupabaseServerClient();
  const { data: learners } = await supabase
    .from("learner_profiles")
    .select("profile_id, grade, username")
    .order("created_at", { ascending: true });
  const ids = (learners ?? []).map((l) => l.profile_id as string);
  const { data: names } = ids.length
    ? await supabase.from("profiles").select("id, display_name").in("id", ids)
    : { data: [] };
  const nameById = new Map((names ?? []).map((n) => [n.id as string, n.display_name as string]));

  return (
    <AppPage>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">My learners</h1>
        <Link
          href="/parent/learners/new"
          className="inline-flex min-h-12 items-center rounded-xl bg-brand px-6 text-lg font-semibold text-brand-contrast hover:brightness-110"
        >
          Add a learner
        </Link>
      </div>
      {added ? (
        <p
          role="status"
          className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-emerald-900"
        >
          Learner account created. Your child can sign in with the username <strong>{added}</strong>
          .
        </p>
      ) : null}
      {(learners ?? []).length === 0 ? (
        <p className="rounded-2xl border border-border bg-surface p-6 text-lg">
          You haven&apos;t added a learner yet. Add one to get started.
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {(learners ?? []).map((l) => (
            <li
              key={l.profile_id as string}
              className="rounded-2xl border border-border bg-surface p-5 shadow-sm"
            >
              <p className="text-xl font-semibold">
                {nameById.get(l.profile_id as string) ?? "Learner"}
              </p>
              <p className="text-muted">
                Grade {l.grade as number} · username{" "}
                <span className="font-mono">{l.username as string}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </AppPage>
  );
}
