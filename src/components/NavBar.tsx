"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";

/**
 * Top-level navigation. Shows role-appropriate section links plus
 * sign-out for authenticated users, and Login/Register for everyone else.
 */
export default function NavBar() {
  const { data: session, status } = useSession();

  return (
    <header className="border-b border-black/10 dark:border-white/15">
      <nav className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-4">
        <Link href="/" className="font-semibold tracking-tight">
          Assessment Brain
        </Link>

        {status === "authenticated" && session.user.role === "TEACHER" && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <Link href="/teacher/dashboard" className="hover:underline">
              Dashboard
            </Link>
            <Link href="/teacher/assessments" className="hover:underline">
              Assessments
            </Link>
            <Link href="/teacher/assessments/create" className="hover:underline">
              Create Assessment
            </Link>
            <Link href="/teacher/review-queue" className="hover:underline">
              Review Queue
            </Link>
          </div>
        )}

        {status === "authenticated" && session.user.role === "STUDENT" && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <Link href="/student/dashboard" className="hover:underline">
              Dashboard
            </Link>
            <Link href="/student/assessments" className="hover:underline">
              Assessments
            </Link>
            <Link href="/student/results" className="hover:underline">
              Results
            </Link>
          </div>
        )}

        <div className="flex items-center gap-3 text-sm">
          {status === "authenticated" ? (
            <>
              <span className="text-black/60 dark:text-white/60">
                {session.user.name}{" "}
                <span className="rounded bg-black/5 px-1.5 py-0.5 text-xs uppercase tracking-wide dark:bg-white/10">
                  {session.user.role}
                </span>
              </span>
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: "/" })}
                className="rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
              >
                Sign out
              </button>
            </>
          ) : status === "unauthenticated" ? (
            <>
              <Link href="/login" className="hover:underline">
                Login
              </Link>
              <Link
                href="/register"
                className="rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white dark:bg-white dark:text-black"
              >
                Register
              </Link>
            </>
          ) : null}
        </div>
      </nav>
    </header>
  );
}
