import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireStudentSession } from "@/lib/require-student";
import { getOwnedSubmissionOrNotFound } from "@/lib/student-assessment-access";
import { labelOf } from "@/lib/questions/labels";
import { parseAnnotationResult, parseGradingResult } from "@/lib/pipeline/parseResults";
import { describeEvaluationProgress, summarizeSubmissionScore } from "@/lib/submission-score";
import {
  AWAITING_RELEASE,
  aiFeedbackMayReachStudent,
  isReleasedForStudent,
  responsesVisibleToStudent,
  studentFacingStatus,
} from "@/lib/release";
import type { AnnotationResult } from "@/types/pipeline";
import { PageHeader, Card, Section } from "@/components/ui/Page";
import StatusBadge, { questionResponseBadge, submissionBadge } from "@/components/ui/StatusBadge";

const STATUS_COPY: Record<string, string> = {
  SUBMITTED: "Your assessment has been submitted and is waiting to be marked.",
  PROCESSING: "Your answers are being marked right now.",
  COMPLETED: "Marking is complete — your results are below.",
  NEEDS_REVIEW: "Your teacher is checking part of this submission before it's final.",
  FAILED: "Something went wrong while marking part of this. Your teacher has been notified.",
  [AWAITING_RELEASE]: "Your teacher is reviewing your marks. They will appear here as soon as they are released.",
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

  // Nothing about a mark, a finding or a marked-up page reaches the student
  // until a teacher has released this submission (src/lib/release.ts).
  const released = isReleasedForStudent(submission);
  const responses = responsesVisibleToStudent(submission, submission.questionResponses);
  const visibleStatus = studentFacingStatus(submission);

  const responseByQuestionId = new Map(responses.map((r) => [r.questionId, r]));

  // Only pages that actually carry marks — a submission whose sheet was never
  // annotated simply doesn't show this section, rather than showing the
  // student their unmarked upload back under a "marked" heading.
  const annotatedPages = released
    ? await prisma.answerSheetPage.findMany({
        where: { submissionId, annotatedStorageKey: { not: null } },
        orderBy: { pageNumber: "asc" },
        select: { id: true, pageNumber: true },
      })
    : [];

  // Score is derived by the shared summarizer, so the list page, this page
  // and the teacher's submissions view can never disagree about what a
  // submission currently scores. Its rule: only fully-marked questions count;
  // everything else is reported separately, never counted as zero.
  const summary = summarizeSubmissionScore(submission.assessment.questions, responses, submission.assessment.questionTree);
  const badge = submissionBadge(visibleStatus, "student");

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        breadcrumb={[
          { label: "Results", href: "/student/results" },
          { label: submission.assessment.title },
        ]}
        title={submission.assessment.title}
        description={STATUS_COPY[visibleStatus] ?? `Status: ${visibleStatus}`}
        meta={<StatusBadge label={badge.label} tone={badge.tone} />}
      />

      {/* Overall score — only ever counts questions that are genuinely marked. */}
      {!released && (
        <Card className="mb-8">
          <p className="text-sm text-muted">
            Your answers are below. Marks and feedback are not shown yet — your teacher releases them
            after checking.
          </p>
        </Card>
      )}
      {released && (
      <Card className="mb-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              {summary.allConfirmed ? "Overall score" : "Score so far"}
            </p>
            {summary.hasAnyConfirmed ? (
              <p className="mt-2 text-4xl font-semibold tabular-nums">
                {summary.awardedMarks}
                <span className="text-2xl text-subtle"> / {summary.confirmedMaximumMarks}</span>
              </p>
            ) : (
              <p className="mt-2 text-sm text-muted">No marks are available yet.</p>
            )}
            <p className="mt-2 text-sm text-muted">
              {describeEvaluationProgress(summary)}
              {summary.teacherReviewedCount > 0 &&
                ` ${summary.teacherReviewedCount} checked by your teacher.`}
            </p>
          </div>

          {summary.totalQuestions > 0 && (
            <dl className="flex gap-5 text-sm">
              <div>
                <dt className="text-xs text-subtle">Marked</dt>
                <dd className="mt-0.5 font-semibold tabular-nums">
                  {summary.confirmedCount}/{summary.totalQuestions}
                </dd>
              </div>
              {summary.needsReviewCount > 0 && (
                <div>
                  <dt className="text-xs text-subtle">With teacher</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums text-warning">
                    {summary.needsReviewCount}
                  </dd>
                </div>
              )}
              {summary.pendingCount > 0 && (
                <div>
                  <dt className="text-xs text-subtle">In progress</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums">{summary.pendingCount}</dd>
                </div>
              )}
            </dl>
          )}
        </div>

        {!summary.allConfirmed && summary.hasAnyConfirmed && (
          <p className="mt-4 border-t border-line pt-3 text-xs text-subtle">
            Questions still being marked or waiting on your teacher are not included in this total —
            they are not counted as zero.
          </p>
        )}
      </Card>
      )}

      {annotatedPages.length > 0 && (
        <Section
          className="mb-8"
          title="Your marked answer sheet"
          description="Your own pages, with the marks and any mistakes shown where they were made."
        >
          <div className="flex flex-col gap-4">
            {annotatedPages.map((page) => (
              <figure key={page.id} className="overflow-hidden rounded-xl border border-line bg-surface">
                {/* eslint-disable-next-line @next/next/no-img-element -- served from an auth-scoped route, not a static/optimizable asset */}
                <img
                  src={`/api/student/submissions/${submissionId}/answer-sheets/${page.id}?annotated=1`}
                  alt={`Page ${page.pageNumber} of your answer sheet, with your teacher's marks`}
                  className="w-full"
                />
                <figcaption className="border-t border-line px-4 py-2 text-xs text-subtle">
                  Page {page.pageNumber}
                </figcaption>
              </figure>
            ))}
          </div>
        </Section>
      )}

      <Section title="Your answers">
        <div className="flex flex-col gap-4">
          {submission.assessment.questions.map((question) => {
            const response = responseByQuestionId.get(question.id);
            const overAttempt = summary.questions.find((item) => item.questionId === question.id)?.overAttempt === true;
            return (
              <QuestionResultCard
                key={question.id}
                label={labelOf(question)}
                overAttempt={overAttempt}
                awaitingRelease={visibleStatus === AWAITING_RELEASE}
                questionText={question.questionText}
                maximumMarks={Number(question.maximumMarks)}
                response={response}
              />
            );
          })}
        </div>
      </Section>

      <div className="mt-8">
        <Link href="/student/results" className="text-sm font-medium text-accent-text hover:underline">
          &larr; All results
        </Link>
      </div>
    </div>
  );
}

