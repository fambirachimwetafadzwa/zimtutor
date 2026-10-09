"use client";

import Link from "next/link";

/**
 * When a page breaks, a child sees this and not a blank screen: what happened was not their fault,
 * and they can try again or go back to the start. The reference lets whoever looks after the
 * service match this to the record of the fault on the server.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center gap-6 px-6 py-16">
      <p className="text-2xl font-extrabold tracking-tight text-brand">
        Zim<span className="text-accent">Tutor</span>
      </p>
      <div
        role="alert"
        className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-6"
      >
        <h1 className="text-2xl font-bold">Something went wrong</h1>
        <p className="text-lg">
          That was not your fault. Please try again. If it keeps happening, ask a grown-up to tell
          us.
        </p>
        {error.digest ? <p className="text-sm text-muted">Reference: {error.digest}</p> : null}
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={reset}
            className="min-h-12 rounded-xl bg-brand px-6 text-lg font-semibold text-brand-contrast"
          >
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex min-h-12 items-center rounded-xl border-2 border-border px-6 text-lg font-semibold"
          >
            Go to the start
          </Link>
        </div>
      </div>
    </main>
  );
}
