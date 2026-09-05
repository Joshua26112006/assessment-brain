import Link from "next/link";
import { requireStudentSession } from "@/lib/require-student";
import {
  getEligibleAssessmentOrNotFound,
} from "@/lib/student-assessment-access";
import { prisma } from "@/lib/prisma";

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
    select: { status: true },
  });

  const alreadySubmitted = existingSubmission && existingSubmission.status !== "DRAFT";

  return (
    <div className="mx-auto max-w-2xl">
      <p className="text-sm text-black/50 dark:text-white/50">
        <Link href="/student/assessments" className="hover:underline">
          Assessments
        </Link>{" "}
        / {assessment.title}
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">
        {assessment.title}
      </h1>
      <p className="mt-2 text-sm text-black/60 dark:text-white/60">
        {assessment.subject} &middot; {assessment.grade} &middot;{" "}
        {assessment.curriculum} &middot; Class: {assessment.class.name}
      </p>

      <div className="mt-6 rounded-lg border border-black/10 p-5 dark:border-white/15">
        <h2 className="text-sm font-medium">Before you begin</h2>
        <ul className="mt-2 list-inside list-disc text-sm text-black/70 dark:text-white/70">
          <li>{assessment.questions.length} question{assessment.questions.length === 1 ? "" : "s"} in total</li>
          <li>
            Total marks:{" "}
            {assessment.questions
              .reduce((sum, q) => sum + Number(q.maximumMarks), 0)
              .toString()}
          </li>
          <li>Your answers are saved as you go — you can leave and come back.</li>
          <li>Once submitted, answers can no longer be edited.</li>
        </ul>
      </div>

      <div className="mt-6">
        {alreadySubmitted ? (
          <Link
            href="/student/results"
            className="inline-block rounded-md bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
          >
            View submission status
          </Link>
        ) : (
          <Link
            href={`/student/assessments/${assessment.id}/take`}
            className="inline-block rounded-md bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
          >
            {existingSubmission ? "Continue Assessment" : "Start Assessment"}
          </Link>
        )}
      </div>
    </div>
  );
}
