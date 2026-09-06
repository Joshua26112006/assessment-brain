import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireTeacherSession } from "@/lib/require-teacher";
import { getOwnedAssessmentOrNotFound } from "@/lib/assessment-ownership";
import { ACTIONABLE_REVIEW_STATUSES } from "@/lib/review-scope";
import {
  describeEvaluationProgress,
  summarizeSubmissionScore,
  type QuestionResultSummary,
} from "@/lib/submission-score";
import { PageHeader, MetricCard, EmptyState, ScoreDisplay } from "@/components/ui/Page";
import StatusBadge, { submissionBadge } from "@/components/ui/StatusBadge";
import { buttonClass } from "@/components/ui/styles";

export const metadata = { title: "Submissions & results" };

const SUBMISSION_STATUS_COPY: Record<string, string> = {
  DRAFT: "Still working — not submitted yet",
  SUBMITTED: "Submitted — evaluation starting",
  PROCESSING: "Being evaluated",
  COMPLETED: "Evaluation complete",
  NEEDS_REVIEW: "Needs your review",
  FAILED: "Evaluation could not be completed",
};

/**
 * The teacher's view of what their class actually did with an assessment.
 *
 * This is the missing half of the loop: the review queue only ever surfaces
 * responses the pipeline flagged, so without this page a teacher can publish
 * an assessment, have every student submit, and never see a single result
 * that evaluated cleanly.
 *
 * Ownership is established once by getOwnedAssessmentOrNotFound — every
 * query below is scoped to that already-verified assessment id, so no
 * submission, response or review item from another teacher's assessment can
 * be reached through this route.
 */
export default async function AssessmentSubmissionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireTeacherSession();
  const assessment = await getOwnedAssessmentOrNotFound(id, session.user.id);

  const [submissions, openReviewItems] = await Promise.all([
    prisma.submission.findMany({
      where: { assessmentId: assessment.id },
      orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
      include: {
        student: { select: { id: true, name: true } },
        questionResponses: {
          select: { id: true, questionId: true, status: true, gradingResult: true },
        },
      },
    }),
    prisma.reviewItem.findMany({
      where: {
        status: { in: [...ACTIONABLE_REVIEW_STATUSES] },
        OR: [
          { assessmentId: assessment.id },
          { questionResponse: { submission: { assessmentId: assessment.id } } },
        ],
      },
      select: { id: true, questionResponseId: true },
    }),
  ]);

  // questionResponseId -> the review item a teacher can open for it.
  const reviewItemByResponseId = new Map(
    openReviewItems
      .filter((item) => item.questionResponseId !== null)
      .map((item) => [item.questionResponseId as string, item.id]),
  );

  const questions = assessment.questions.map((q) => ({
    id: q.id,
    questionNumber: q.questionNumber,
    maximumMarks: q.maximumMarks,
  }));

  const submitted = submissions.filter((s) => s.status !== "DRAFT");
  const needingReview = submissions.filter((s) => s.status === "NEEDS_REVIEW").length;

  return (
    <div>
      <PageHeader
        breadcrumb={[
          { label: "Assessments", href: "/teacher/assessments" },
          { label: assessment.title, href: `/teacher/assessments/${assessment.id}` },
          { label: "Submissions" },
        ]}
        title="Submissions & results"
        description={`${assessment.subject} · ${assessment.grade} · Class: ${assessment.class.name}`}
        actions={
          needingReview > 0 ? (
            <Link href="/teacher/review-queue" className={buttonClass("secondary")}>
              Go to review queue
            </Link>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Submitted" value={submitted.length} />
        <MetricCard label="Still working" value={submissions.length - submitted.length} />
        <MetricCard label="Questions" value={assessment.questions.length} />
        <MetricCard
          label="Needing review"
          value={needingReview}
          emphasis={needingReview > 0}
          href={needingReview > 0 ? "/teacher/review-queue" : undefined}
        />
      </div>

      {submissions.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title={
              assessment.status === "PUBLISHED"
                ? "No student has opened this assessment yet"
                : "Not published yet"
            }
            description={
              assessment.status === "PUBLISHED"
                ? "Results will appear here as students submit and their answers are evaluated."
                : "Students can't take this assessment until it's published to the class."
            }
            action={
              assessment.status !== "PUBLISHED" ? (
                <Link
                  href={`/teacher/assessments/${assessment.id}`}
                  className={buttonClass("primary")}
                >
                  Back to assessment
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : (
        <ul className="mt-8 flex flex-col gap-3">
          {submissions.map((submission) => {
            const summary = summarizeSubmissionScore(questions, submission.questionResponses);
            const responseIdByQuestionId = new Map(
              submission.questionResponses.map((r) => [r.questionId, r.id]),
            );
            const isDraft = submission.status === "DRAFT";

            const badge = submissionBadge(submission.status);

            return (
              <li key={submission.id} className="rounded-xl border border-line bg-surface p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{submission.student.name}</p>
                      <StatusBadge label={badge.label} tone={badge.tone} size="sm" />
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {SUBMISSION_STATUS_COPY[submission.status] ?? submission.status}
                      {submission.submittedAt
                        ? ` · submitted ${submission.submittedAt.toLocaleString()}`
                        : ""}
                    </p>
                  </div>
                  {!isDraft && summary.hasAnyConfirmed && (
                    <ScoreDisplay
                      awarded={summary.awardedMarks}
                      maximum={summary.confirmedMaximumMarks}
                      pending={!summary.allConfirmed}
                    />
                  )}
                </div>

                {!isDraft && (
                  <>
                    <p className="mt-2 text-xs text-subtle">
                      {describeEvaluationProgress(summary)}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {summary.questions.map((question) => (
                        <QuestionChip
                          key={question.questionId}
                          question={question}
                          reviewItemId={
                            reviewItemByResponseId.get(
                              responseIdByQuestionId.get(question.questionId) ?? "",
                            ) ?? null
                          }
                        />
                      ))}
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** One question's outcome, linking to its review item when the pipeline flagged it. */
function QuestionChip({
  question,
  reviewItemId,
}: {
  question: QuestionResultSummary;
  reviewItemId: string | null;
}) {
  const label = `Q${question.questionNumber}`;

  const body =
    question.state === "CONFIRMED"
      ? `${label} · ${question.awardedMarks}/${question.maximumMarks}${
          question.teacherReviewed ? " · checked" : ""
        }`
      : question.state === "NEEDS_REVIEW"
        ? `${label} · needs review`
        : question.state === "FAILED"
          ? `${label} · failed`
          : `${label} · ${question.answered ? "evaluating" : "no answer"}`;

  const tone =
    question.state === "CONFIRMED"
      ? "border-success-line bg-success-soft text-success"
      : question.state === "NEEDS_REVIEW"
        ? "border-warning-line bg-warning-soft text-warning"
        : question.state === "FAILED"
          ? "border-danger-line bg-danger-soft text-danger"
          : "border-line bg-surface-muted text-muted";

  const className = `rounded-md border px-2 py-1 text-xs font-medium tabular-nums ${tone}`;

  if (reviewItemId) {
    return (
      <Link
        href={`/teacher/review-queue/${reviewItemId}`}
        className={`${className} transition-opacity hover:opacity-80`}
      >
        {body} &rarr;
      </Link>
    );
  }
  return <span className={className}>{body}</span>;
}
