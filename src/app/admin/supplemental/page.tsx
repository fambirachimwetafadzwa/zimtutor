import Link from "next/link";
import { AppPage } from "@/components/layout/PageShell";
import { SupplementalCard } from "@/components/admin/SupplementalCard";
import { Breadcrumbs } from "@/components/curriculum/Breadcrumbs";
import { requireRole } from "@/lib/auth/session";
import { listDocuments } from "@/lib/curriculum/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  REVIEW_STATUSES,
  SOURCE_TYPES,
  SOURCE_TYPE_INFO,
  STATUS_LABELS,
} from "@/lib/supplemental/rules";
import { listSupplemental } from "@/lib/supplemental/service";

export const metadata = { title: "Supplemental content" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function SupplementalIndex({ searchParams }: { searchParams: SearchParams }) {
  await requireRole("admin", "/admin/supplemental");
  const params = await searchParams;
  const type = (SOURCE_TYPES as readonly string[]).includes(one(params.type) ?? "")
    ? one(params.type)
    : undefined;
  const status = (REVIEW_STATUSES as readonly string[]).includes(one(params.status) ?? "")
    ? one(params.status)
    : undefined;

  const db = await createSupabaseServerClient();
  const [items, documents] = await Promise.all([
    listSupplemental(db, { sourceType: type, verificationStatus: status }),
    listDocuments(db),
  ]);

  const chip = (active: boolean) =>
    `inline-flex min-h-11 items-center rounded-xl border px-3 text-base ${
      active
        ? "border-brand bg-brand text-brand-contrast"
        : "border-border bg-surface hover:bg-background"
    }`;
  const href = (next: { type?: string; status?: string }) => {
    const q = new URLSearchParams();
    if (next.type) q.set("type", next.type);
    if (next.status) q.set("status", next.status);
    const s = q.toString();
    return `/admin/supplemental${s ? `?${s}` : ""}`;
  };

  return (
    <AppPage>
      <Breadcrumbs
        items={[{ label: "Admin", href: "/admin" }, { label: "Supplemental content" }]}
      />
      <h1 className="text-3xl font-bold tracking-tight">Supplemental content</h1>
      <p className="text-lg text-muted">
        Material that sits next to the official curriculum. Add it from an objective&apos;s page;
        relabel it here or there. Official labels need a citation whose wording is checked against
        the document.
      </p>

      <nav aria-label="Filter by label" className="flex flex-col gap-3">
        <ul className="flex flex-wrap gap-2">
          <li>
            <Link
              href={href({ status })}
              className={chip(!type)}
              aria-current={!type ? "true" : undefined}
            >
              All labels
            </Link>
          </li>
          {SOURCE_TYPES.map((t) => (
            <li key={t}>
              <Link
                href={href({ type: t, status })}
                className={chip(type === t)}
                aria-current={type === t ? "true" : undefined}
              >
                {SOURCE_TYPE_INFO[t].label}
              </Link>
            </li>
          ))}
        </ul>
        <ul className="flex flex-wrap gap-2">
          <li>
            <Link
              href={href({ type })}
              className={chip(!status)}
              aria-current={!status ? "true" : undefined}
            >
              Any status
            </Link>
          </li>
          {REVIEW_STATUSES.map((s) => (
            <li key={s}>
              <Link
                href={href({ type, status: s })}
                className={chip(status === s)}
                aria-current={status === s ? "true" : undefined}
              >
                {STATUS_LABELS[s]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {items.length === 0 ? (
        <p className="rounded-2xl border border-border bg-surface p-6 text-lg">
          Nothing matches these filters yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {items.map((item) => (
            <li key={item.id}>
              <SupplementalCard item={item} documents={documents} showObjectiveLink />
            </li>
          ))}
        </ul>
      )}
    </AppPage>
  );
}
