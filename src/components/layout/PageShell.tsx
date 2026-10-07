import Link from "next/link";
import type { ReactNode } from "react";
import { signOutAction } from "@/app/actions/auth";
import type { CurrentUser } from "@/lib/auth/session";

export function Wordmark() {
  return (
    <Link href="/" className="text-2xl font-extrabold tracking-tight text-brand">
      Zim<span className="text-accent">Tutor</span>
    </Link>
  );
}

/** Centered narrow card used by sign-in, sign-up and similar single-task pages. */
export function CardPage({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center gap-6 px-5 py-10">
      <Wordmark />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        {intro ? <p className="text-lg text-muted">{intro}</p> : null}
      </div>
      <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm">{children}</div>
    </main>
  );
}

/** Header for signed-in areas. */
export function AppHeader({ user, nav = [] }: { user: CurrentUser; nav?: { href: string; label: string }[] }) {
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-3">
        <div className="flex flex-wrap items-center gap-5">
          <Wordmark />
          <nav aria-label="Main" className="flex flex-wrap gap-4 text-base font-medium">
            {nav.map((item) => (
              <Link key={item.href} href={item.href} className="underline-offset-4 hover:underline">
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-base">
          <span className="text-muted">Hi, {user.displayName}</span>
          <form action={signOutAction}>
            <button
              type="submit"
              className="min-h-11 rounded-xl border border-border px-4 font-semibold hover:bg-background"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}

export function AppPage({ children }: { children: ReactNode }) {
  return <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-5 py-8">{children}</main>;
}