function QuestionResultCard({
  label,
  overAttempt,
  awaitingRelease,
  questionText,
  maximumMarks,
  response,
}: {
  label: string;
  /** The teacher has not released this submission yet: nothing about this answer is shown but that it is theirs to mark. */
  awaitingRelease: boolean;
  /** Answered, but a better alternative counts instead: shown with a * and left out of the total. */
  overAttempt: boolean;
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
  const grading = response ? parseGradingResult(response.gradingResult) : null;
  const isMarked = response?.status === "GRADED" && grading?.outcome === "FINAL";
  const badge = awaitingRelease
    ? response
      ? { label: "With your teacher", tone: "info" as const }
      : { label: "Not answered", tone: "neutral" as const }
    : response
    ? questionResponseBadge(response.status, "student")
    : { label: "Not answered", tone: "neutral" as const };

  return (
    <article className="rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line p-5">
        <div className="min-w-0">
          <span className="text-xs font-medium text-subtle">
            Question {label} · {maximumMarks} {Number(maximumMarks) === 1 ? "mark" : "marks"}
          </span>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{questionText}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {isMarked && grading && (
            <p className="text-xl font-semibold tabular-nums">
              {grading.awardedMarks}
              {overAttempt && <span aria-label="over attempt">*</span>}
              <span className="text-sm text-subtle"> / {grading.maximumMarks || maximumMarks}</span>
            </p>
          )}
          <StatusBadge label={badge.label} tone={badge.tone} size="sm" />
        </div>
      </div>

      <div className="p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Your answer</p>
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">
          {response
            ? getAnswerText(response.studentAnswer) || (
                <span className="italic text-subtle">You left this blank.</span>
              )
            : <span className="italic text-subtle">You didn&apos;t answer this question.</span>}
        </p>

        {overAttempt && (
          <p className="mt-3 text-xs text-muted">
            * You answered more of this question than was needed. This answer was marked, but a better one counts
            towards your total, so these marks are not added.
          </p>
        )}

        <div className="mt-4">{awaitingRelease ? renderAwaitingRelease(response) : renderOutcome(response)}</div>
      </div>
    </article>
  );
}

/** Before release: the same line for every answer, whatever its marking status, so nothing leaks early. */
function renderAwaitingRelease(response: unknown) {
  if (!response) return null;
  return (
    <p className="rounded-lg border border-line bg-surface-muted p-3 text-sm text-muted">
      Your teacher is reviewing this answer. The mark will appear here when they release your results.
    </p>
  );
}

/**
 * Renders exactly what the response's own persisted status supports — never a
 * mark for a needs-review/failed/still-processing response, and never trusting
 * a JSON field's shape without checking it first (these columns are untyped
 * Json; a value that doesn't parse is treated the same as no value at all).
 */
function renderOutcome(
  response:
    | { status: string; gradingResult: unknown; annotationResult: unknown }
    | undefined,
) {
  if (!response) {
    return null;
  }

  if (response.status === "FAILED") {
    return (
      <p className="rounded-lg border border-danger-line bg-danger-soft p-3 text-sm text-danger">
        This answer couldn&apos;t be marked automatically. Your teacher has been notified and will
        mark it.
      </p>
    );
  }

  if (response.status === "NEEDS_REVIEW") {
    return (
      <p className="rounded-lg border border-warning-line bg-warning-soft p-3 text-sm text-warning">
        Your teacher is checking this answer before the mark is final.
      </p>
    );
  }

  if (response.status !== "GRADED") {
    return (
      <p className="rounded-lg border border-line bg-surface-muted p-3 text-sm text-muted">
        This answer is still being marked.
      </p>
    );
  }

  const grading = parseGradingResult(response.gradingResult);
  if (!grading || grading.outcome !== "FINAL") {
    // GRADED but the stored result doesn't actually parse as a final mark
    // (unexpected — treat defensively rather than guessing a score).
    return (
      <p className="rounded-lg border border-line bg-surface-muted p-3 text-sm text-muted">
        The result for this question isn&apos;t available.
      </p>
    );
  }

  const annotation = parseAnnotationResult(response.annotationResult);
  if (!annotation) return null;

  return <FeedbackDetails annotation={annotation} showAiText={aiFeedbackMayReachStudent(grading)} />;
}

/**
 * Whatever genuinely persisted feedback exists for a marked response — the
 * teacher's own note first, then the generated summary and per-checkpoint
 * notes. Nothing here is fabricated when a section is missing.
 */
function FeedbackDetails({ annotation, showAiText }: { annotation: AnnotationResult; showAiText: boolean }) {
  // Once the teacher has changed the mark, the AI's wording (written for the old mark) is not shown.
  const aiAnnotation = showAiText ? annotation.aiAnnotation : undefined;
  const teacherFeedback = annotation.teacherFeedback;

  return (
    <div className="flex flex-col gap-4">
      {teacherFeedback?.note && (
        <div className="rounded-lg border border-success-line bg-success-soft p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-success">
            From your teacher
          </p>
          <p className="mt-1.5 text-sm text-foreground">{teacherFeedback.note}</p>
        </div>
      )}

      {aiAnnotation?.summary && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Feedback</p>
          <p className="mt-1.5 text-sm leading-relaxed">{aiAnnotation.summary}</p>
        </div>
      )}

      {aiAnnotation && aiAnnotation.strengths.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-success">
            What went well
          </p>
          <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-5 text-sm text-muted">
            {aiAnnotation.strengths.map((strength, index) => (
              <li key={index}>{strength}</li>
            ))}
          </ul>
        </div>
      )}

      {showAiText && annotation.entries.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-wide text-muted">
            How this was marked
            <span className="ml-2 font-normal normal-case text-accent-text group-open:hidden">
              show
            </span>
            <span className="ml-2 hidden font-normal normal-case text-accent-text group-open:inline">
              hide
            </span>
          </summary>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-muted">
            {annotation.entries.map((entry) => (
              <li key={entry.checkpointIndex}>• {entry.note}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
