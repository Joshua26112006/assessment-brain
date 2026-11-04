import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireTeacherSession } from "@/lib/require-teacher";
import { getOwnedAssessmentOrNotFound } from "@/lib/assessment-ownership";
import { loadSubmissionReview, type ReviewAnswerRow } from "@/lib/assessment/markRelease";
import { parseAnnotationResult, parseGradingResult } from "@/lib/pipeline/parseResults";
import { roundMarks } from "@/lib/assessment/markReview";
import { PageHeader, Card, Section, ScoreDisplay } from "@/components/ui/Page";
import StatusBadge, { type BadgeTone } from "@/components/ui/StatusBadge";
import AnswerReviewForm from "./AnswerReviewForm";
import SubmissionControls, { type SubmissionStage } from "./SubmissionControls";
import FindingToggle from "./FindingToggle";

export const metadata = { title: "Review marks" };

const LEVEL_BADGE: Record<ReviewAnswerRow["attention"]["level"], { label: string; tone: BadgeTone }> = {
  SURE: { label: "Sure", tone: "success" },
  UNSURE: { label: "Check this", tone: "warning" },
  CANNOT_READ: { label: "Needs a mark", tone: "danger" },
};

const EVENT_LABEL: Record<string, string> = {
  TEACHER_ACCEPT: "accepted the mark",
  TEACHER_CHANGE: "changed the mark",
  TEACHER_COMMENT: "edited a comment",
  SUBMISSION_CONFIRMED: "confirmed the marks",
  SUBMISSION_RELEASED: "released the marks to the student",
  SUBMISSION_REOPENED: "reopened the submission",
};

/**
 * Where a teacher decides, answer by answer, what a student is told — and the
 * only place a submission is confirmed and released to them. Nothing the AI
 * produced reaches the student until it has passed through here.
 *
 * Ownership is established once by getOwnedAssessmentOrNotFound; the submission
 * is then looked up scoped to that already-verified assessment, so another
 * teacher's submission cannot be reached by editing the URL.
 */
