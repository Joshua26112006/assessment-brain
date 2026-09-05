import Link from "next/link";
import { requireStudentSession } from "@/lib/require-student";
import { getOwnedSubmissionOrNotFound } from "@/lib/student-assessment-access";
import { parseAnnotationResult, parseGradingResult } from "@/lib/pipeline/parseResults";
import type { AnnotationResult } from "@/types/pipeline";

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

  // Overall score is computed only from questions with a genuinely
  // confirmed (GRADED + outcome FINAL) grading result — a question that's
  // still pending, needs review, or failed is excluded from the sum rather
  // than counted as zero (Step 5: never silently treat missing as zero).
  let confirmedAwarded = 0;
  let confirmedMaximum = 0;
  let confirmedCount = 0;
  let pendingCount = 0;
  let needsReviewCount = 0;
  let failedCount = 0;

  for (const question of submission.assessment.questions) {
    const response = responseByQuestionId.get(question.id);
    if (!response) {
      pendingCount += 1;
      continue;
    }
    if (response.status === "FAILED") {
      failedCount += 1;
      continue;
    }
    if (response.status === "NEEDS_REVIEW") {
      needsReviewCount += 1;
      continue;
    }
    if (response.status !== "GRADED") {
      pendingCount += 1;
      continue;
    }
    const grading = parseGradingResult(response.gradingResult);
    if (!grading || grading.outcome !== "FINAL") {
      pendingCount += 1;
      continue;
    }
    confirmedAwarded += grading.awardedMarks;
    confirmedMaximum += grading.maximumMarks || Number(question.maximumMarks);
    confirmedCount += 1;
  }

  const totalQuestions = submission.assessment.questions.length;
  const allConfirmed = confirmedCount === totalQuestions;

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
        {submission.status === "PROCESSING" && (
          <p className="mt-2 text-xs text-black/50 dark:text-white/50">
            This can take a little while. Refresh this page to check for updates.
          </p>
        )}
      </div>

      {confirmedCount > 0 && (
        <div className="mt-4 rounded-lg border border-black/10 p-4 dark:border-white/15">
          <p className="text-xs font-medium uppercase tracking-wide text-black/50 dark:text-white/50">
            {allConfirmed ? "Overall score" : "Score so far"}
          </p>
          <p className="mt-1 text-lg font-semibold">
            {confirmedAwarded} / {confirmedMaximum} marks
          </p>
          {!allConfirmed && (
            <p className="mt-1 text-xs text-black/60 dark:text-white/60">
              Based on {confirmedCount} of {totalQuestions} question{totalQuestions === 1 ? "" : "s"} graded so far.{" "}
              {pendingCount > 0 && `${pendingCount} still being evaluated. `}
              {needsReviewCount > 0 && `${needsReviewCount} awaiting teacher review. `}
              {failedCount > 0 && `${failedCount} could not be evaluated. `}
            </p>
          )}
        </div>
      )}

      <section className="mt-6 flex flex-col gap-4">
        {submission.assessment.questions.map((question) => {
          const response = responseByQuestionId.get(question.id);
          return (
            <QuestionResultCard
              key={question.id}
              questionNumber={question.questionNumber}
              questionText={question.questionText}
              maximumMarks={Number(question.maximumMarks)}
              response={response}
            />
          );
        })}
      </section>
    </div>
  );
}

function QuestionResultCard({
  questionNumber,
  questionText,
  maximumMarks,
  response,
}: {
  questionNumber: number;
  questionText: string;
  maximumMarks: number;
  response:
    | {
        status: string;
        studentAnswer: unknown;
        gradingResult: unknown;
        annotationResult: unknown;
      }
    | undefined;
}) {
  return (
    <div className="rounded-lg border border-black/10 p-4 dark:border-white/15">
      <span className="text-xs font-medium text-black/50 dark:text-white/50">
        Question {questionNumber} &middot; {maximumMarks} marks
      </span>
      <p className="mt-1 text-sm">{questionText}</p>

      <div className="mt-3 rounded-md bg-black/[0.02] p-3 text-sm dark:bg-white/[0.03]">
        <p className="text-xs font-medium uppercase tracking-wide text-black/50 dark:text-white/50">
          Your answer
        </p>
        <p className="mt-1 whitespace-pre-wrap">
          {response ? getAnswerText(response.studentAnswer) || "(empty)" : "Not answered"}
        </p>
      </div>

      <div className="mt-2">{renderOutcome(response, maximumMarks)}</div>
    </div>
  );
}

