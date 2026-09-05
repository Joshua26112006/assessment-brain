import Link from "next/link";
import { requireStudentSession } from "@/lib/require-student";
import { getOwnedSubmissionOrNotFound } from "@/lib/student-assessment-access";

const STATUS_COPY: Record<string, string> = {
  SUBMITTED: "Your assessment has been submitted and is awaiting evaluation.",
  PROCESSING: "Your assessment is currently being evaluated.",
  COMPLETED: "Evaluation is complete — results are below.",
  NEEDS_REVIEW: "Your teacher is reviewing part of this submission.",
  FAILED: "Something went wrong during evaluation. Your teacher has been notified.",
};

function getAnswerText(studentAnswer: unknown): string {
  if (
    typeof studentAnswer === "object" &&
    studentAnswer !== null &&
    "text" in studentAnswer &&
    typeof (studentAnswer as { text: unknown }).text === "string"
  ) {
    return (studentAnswer as { text: string }).text;
  }
  return "";
}

export default async function SubmissionResultPage({
  params,
}: {
  params: Promise<{ submissionId: string }>;
}) {
  const { submissionId } = await params;
  const session = await requireStudentSession();
  const submission = await getOwnedSubmissionOrNotFound(submissionId, session.user.id);

  const responseByQuestionId = new Map(
    submission.questionResponses.map((r) => [r.questionId, r]),
  );

  return (
    <div className="mx-auto max-w-2xl">
      <p className="text-sm text-black/50 dark:text-white/50">
        <Link href="/student/results" className="hover:underline">
          Results
        </Link>{" "}
        / {submission.assessment.title}
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">
        {submission.assessment.title}
      </h1>

      <div className="mt-4 rounded-lg border border-black/10 p-4 dark:border-white/15">
        <span className="rounded bg-black/5 px-2 py-0.5 text-xs uppercase tracking-wide dark:bg-white/10">
          {submission.status}
        </span>
        <p className="mt-2 text-sm text-black/70 dark:text-white/70">
          {STATUS_COPY[submission.status] ?? `Status: ${submission.status}`}
        </p>
      </div>

      <section className="mt-6 flex flex-col gap-4">
        {submission.assessment.questions.map((question) => {
          const response = responseByQuestionId.get(question.id);
          return (
            <div
              key={question.id}
              className="rounded-lg border border-black/10 p-4 dark:border-white/15"
            >
              <span className="text-xs font-medium text-black/50 dark:text-white/50">
                Question {question.questionNumber} &middot;{" "}
                {Number(question.maximumMarks)} marks
              </span>
              <p className="mt-1 text-sm">{question.questionText}</p>

              <div className="mt-3 rounded-md bg-black/[0.02] p-3 text-sm dark:bg-white/[0.03]">
                <p className="text-xs font-medium uppercase tracking-wide text-black/50 dark:text-white/50">
                  Your answer
                </p>
                <p className="mt-1 whitespace-pre-wrap">
                  {response ? getAnswerText(response.studentAnswer) || "(empty)" : "Not answered"}
                </p>
              </div>

              {response?.gradingResult ? (
                <div className="mt-2 rounded-md bg-green-50 p-3 text-sm dark:bg-green-950">
                  <p className="text-xs font-medium uppercase tracking-wide text-green-800 dark:text-green-300">
                    Grading result
                  </p>
                  <pre className="mt-1 whitespace-pre-wrap text-xs">
                    {JSON.stringify(response.gradingResult, null, 2)}
                  </pre>
                </div>
              ) : (
                <p className="mt-2 text-xs text-black/50 dark:text-white/50">
                  Grading not available yet.
                </p>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}