export default async function ReviewSubmissionPage({
  params,
}: {
  params: Promise<{ id: string; submissionId: string }>;
}) {
  const { id, submissionId } = await params;
  const session = await requireTeacherSession();
  const assessment = await getOwnedAssessmentOrNotFound(id, session.user.id);

  const submission = await prisma.submission.findFirst({
    where: { id: submissionId, assessmentId: assessment.id },
    select: {
      id: true,
      status: true,
      confirmedAt: true,
      releasedAt: true,
      student: { select: { name: true } },
      confirmedBy: { select: { name: true } },
      releasedBy: { select: { name: true } },
      answerSheetPages: { orderBy: { pageNumber: "asc" }, select: { id: true, pageNumber: true } },
    },
  });
  if (!submission) notFound();

  const [rows, events] = await Promise.all([
    loadSubmissionReview(prisma, submission.id, assessment.id),
    prisma.markEvent.findMany({
      where: { submissionId: submission.id },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: {
        id: true,
        kind: true,
        marks: true,
        previousMarks: true,
        reason: true,
        createdAt: true,
        actor: { select: { name: true } },
        questionResponse: { select: { question: { select: { questionNumber: true } } } },
      },
    }),
  ]);

  const stage: SubmissionStage = submission.releasedAt ? "RELEASED" : submission.confirmedAt ? "CONFIRMED" : "REVIEWING";
  const locked = stage !== "REVIEWING";

  const awarded = roundMarks(rows.reduce((sum, row) => sum + (row.response?.awardedMarks ?? 0), 0));
  const maximum = roundMarks(rows.reduce((sum, row) => sum + row.maximumMarks, 0));
  const needAttention = rows.filter((row) => row.response && !row.attention.reviewed && row.attention.level !== "SURE").length;
  const sureLeft = rows.filter(
    (row) => row.response && !row.attention.reviewed && row.attention.level === "SURE" && !row.attention.needsMark,
  ).length;
  const notAnswered = rows.filter((row) => row.response === null).length;

  const stageBadge =
    stage === "RELEASED"
      ? { label: "Released to student", tone: "success" as const }
      : stage === "CONFIRMED"
        ? { label: "Confirmed — not released", tone: "info" as const }
        : { label: "Awaiting your review", tone: "warning" as const };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        breadcrumb={[
          { label: "Assessments", href: "/teacher/assessments" },
          { label: assessment.title, href: `/teacher/assessments/${assessment.id}` },
          { label: "Submissions", href: `/teacher/assessments/${assessment.id}/submissions` },
          { label: submission.student.name },
        ]}
        title={`Review marks — ${submission.student.name}`}
        description={`${assessment.subject} · ${assessment.grade} · ${assessment.title}`}
        meta={<StatusBadge label={stageBadge.label} tone={stageBadge.tone} />}
      />

      <Card className="mb-8">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted">
              {stage === "RELEASED"
                ? `Released${submission.releasedBy ? ` by ${submission.releasedBy.name}` : ""} on ${submission.releasedAt?.toLocaleString()}. The student can see these marks.`
                : stage === "CONFIRMED"
                  ? `Confirmed${submission.confirmedBy ? ` by ${submission.confirmedBy.name}` : ""}. The student cannot see anything until you release it.`
                  : "The student sees nothing until you confirm these marks and release them."}
            </p>
            {stage === "REVIEWING" && (
              <p className="mt-2 text-xs text-subtle">
                {needAttention > 0
                  ? `${needAttention} answer${needAttention === 1 ? " needs" : "s need"} your attention first. `
                  : "No answer is flagged. "}
                {notAnswered > 0 &&
                  `${notAnswered} question${notAnswered === 1 ? " was" : "s were"} not answered and will be recorded as 0.`}
              </p>
            )}
            <div className="mt-4">
              <SubmissionControls submissionId={submission.id} stage={stage} sureLeft={sureLeft} />
            </div>
          </div>
          <ScoreDisplay awarded={awarded} maximum={maximum} pending={stage === "REVIEWING"} size="lg" />
        </div>
      </Card>

      <Section title="Answers">
        <div className="flex flex-col gap-4">
          {rows.map((row) => (
            <AnswerCard key={row.questionId} row={row} submissionId={submission.id} locked={locked} />
          ))}
        </div>
      </Section>

      {submission.answerSheetPages.length > 0 && (
        <Section
          className="mt-10"
          title="Original answer sheet"
          description="The student's own pages, exactly as uploaded."
        >
          <div className="flex flex-col gap-4">
            {submission.answerSheetPages.map((page) => (
              <figure key={page.id} className="overflow-hidden rounded-xl border border-line bg-surface">
                {/* eslint-disable-next-line @next/next/no-img-element -- served from an auth-scoped route, not a static/optimizable asset */}
                <img
                  src={`/api/teacher/submissions/${submission.id}/answer-sheets/${page.id}`}
                  alt={`Page ${page.pageNumber} of ${submission.student.name}'s answer sheet`}
                  className="w-full"
                />
                <figcaption className="border-t border-line px-4 py-2 text-xs text-subtle">Page {page.pageNumber}</figcaption>
              </figure>
            ))}
          </div>
        </Section>
      )}

      <Section className="mt-10" title="History" description="Every change to these marks, newest first.">
        {events.length === 0 ? (
          <p className="text-sm text-muted">Nothing has been changed yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface text-sm">
            {events.map((event) => {
              const questionNumber = event.questionResponse?.question.questionNumber;
              return (
                <li key={event.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5">
                  <span>
                    <span className="font-medium">{event.actor?.name ?? "The system"}</span>{" "}
                    {EVENT_LABEL[event.kind] ?? event.kind.toLowerCase()}
                    {questionNumber !== undefined && ` on question ${questionNumber}`}
                    {event.kind === "TEACHER_CHANGE" && event.marks !== null && (
                      <>
                        {" "}
                        ({event.previousMarks !== null ? `${Number(event.previousMarks)} → ` : ""}
                        {Number(event.marks)})
                      </>
                    )}
                    {event.reason && <span className="text-muted"> — {event.reason}</span>}
                  </span>
                  <time className="text-xs text-subtle" dateTime={event.createdAt.toISOString()}>
                    {event.createdAt.toLocaleString()}
                  </time>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}

function AnswerCard({ row, submissionId, locked }: { row: ReviewAnswerRow; submissionId: string; locked: boolean }) {
  const { response, attention } = row;
  const badge = response ? LEVEL_BADGE[attention.level] : { label: "Not answered", tone: "neutral" as const };
  const grading = response ? parseGradingResult(response.gradingResult) : null;
  const annotation = response ? parseAnnotationResult(response.annotationResult) : null;
  const aiFeedback = annotation?.aiAnnotation?.summary ?? "";
  const note = annotation?.teacherFeedback?.note ?? "";

  return (
    <article className="rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line p-5">
        <div className="min-w-0">
          <span className="text-xs font-medium text-subtle">
            Question {row.questionNumber} · {row.maximumMarks} marks
          </span>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{row.questionText}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {response?.awardedMarks != null && (
            <p className="text-xl font-semibold tabular-nums">
              {response.awardedMarks}
              <span className="text-sm text-subtle"> / {row.maximumMarks}</span>
            </p>
          )}
          <StatusBadge label={badge.label} tone={badge.tone} size="sm" />
          {attention.reviewed && <StatusBadge label="Checked" tone="success" size="sm" />}
        </div>
      </div>

      <div className="flex flex-col gap-4 p-5">
        {response === null ? (
          <p className="text-sm italic text-subtle">The student did not answer this question. It will be recorded as 0 when you confirm.</p>
        ) : (
          <>
            {attention.reasons.length > 0 && (
              <ul className="rounded-lg border border-warning-line bg-warning-soft p-3 text-sm text-warning">
                {attention.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">What the student wrote</p>
              <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">
                {response.studentAnswerText || <span className="italic text-subtle">Nothing was read for this answer.</span>}
              </p>
            </div>

            {aiFeedback && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Why it was marked this way (AI draft)</p>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{aiFeedback}</p>
              </div>
            )}

            {response.findings.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Possible mistakes the AI found
                </p>
                <p className="mt-1 text-xs text-subtle">
                  These are suggestions. Only the ones you keep are circled on the student&apos;s marked copy.
                </p>
                <ul className="mt-2 flex flex-col gap-2">
                  {response.findings.map((finding) => (
                    <FindingToggle
                      key={finding.id}
                      submissionId={submissionId}
                      responseId={response.id}
                      findingId={finding.id}
                      explanation={finding.explanation}
                      wrongText={finding.wrongText}
                      kept={finding.kept}
                      locked={locked}
                    />
                  ))}
                </ul>
              </div>
            )}

            {grading?.teacherReview && (
              <p className="text-xs text-subtle">
                {grading.teacherReview.action === "OVERRIDDEN"
                  ? `Mark changed by you${grading.teacherReview.previousAwardedMarks !== null ? ` (was ${grading.teacherReview.previousAwardedMarks})` : ""}.`
                  : "Draft mark accepted."}
              </p>
            )}

            <AnswerReviewForm
              submissionId={submissionId}
              responseId={response.id}
              maximumMarks={row.maximumMarks}
              draftMarks={attention.needsMark ? null : response.awardedMarks}
              reviewed={attention.reviewed}
              locked={locked}
              existingNote={note}
            />
          </>
        )}
      </div>
    </article>
  );
}