/**
 * Renders exactly what the response's own persisted status supports —
 * never a grade for a NEEDS_REVIEW/FAILED/still-processing response, and
 * never trusting a JSON field's shape without checking it first (these
 * columns are untyped Json; a value that doesn't parse is treated the same
 * as no value at all, not displayed as if it were valid).
 */
function renderOutcome(
  response:
    | { status: string; gradingResult: unknown; annotationResult: unknown }
    | undefined,
  maximumMarks: number,
) {
  if (!response) {
    return (
      <p className="text-xs text-black/50 dark:text-white/50">Not answered.</p>
    );
  }

  if (response.status === "FAILED") {
    return (
      <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
        Evaluation could not be completed for this question. Your teacher has been notified.
      </p>
    );
  }

  if (response.status === "NEEDS_REVIEW") {
    return (
      <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
        This answer needs a closer look from your teacher before a final mark is given.
      </p>
    );
  }

  if (response.status !== "GRADED") {
    return (
      <p className="text-xs text-black/50 dark:text-white/50">
        Still being evaluated…
      </p>
    );
  }

  const grading = parseGradingResult(response.gradingResult);
  if (!grading || grading.outcome !== "FINAL") {
    // GRADED but the stored result doesn't actually parse as a final grade
    // (unexpected — treat defensively rather than guessing a score).
    return (
      <p className="text-xs text-black/50 dark:text-white/50">
        Result unavailable.
      </p>
    );
  }

  const annotation = parseAnnotationResult(response.annotationResult);

  return (
    <div className="rounded-md bg-green-50 p-3 text-sm dark:bg-green-950">
      <p className="text-xs font-medium uppercase tracking-wide text-green-800 dark:text-green-300">
        {grading.awardedMarks} / {grading.maximumMarks || maximumMarks} marks
      </p>
      {annotation && <FeedbackDetails annotation={annotation} />}
    </div>
  );
}

/**
 * Renders whatever genuinely persisted feedback is available for a GRADED
 * response — the deterministic per-checkpoint notes always exist, and the
 * AI-written summary/strengths/improvements (Phase 2.2's aiAnnotation) are
 * shown alongside them only when present. Never fabricated if missing.
 */
function FeedbackDetails({ annotation }: { annotation: AnnotationResult }) {
  const aiAnnotation = annotation.aiAnnotation;

  return (
    <div className="mt-2 flex flex-col gap-2">
      {aiAnnotation?.summary && (
        <p className="text-xs text-green-900 dark:text-green-200">{aiAnnotation.summary}</p>
      )}

      {aiAnnotation && aiAnnotation.strengths.length > 0 && (
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-green-800 dark:text-green-300">
            What went well
          </p>
          <ul className="mt-1 flex flex-col gap-0.5 text-xs text-green-900 dark:text-green-200">
            {aiAnnotation.strengths.map((s, i) => (
              <li key={i}>&bull; {s}</li>
            ))}
          </ul>
        </div>
      )}

      {aiAnnotation && aiAnnotation.improvements.length > 0 && (
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-green-800 dark:text-green-300">
            Could be improved
          </p>
          <ul className="mt-1 flex flex-col gap-0.5 text-xs text-green-900 dark:text-green-200">
            {aiAnnotation.improvements.map((s, i) => (
              <li key={i}>&bull; {s}</li>
            ))}
          </ul>
        </div>
      )}

      {annotation.entries.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-green-900 dark:text-green-200">
          {annotation.entries.map((entry) => (
            <li key={entry.checkpointIndex}>&bull; {entry.note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
