import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireTeacherSession } from "@/lib/require-teacher";
import { ACTIONABLE_REVIEW_STATUSES, reviewItemOwnedByTeacher } from "@/lib/review-scope";
import { PageHeader, MetricCard, Section, EmptyState, Card } from "@/components/ui/Page";
import StatusBadge, { assessmentBadge, reviewReasonBadge } from "@/components/ui/StatusBadge";
import { buttonClass } from "@/components/ui/styles";

export default async function TeacherDashboardPage() {
  const session = await requireTeacherSession();
  const teacherId = session.user.id;

  const [
    totalAssessments,
    draftCount,
    publishedCount,
    totalSubmissions,
    pendingReviewCount,
    recentAssessments,
    oldestOpenReviews,
  ] = await Promise.all([
    prisma.assessment.count({ where: { teacherId } }),
    prisma.assessment.count({ where: { teacherId, status: "DRAFT" } }),
    prisma.assessment.count({ where: { teacherId, status: "PUBLISHED" } }),
    prisma.submission.count({ where: { assessment: { teacherId } } }),
    // Everything a teacher can still act on — not just PENDING, which
    // before the review workflow was the only status an item could hold.
    prisma.reviewItem.count({
      where: {
        status: { in: [...ACTIONABLE_REVIEW_STATUSES] },
        ...reviewItemOwnedByTeacher(teacherId),
      },
    }),
    prisma.assessment.findMany({
      where: { teacherId },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { _count: { select: { questions: true, submissions: true } } },
    }),
    prisma.reviewItem.findMany({
      where: {
        status: { in: [...ACTIONABLE_REVIEW_STATUSES] },
        ...reviewItemOwnedByTeacher(teacherId),
      },
      orderBy: { createdAt: "asc" },
      take: 3,
      select: {
        id: true,
        reason: true,
        question: { select: { questionNumber: true } },
        submission: {
          select: { student: { select: { name: true } }, assessment: { select: { title: true } } },
        },
      },
    }),
  ]);

  return (
    <div>
      <PageHeader
        title={`Welcome back, ${session.user.name?.split(" ")[0] ?? "there"}`}
        description="Create assessments, review anything the evaluation pipeline wasn't sure about, and follow how your classes are doing."
        actions={
          <Link href="/teacher/assessments/create" className={buttonClass("primary")}>
            Create assessment
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Assessments" value={totalAssessments} href="/teacher/assessments" />
        <MetricCard label="Published" value={publishedCount} hint={`${draftCount} in draft`} href="/teacher/assessments" />
        <MetricCard label="Submissions" value={totalSubmissions} />
        <MetricCard
          label="Needs your review"
          value={pendingReviewCount}
          href="/teacher/review-queue"
          emphasis={pendingReviewCount > 0}
          hint={pendingReviewCount > 0 ? "Waiting on you" : "Nothing pending"}
        />
      </div>

      {oldestOpenReviews.length > 0 && (
        <Section
          className="mt-10"
          title="Waiting on you"
          description="The longest-open items the pipeline flagged for a human decision."
          actions={
            <Link href="/teacher/review-queue" className="text-sm font-medium text-accent-text hover:underline">
              Open review queue &rarr;
            </Link>
          }
        >
          <ul className="flex flex-col gap-2">
            {oldestOpenReviews.map((item) => {
              const badge = reviewReasonBadge(item.reason);
              return (
                <li key={item.id}>
                  <Link
                    href={`/teacher/review-queue/${item.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 transition-colors hover:border-line-strong"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {item.submission?.assessment.title ?? "Assessment"}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">
                        {item.submission?.student.name ?? "Unknown student"}
                        {item.question ? ` · Question ${item.question.questionNumber}` : ""}
                      </p>
                    </div>
                    <StatusBadge label={badge.label} tone={badge.tone} size="sm" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      <Section
        className="mt-10"
        title="Recent assessments"
        actions={
          <Link href="/teacher/assessments" className="text-sm font-medium text-accent-text hover:underline">
            View all &rarr;
          </Link>
        }
      >
        {recentAssessments.length === 0 ? (
          <EmptyState
            title="No assessments yet"
            description="Create an assessment, add questions and rubrics, then publish it to your class."
            action={
              <Link href="/teacher/assessments/create" className={buttonClass("primary")}>
                Create your first assessment
              </Link>
            }
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {recentAssessments.map((assessment) => {
              const badge = assessmentBadge(assessment.status);
              return (
                <li key={assessment.id}>
                  <Link
                    href={`/teacher/assessments/${assessment.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 transition-colors hover:border-line-strong"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{assessment.title}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {assessment._count.questions} question
                        {assessment._count.questions === 1 ? "" : "s"} ·{" "}
                        {assessment._count.submissions} submission
                        {assessment._count.submissions === 1 ? "" : "s"}
                      </p>
                    </div>
                    <StatusBadge label={badge.label} tone={badge.tone} size="sm" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {totalAssessments > 0 && publishedCount === 0 && (
        <Card tone="accent" className="mt-8">
          <p className="text-sm font-medium">Next step: publish an assessment</p>
          <p className="mt-1 text-sm text-muted">
            Students can only take an assessment once it&apos;s published, and every question needs a
            rubric before publishing is allowed.
          </p>
        </Card>
      )}
    </div>
  );
}
