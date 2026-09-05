import Link from "next/link";

/**
 * Temporary top-level navigation for switching between the Teacher and
 * Student sections during early scaffolding. Will be replaced once
 * authentication and role-based routing are introduced.
 */
export default function NavBar() {
  return (
    <header className="border-b border-black/10 dark:border-white/15">
      <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-4">
        <Link href="/" className="font-semibold tracking-tight">
          Assessment Brain
        </Link>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="text-black/40 dark:text-white/40">Teacher:</span>
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

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="text-black/40 dark:text-white/40">Student:</span>
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
      </nav>
    </header>
  );
}
