import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireStudentSession } from "@/lib/require-student";
import { describeEvaluationProgress, summarizeSubmissionScore } from "@/lib/submission-score";
import { PageHeader, EmptyState, ScoreDisplay } from "@/components/ui/Page";
import StatusBadge, { submissionBadge } from "@/components/ui/StatusBadge";
import { buttonClass } from "@/components/ui/styles";

export const metadata = { title: "Results" };

export default async function StudentResultsPage() {
  const session = await requireStudentSession();

  // Scoped to the authenticated student only — never all submissions.
  const submissions = await prisma.submission.findMany({
    where: { studentId: session.user.id, status: { not: "DRAFT" } },
    orderBy: { submittedAt: "desc" },
    include: {
      assessment: {
        select: {
          title: true,
          subject: true,
          questions: { select: { id: true, questionNumber: true, maximumMarks: true } },
        },
      },
      questionResponses: { select: { questionId: true, status: true, gradingResult: true } },
    },
  });

  return (
    <div>
      <PageHeader
        title="Results"
        description="Marks and feedback for the assessments you've submitted."
      />

      {submissions.length === 0 ? (
        <EmptyState
          title="No results yet"
          description="Once you submit an assessment, your marks and feedback will appear here."
          action={
            <Link href="/student/assessments" className={buttonClass("primary")}>
              View available assessments
            </Link>
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {submissions.map((submission) => {
            // Same summarizer the detail page uses, so the score shown here
            // can never disagree with the score shown when it's opened.
            const summary = summarizeSubmissionScore(
              submission.assessment.questions,
              submission.questionResponses,
            );
            const badge = submissionBadge(submission.status, "student");

            return (
              <li key={submission.id}>
                <Link
                  href={`/student/results/${submission.id}`}
                  className="block rounded-xl border border-line bg-surface p-5 transition-colors hover:border-line-strong"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-medium">{submission.assessment.title}</h2>
                        <StatusBadge label={badge.label} tone={badge.tone} size="sm" />
                      </div>
                      <p className="mt-1 text-sm text-muted">{submission.assessment.subject}</p>
                      <p className="mt-2 text-xs text-subtle">
                        {describeEvaluationProgress(summary)}
                      </p>
                    </div>

                    {summary.hasAnyConfirmed && (
                      <ScoreDisplay
                        awarded={summary.awardedMarks}
                        maximum={summary.confirmedMaximumMarks}
                        pending={!summary.allConfirmed}
                      />
                    )}
                  </div>

                  <p className="mt-4 flex items-center justify-between border-t border-line pt-3 text-xs text-subtle">
                    <span>
                      Submitted{" "}
                      {submission.submittedAt ? submission.submittedAt.toLocaleString() : "—"}
                    </span>
                    <span className="font-medium text-accent-text">View details &rarr;</span>
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
