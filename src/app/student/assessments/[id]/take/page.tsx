import { redirect } from "next/navigation";
import Link from "next/link";
import { requireStudentSession } from "@/lib/require-student";
import {
  getEligibleAssessmentOrNotFound,
  getOrCreateSubmission,
} from "@/lib/student-assessment-access";
import { prisma } from "@/lib/prisma";
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

  if (submission.status !== "DRAFT") {
    redirect("/student/results");
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

  const answeredCount = responses.length;
  const totalQuestions = assessment.questions.length;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-black/50 dark:text-white/50">
            <Link href={`/student/assessments/${id}`} className="hover:underline">
              {assessment.title}
            </Link>
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">
            Answer the questions
          </h1>
        </div>
        <span className="rounded bg-black/5 px-2.5 py-1 text-xs font-medium dark:bg-white/10">
          {answeredCount} / {totalQuestions} answered
        </span>
      </div>

      <div className="mt-6 flex flex-col gap-4">
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

      <div className="mt-8 flex items-center justify-between rounded-lg border border-black/10 p-4 dark:border-white/15">
        <div>
          <p className="text-sm font-medium">Ready to submit?</p>
          <p className="text-xs text-black/60 dark:text-white/60">
            {answeredCount < totalQuestions
              ? `${totalQuestions - answeredCount} question${totalQuestions - answeredCount === 1 ? "" : "s"} still unanswered.`
              : "All questions answered."}{" "}
            You won&apos;t be able to edit your answers after submitting.
          </p>
        </div>
        <SubmitAssessmentButton submissionId={submission.id} />
      </div>
    </div>
  );
}
