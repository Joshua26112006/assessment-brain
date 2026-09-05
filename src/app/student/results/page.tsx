import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireStudentSession } from "@/lib/require-student";

const STATUS_COPY: Record<string, string> = {
  DRAFT: "In progress — not yet submitted",
  SUBMITTED: "Submitted — awaiting evaluation",
  PROCESSING: "Being evaluated",
  COMPLETED: "Results available",
  NEEDS_REVIEW: "Under teacher review",
  FAILED: "Evaluation failed — your teacher has been notified",
};

export default async function StudentResultsPage() {
  const session = await requireStudentSession();

  const submissions = await prisma.submission.findMany({
    where: { studentId: session.user.id, status: { not: "DRAFT" } },
    orderBy: { submittedAt: "desc" },
    include: {
      assessment: { select: { title: true, subject: true } },
      _count: { select: { questionResponses: true } },
      questionResponses: { select: { status: true } },
    },
  });

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Results</h1>
      <p className="mt-2 text-sm text-black/60 dark:text-white/60">
        Status of the assessments you&apos;ve submitted.
      </p>

      {submissions.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-black/15 p-10 text-center dark:border-white/20">
          <p className="text-sm text-black/60 dark:text-white/60">
            You haven&apos;t submitted any assessments yet.
          </p>
          <Link
            href="/student/assessments"
            className="mt-4 inline-block rounded-md bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
          >
            View available assessments
          </Link>
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {submissions.map((submission) => (
            <li key={submission.id}>
              <Link
                href={`/student/results/${submission.id}`}
                className="block rounded-lg border border-black/10 p-4 hover:border-black/30 dark:border-white/15 dark:hover:border-white/30"
              >
                <div className="flex items-center justify-between gap-4">
                  <h2 className="font-medium">{submission.assessment.title}</h2>
                  <span className="shrink-0 rounded bg-black/5 px-2 py-0.5 text-xs uppercase tracking-wide dark:bg-white/10">
                    {submission.status}
                  </span>
                </div>
                <p className="mt-1 text-sm text-black/60 dark:text-white/60">
                  {STATUS_COPY[submission.status] ?? submission.status}
                </p>
                <p className="mt-2 text-xs text-black/50 dark:text-white/50">
                  Submitted{" "}
                  {submission.submittedAt
                    ? submission.submittedAt.toLocaleString()
                    : "—"}
                  {" · "}
                  {submission.questionResponses.filter((r) => r.status === "GRADED" || r.status === "NEEDS_REVIEW").length}
                  {"/"}
                  {submission._count.questionResponses} questions processed
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
