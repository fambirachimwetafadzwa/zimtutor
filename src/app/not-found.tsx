import Link from "next/link";

/**
 * The same page for something that is not there and for something that is not yours to see (another
 * family's child, someone else's practice paper): nobody can tell the difference, so nobody can use
 * it to find out what exists.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center gap-6 px-6 py-16">
      <p className="text-2xl font-extrabold tracking-tight text-brand">
        Zim<span className="text-accent">Tutor</span>
      </p>
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-6">
        <h1 className="text-2xl font-bold">We could not find that</h1>
        <p className="text-lg">
          The page you wanted is not here. It may have moved, or the link may not be right.
        </p>
        <div>
          <Link
            href="/"
            className="inline-flex min-h-12 items-center rounded-xl bg-brand px-6 text-lg font-semibold text-brand-contrast"
          >
            Go to the start
          </Link>
        </div>
      </div>
    </main>
  );
}
