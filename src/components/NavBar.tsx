"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";

/**
 * Top-level navigation: role-appropriate section links, the signed-in
 * identity, and sign-out. The active section is marked so a user always knows
 * which part of the product they're in.
 */

const TEACHER_LINKS = [
  { href: "/teacher/dashboard", label: "Dashboard" },
  { href: "/teacher/assessments", label: "Assessments" },
  { href: "/teacher/review-queue", label: "Review Queue" },
];

const STUDENT_LINKS = [
  { href: "/student/dashboard", label: "Dashboard" },
  { href: "/student/assessments", label: "Assessments" },
  { href: "/student/results", label: "Results" },
];

export default function NavBar() {
  const { data: session, status } = useSession();
  const pathname = usePathname();

  const links =
    status === "authenticated"
      ? session.user.role === "TEACHER"
        ? TEACHER_LINKS
        : STUDENT_LINKS
      : [];

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-background/85 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-3">
        <Link
          href="/"
          className="flex items-center gap-2 font-semibold tracking-tight text-foreground"
        >
          <span
            aria-hidden="true"
            className="grid h-7 w-7 place-items-center rounded-md bg-accent text-[13px] font-bold text-accent-fg"
          >
            AB
          </span>
          Assessment Brain
        </Link>

        {links.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 text-sm">
            {links.map((link) => {
              const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`rounded-md px-2.5 py-1.5 transition-colors ${
                    isActive
                      ? "bg-accent-soft font-medium text-accent-text"
                      : "text-muted hover:bg-surface-muted hover:text-foreground"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        )}

        <div className="ml-auto flex items-center gap-3 text-sm">
          {status === "authenticated" ? (
            <>
              <span className="hidden items-center gap-2 text-muted sm:flex">
                {session.user.name}
                <span className="rounded border border-line bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-subtle">
                  {session.user.role}
                </span>
              </span>
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: "/" })}
                className="rounded-md border border-line-strong px-3 py-1.5 text-sm font-medium transition-colors hover:bg-surface-muted"
              >
                Sign out
              </button>
            </>
          ) : status === "unauthenticated" ? (
            <>
              <Link href="/login" className="text-muted hover:text-foreground">
                Login
              </Link>
              <Link
                href="/register"
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
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
