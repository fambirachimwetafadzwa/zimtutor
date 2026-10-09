"use client";

/**
 * The last resort, for a fault in the page shell itself. It stands on its own (no stylesheet, no
 * layout): plain words and one button, styled with style attributes, which the Content Security
 * Policy allows.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, sans-serif",
          background: "#fbfaf6",
          color: "#1b2a2f",
        }}
      >
        <main style={{ maxWidth: 560, margin: "0 auto", padding: "64px 24px" }}>
          <h1 style={{ fontSize: 28 }}>Something went wrong</h1>
          <p style={{ fontSize: 18 }}>
            That was not your fault. Please try again. If it keeps happening, ask a grown-up to tell
            us.
          </p>
          {error.digest ? (
            <p style={{ fontSize: 14, color: "#5b6b70" }}>Reference: {error.digest}</p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: 48,
              padding: "0 24px",
              fontSize: 18,
              fontWeight: 600,
              borderRadius: 12,
              border: 0,
              background: "#0f6b4f",
              color: "#fff",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
