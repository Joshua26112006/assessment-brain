import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireStudentSession } from "@/lib/require-student";
import { getAvailableAssessmentsForStudent } from "@/lib/student-assessment-access";
import { PageHeader, MetricCard, Section, EmptyState, Card } from "@/components/ui/Page";
import StatusBadge, { submissionBadge } from "@/components/ui/StatusBadge";
import { buttonClass } from "@/components/ui/styles";

export default async function StudentDashboardPage() {
  const session = await requireStudentSession();
  const studentId = session.user.id;

  const [available, inProgressCount, submittedCount, evaluatedCount, recentResults] =
    await Promise.all([
      getAvailableAssessmentsForStudent(studentId),
      prisma.submission.count({ where: { studentId, status: "DRAFT" } }),
      prisma.submission.count({
        where: { studentId, status: { in: ["SUBMITTED", "PROCESSING", "NEEDS_REVIEW"] } },
      }),
      prisma.submission.count({ where: { studentId, status: "COMPLETED" } }),
      prisma.submission.findMany({
        where: { studentId, status: { not: "DRAFT" } },
        orderBy: { submittedAt: "desc" },
        take: 3,
        select: {
          id: true,
          status: true,
          assessment: { select: { title: true } },
        },
      }),
    ]);

  const notStarted = available.filter((a) => !a.submission);
  const inProgress = available.filter((a) => a.submission?.status === "DRAFT");

  const nextUp = inProgress[0] ?? notStarted[0] ?? null;

  return (
    <div>
      <PageHeader
        title={`Hi, ${session.user.name?.split(" ")[0] ?? "there"}`}
        description="Your assessments and results in one place."
        actions={
          <Link href="/student/assessments" className={buttonClass("secondary")}>
            All assessments
          </Link>
        }
      />

      {nextUp && (
        <Card tone="accent" className="mb-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-accent-text">
                {inProgress.length > 0 ? "Continue where you left off" : "Next up"}
              </p>
              <p className="mt-1.5 font-medium">{nextUp.title}</p>
              <p className="mt-0.5 text-sm text-muted">
                {nextUp.subject} · {nextUp._count.questions} question
                {nextUp._count.questions === 1 ? "" : "s"}
              </p>
            </div>
            <Link
              href={
                inProgress.length > 0
                  ? `/student/assessments/${nextUp.id}/take`
                  : `/student/assessments/${nextUp.id}`
              }
              className={buttonClass("primary")}
            >
              {inProgress.length > 0 ? "Continue" : "Start assessment"}
            </Link>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Available" value={notStarted.length} href="/student/assessments" />
        <MetricCard label="In progress" value={inProgressCount} />
        <MetricCard label="Awaiting results" value={submittedCount} href="/student/results" />
        <MetricCard label="Completed" value={evaluatedCount} href="/student/results" />
      </div>

      <Section
        className="mt-10"
        title="Available assessments"
        actions={
          <Link
            href="/student/assessments"
            className="text-sm font-medium text-accent-text hover:underline"
          >
            View all &rarr;
          </Link>
        }
      >
        {notStarted.length === 0 ? (
          <EmptyState
            title={
              available.length === 0
                ? "No assessments yet"
                : "You've started everything available"
            }
            description={
              available.length === 0
                ? "Once your teacher publishes an assessment for your class, it will appear here."
                : "Finish what's in progress, or check your results."
            }
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {notStarted.slice(0, 5).map((assessment) => (
              <li key={assessment.id}>
                <Link
                  href={`/student/assessments/${assessment.id}`}
                  className="flex items-center justify-between gap-4 rounded-xl border border-line bg-surface px-4 py-3 transition-colors hover:border-line-strong"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{assessment.title}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {assessment.subject} · {assessment._count.questions} question
                      {assessment._count.questions === 1 ? "" : "s"}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-medium text-accent-text">Start &rarr;</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {recentResults.length > 0 && (
        <Section
          className="mt-10"
          title="Recent results"
          actions={
            <Link
              href="/student/results"
              className="text-sm font-medium text-accent-text hover:underline"
            >
              View all &rarr;
            </Link>
          }
        >
          <ul className="flex flex-col gap-2">
            {recentResults.map((submission) => {
              const badge = submissionBadge(submission.status, "student");
              return (
                <li key={submission.id}>
                  <Link
                    href={`/student/results/${submission.id}`}
                    className="flex items-center justify-between gap-4 rounded-xl border border-line bg-surface px-4 py-3 transition-colors hover:border-line-strong"
                  >
                    <p className="truncate font-medium">{submission.assessment.title}</p>
                    <StatusBadge label={badge.label} tone={badge.tone} size="sm" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
    </div>
  );
}
