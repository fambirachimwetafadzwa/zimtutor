"use client";

import { useEffect } from "react";
import { AppPage } from "@/components/layout/PageShell";

/** Admin pages fail LOUDLY: corrupt curriculum data is reported, never rendered as if it were fine. */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[admin] page failed", error);
  }, [error]);

  return (
    <AppPage>
      <div
        role="alert"
        className="flex flex-col gap-3 rounded-2xl border border-red-300 bg-red-50 p-6 text-red-900"
      >
        <h1 className="text-2xl font-bold">This page could not be shown</h1>
        <p>
          {error.name === "CurriculumIntegrityError" || error.name === "CurriculumQueryError"
            ? error.message
            : "Something went wrong while loading this page."}
        </p>
        {error.digest ? <p className="text-sm">Reference: {error.digest}</p> : null}
        <button
          type="button"
          onClick={reset}
          className="min-h-12 self-start rounded-xl border border-red-400 bg-white px-5 font-semibold"
        >
          Try again
        </button>
      </div>
    </AppPage>
  );
}
