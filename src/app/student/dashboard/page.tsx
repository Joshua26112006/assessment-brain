import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireStudentSession } from "@/lib/require-student";
import { getAvailableAssessmentsForStudent } from "@/lib/student-assessment-access";

export default async function StudentDashboardPage() {
  const session = await requireStudentSession();
  const studentId = session.user.id;

  const [available, inProgressCount, submittedCount, evaluatedCount] = await Promise.all([
    getAvailableAssessmentsForStudent(studentId),
    prisma.submission.count({ where: { studentId, status: "DRAFT" } }),
    prisma.submission.count({ where: { studentId, status: { in: ["SUBMITTED", "PROCESSING", "NEEDS_REVIEW"] } } }),
    prisma.submission.count({ where: { studentId, status: "COMPLETED" } }),
  ]);

  const notStarted = available.filter((a) => !a.submission);
  const inProgress = available.filter((a) => a.submission?.status === "DRAFT");

  const summaryCards = [
    { label: "Available Assessments", value: notStarted.length },
    { label: "In Progress", value: inProgressCount },
    { label: "Submitted", value: submittedCount },
    { label: "Evaluated", value: evaluatedCount },
  ];

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">
          Student Dashboard
        </h1>
        <Link
          href="/student/assessments"
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
        >
          View Assessments
        </Link>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {summaryCards.map((card) => (
          <div
            key={card.label}
            className="rounded-lg border border-black/10 p-4 dark:border-white/15"
          >
            <p className="text-2xl font-semibold">{card.value}</p>
            <p className="mt-1 text-xs text-black/60 dark:text-white/60">
              {card.label}
            </p>
          </div>
        ))}
      </div>

      {inProgress.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-medium">Continue where you left off</h2>
          <ul className="mt-4 flex flex-col gap-2">
            {inProgress.map((assessment) => (
              <li key={assessment.id}>
                <Link
                  href={`/student/assessments/${assessment.id}/take`}
                  className="flex items-center justify-between rounded-lg border border-black/10 px-4 py-3 hover:border-black/30 dark:border-white/15 dark:hover:border-white/30"
                >
                  <span className="font-medium">{assessment.title}</span>
                  <span className="text-sm text-black/60 dark:text-white/60">
                    Continue &rarr;
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Available Assessments</h2>
          <Link href="/student/assessments" className="text-sm hover:underline">
            View all
          </Link>
        </div>

        {notStarted.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-black/15 p-8 text-center dark:border-white/20">
            <p className="text-sm text-black/60 dark:text-white/60">
              {available.length === 0
                ? "No assessments are available yet."
                : "You've started all currently available assessments."}
            </p>
          </div>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {notStarted.slice(0, 5).map((assessment) => (
              <li key={assessment.id}>
                <Link
                  href={`/student/assessments/${assessment.id}`}
                  className="flex items-center justify-between rounded-lg border border-black/10 px-4 py-3 hover:border-black/30 dark:border-white/15 dark:hover:border-white/30"
                >
                  <div>
                    <p className="font-medium">{assessment.title}</p>
                    <p className="text-xs text-black/50 dark:text-white/50">
                      {assessment._count.questions} question
                      {assessment._count.questions === 1 ? "" : "s"}
                    </p>
                  </div>
                  <span className="text-sm text-black/60 dark:text-white/60">
                    Start &rarr;
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
