import { redirect } from "next/navigation";
import { requireStudentSession } from "@/lib/require-student";
import {
  getEligibleAssessmentOrNotFound,
  getOrCreateSubmission,
} from "@/lib/student-assessment-access";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/Page";
import AnswerForm from "./AnswerForm";
import SubmitAssessmentButton from "./SubmitAssessmentButton";

export default async function TakeAssessmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireStudentSession();
  const assessment = await getEligibleAssessmentOrNotFound(id, session.user.id);
  const submission = await getOrCreateSubmission(id, session.user.id);

  // Post-submission edit lock: once submitted, this page is no longer the
  // right place to be.
  if (submission.status !== "DRAFT") {
    redirect(`/student/results/${submission.id}`);
  }

  const responses = await prisma.questionResponse.findMany({
    where: { submissionId: submission.id },
  });
  const answerByQuestionId = new Map(
    responses.map((r) => [
      r.questionId,
      typeof r.studentAnswer === "object" &&
      r.studentAnswer !== null &&
      "text" in r.studentAnswer &&
      typeof (r.studentAnswer as { text: unknown }).text === "string"
        ? (r.studentAnswer as { text: string }).text
        : "",
    ]),
  );

  // "Answered" means a saved, non-empty answer — an empty saved response
  // shouldn't count towards progress.
  const answeredCount = assessment.questions.filter(
    (q) => (answerByQuestionId.get(q.id) ?? "").trim().length > 0,
  ).length;
  const totalQuestions = assessment.questions.length;
  const unansweredCount = totalQuestions - answeredCount;
  const progressPercent =
    totalQuestions === 0 ? 0 : Math.round((answeredCount / totalQuestions) * 100);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        breadcrumb={[
          { label: "Assessments", href: "/student/assessments" },
          { label: assessment.title, href: `/student/assessments/${assessment.id}` },
          { label: "Answering" },
        ]}
        title={assessment.title}
        description="Save each answer as you go. Nothing is submitted until you choose to submit."
      />

      {/* Progress — reflects saved answers only. */}
      <div className="sticky top-16 z-30 -mx-1 mb-6 rounded-xl border border-line bg-surface/95 p-4 backdrop-blur">
        <div className="flex items-center justify-between gap-4 text-sm">
          <span className="font-medium">
            {answeredCount} of {totalQuestions} answered
          </span>
          <span className="text-xs text-subtle">Saved answers only</span>
        </div>
        <div
          role="progressbar"
          aria-valuenow={answeredCount}
          aria-valuemin={0}
          aria-valuemax={totalQuestions}
          aria-label="Questions answered"
          className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted"
        >
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {assessment.questions.map((question) => (
          <AnswerForm
            key={question.id}
            submissionId={submission.id}
            questionId={question.id}
            questionNumber={question.questionNumber}
            questionText={question.questionText}
            maximumMarks={Number(question.maximumMarks)}
            initialAnswer={answerByQuestionId.get(question.id) ?? ""}
          />
        ))}
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-surface p-5">
        <div>
          <p className="text-sm font-medium">Ready to submit?</p>
          <p className="mt-1 text-sm text-muted">
            {unansweredCount > 0
              ? `${unansweredCount} question${unansweredCount === 1 ? "" : "s"} still without a saved answer.`
              : "All questions have a saved answer."}{" "}
            Submitting locks your answers and starts marking.
          </p>
        </div>
        <SubmitAssessmentButton
          submissionId={submission.id}
          unansweredCount={unansweredCount}
        />
      </div>
    </div>
  );
}
