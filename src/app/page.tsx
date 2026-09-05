import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Assessment Brain
        </h1>
        <p className="mt-2 text-black/60 dark:text-white/60">
          Placeholder application shell. Pick a section to continue.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/teacher/dashboard"
          className="rounded-lg border border-black/10 p-5 hover:border-black/30 dark:border-white/15 dark:hover:border-white/30"
        >
          <h2 className="font-medium">Teacher</h2>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            Upload question papers, generate rubrics, review submissions.
          </p>
        </Link>

        <Link
          href="/student/dashboard"
          className="rounded-lg border border-black/10 p-5 hover:border-black/30 dark:border-white/15 dark:hover:border-white/30"
        >
          <h2 className="font-medium">Student</h2>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            View assigned assessments and results.
          </p>
        </Link>
      </div>
    </div>
  );
}
