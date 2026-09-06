"use client";

import Link from "next/link";
import { buttonClass } from "@/components/ui/styles";

/**
 * Route-level error boundary for the whole app.
 *
 * Deliberately shows nothing from the thrown error itself — a server-side
 * failure here can carry database or provider detail that must never reach a
 * browser. `digest` is the opaque id Next.js assigns so a specific incident
 * can still be matched to the server logs.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-md py-10 text-center">
      <div
        aria-hidden="true"
        className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-danger-line bg-danger-soft text-lg font-semibold text-danger"
      >
        !
      </div>
      <h1 className="mt-4 text-xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted">
        This page couldn&apos;t be loaded. Your work isn&apos;t lost — saved answers, submitted
        assessments, and completed reviews are all stored on the server.
      </p>

      <div className="mt-6 flex justify-center gap-3">
        <button type="button" onClick={reset} className={buttonClass("primary")}>
          Try again
        </button>
        <Link href="/" className={buttonClass("secondary")}>
          Go home
        </Link>
      </div>

      {error.digest && (
        <p className="mt-6 font-mono text-xs text-subtle">Reference: {error.digest}</p>
      )}
    </div>
  );
}
