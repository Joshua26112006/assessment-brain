import Link from "next/link";
import { requireStudentSession } from "@/lib/require-student";
import { getEligibleAssessmentOrNotFound } from "@/lib/student-assessment-access";
import { prisma } from "@/lib/prisma";
import { PageHeader, Card } from "@/components/ui/Page";
import StatusBadge, { submissionBadge } from "@/components/ui/StatusBadge";
import { buttonClass } from "@/components/ui/styles";

export default async function StudentAssessmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireStudentSession();
  const assessment = await getEligibleAssessmentOrNotFound(id, session.user.id);

  const existingSubmission = await prisma.submission.findUnique({
    where: { assessmentId_studentId: { assessmentId: id, studentId: session.user.id } },
    select: { id: true, status: true },
  });

  const alreadySubmitted = existingSubmission && existingSubmission.status !== "DRAFT";
  const totalMarks = assessment.questions.reduce((sum, q) => sum + Number(q.maximumMarks), 0);
  const badge = existingSubmission ? submissionBadge(existingSubmission.status, "student") : null;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        breadcrumb={[
          { label: "Assessments", href: "/student/assessments" },
          { label: assessment.title },
        ]}
        title={assessment.title}
        description={`${assessment.subject} · ${assessment.grade} · ${assessment.curriculum} · Class: ${assessment.class.name}`}
        meta={badge ? <StatusBadge label={badge.label} tone={badge.tone} /> : undefined}
      />

      <Card>
        <h2 className="text-sm font-semibold">Before you begin</h2>
        <dl className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <dt className="text-xs text-subtle">Questions</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums">
              {assessment.questions.length}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-subtle">Total marks</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums">{totalMarks}</dd>
          </div>
        </dl>

        <ul className="mt-5 flex flex-col gap-2 border-t border-line pt-4 text-sm text-muted">
          <li>You&apos;ll see the full question paper first — there&apos;s no time limit.</li>
          <li>Write your answers by hand on paper, then photograph or scan each page.</li>
          <li>Upload your pages whenever you&apos;re ready. You can leave and come back before submitting.</li>
          <li>Once you submit, your answer sheets are locked and can no longer be changed.</li>
          <li>
            Your answers are marked against your teacher&apos;s rubric, and anything uncertain is
            checked by your teacher before it counts.
          </li>
        </ul>
      </Card>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {alreadySubmitted ? (
          <>
            <Link href={`/student/results/${existingSubmission.id}`} className={buttonClass("primary")}>
              View your result
            </Link>
            <p className="text-sm text-muted">You&apos;ve already submitted this assessment.</p>
          </>
        ) : (
          <>
            <Link
              href={`/student/assessments/${assessment.id}/take`}
              className={buttonClass("primary")}
            >
              {existingSubmission ? "Continue assessment" : "Start assessment"}
            </Link>
            <Link href="/student/assessments" className={buttonClass("secondary")}>
              Back
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
