import Link from "next/link";
import { requireTeacherSession } from "@/lib/require-teacher";
import { getOwnedReviewItemOrNotFound } from "@/lib/review-access";
import {
  countOtherOpenReviewItems,
  isActionableReviewStatus,
  parseReviewDecision,
} from "@/lib/review-scope";
import { isAwaitingMark } from "@/lib/assessment/reviewResolution";
import { prisma } from "@/lib/prisma";
import {
  parseAnnotationResult,
  parseCorrectionResult,
  parseGradingResult,
} from "@/lib/pipeline/parseResults";
import type { CheckpointCorrectionResult } from "@/types/pipeline";
import { PageHeader, Card } from "@/components/ui/Page";
import { buttonClass } from "@/components/ui/styles";
import StatusBadge, {
  EVIDENCE_SOURCE_DESCRIPTION,
  REVIEW_REASON_DESCRIPTION,
  evidenceSourceBadge,
  questionResponseBadge,
  reviewItemBadge,
  reviewReasonBadge,
  type BadgeTone,
} from "@/components/ui/StatusBadge";
import ReviewDecisionForm from "./ReviewDecisionForm";

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

/** Teacher-authored rubric shapes (see the rubric editor) — read defensively; these are untyped Json. */
function readCheckpoints(raw: unknown): { description: string; marks: number }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      description: typeof item.description === "string" ? item.description : "",
      marks: Number(item.marks),
    }))
    .filter((item) => item.description);
}

function readApproaches(raw: unknown): { label: string; description: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      label: typeof item.label === "string" ? item.label : "",
      description: typeof item.description === "string" ? item.description : "",
    }))
    .filter((item) => item.label || item.description);
}

/** Defensive reader for NovelApproachCandidate.approachData (untyped Json). */
function readNovelApproach(raw: unknown): {
  bestMatchApproachLabel: string | null;
  overlapRatio: number | null;
  confidenceLevel: string | null;
  aiSummary: string | null;
  aiReasoning: string | null;
} | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const confidence = record.confidence as Record<string, unknown> | undefined;
  const ai = record.aiAssistance as Record<string, unknown> | undefined;

  return {
    bestMatchApproachLabel:
      typeof record.bestMatchApproachLabel === "string" ? record.bestMatchApproachLabel : null,
    overlapRatio:
      typeof record.bestMatchOverlapRatio === "number" ? record.bestMatchOverlapRatio : null,
    confidenceLevel: typeof confidence?.level === "string" ? confidence.level : null,
    aiSummary: typeof ai?.approachSummary === "string" ? ai.approachSummary : null,
    aiReasoning: typeof ai?.reasoning === "string" ? ai.reasoning : null,
  };
}

const AGREEMENT_DISPLAY: Record<string, { label: string; tone: BadgeTone }> = {
  agree: { label: "Agreed", tone: "success" },
  partial: { label: "Partly disagreed", tone: "warning" },
  disagree: { label: "Disagreed", tone: "danger" },
  ai_unavailable: { label: "No second opinion", tone: "neutral" },
};

const OUTCOME_TONE: Record<string, BadgeTone> = {
  SATISFIED: "success",
  PARTIALLY_SATISFIED: "warning",
  NOT_SATISFIED: "neutral",
};

function humanize(value: string): string {
  const spaced = value.replaceAll("_", " ").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** A titled block of evidence inside the review workspace. */
function Evidence({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
      {hint && <p className="mt-1 text-xs text-subtle">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default async function ReviewItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireTeacherSession();
  const item = await getOwnedReviewItemOrNotFound(id, session.user.id);

  const response = item.questionResponse;
  const assessment = item.assessment ?? item.submission?.assessment ?? null;
  const student = item.submission?.student ?? null;
  const question = item.question;
  const maximumMarks = question ? Number(question.maximumMarks) : 0;

  const correction = parseCorrectionResult(response?.correctionResult);
  const annotation = parseAnnotationResult(response?.annotationResult);
  const grading = parseGradingResult(response?.gradingResult);
  const decision = parseReviewDecision(item.decision);

  const isOpen = isActionableReviewStatus(item.status);
  const canConfirm = Boolean(response && grading);
  const canDismiss = !response || !isAwaitingMark(response.status);

  const otherOpen = response
    ? await countOtherOpenReviewItems(prisma, response.id, item.id)
    : 0;

  // Queried here rather than widened into review-access.ts's select, which
  // deliberately exposes no storage keys — only which pages have a marked-up
  // copy is needed, never where it lives.
  const annotatedPageIds = new Set(
    item.submission
      ? (
          await prisma.answerSheetPage.findMany({
            where: { submissionId: item.submission.id, annotatedStorageKey: { not: null } },
            select: { id: true },
          })
        ).map((page) => page.id)
      : [],
  );

  // Novel-approach candidates are a real, separately-reviewable record the
  // pipeline creates; show them when they exist and never invent one when
  // they don't. Scoped by the response id already proven to belong to this
  // teacher's assessment.
  const novelCandidates = response
    ? await prisma.novelApproachCandidate.findMany({
        where: { questionResponseId: response.id },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, approachData: true, createdAt: true, rubricVersionId: true },
      })
    : [];

  // Only deterministic stages write these; AI provider errors are recorded in
  // per-run stage executions, which are never persisted, so nothing here can
  // leak provider internals.
  const pipelineWarnings = [
    ...(correction?.warnings ?? []).map((w) => ({ stage: "Correction", message: w })),
    ...(annotation?.warnings ?? []).map((w) => ({ stage: "Annotation", message: w })),
    ...(grading?.warnings ?? []).map((w) => ({ stage: "Grading", message: w })),
  ];

  // Checkpoints actually used for the mark (verification-resolved where the
  // pipeline had them), falling back to the raw deterministic results.
  const checkpointResults: CheckpointCorrectionResult[] =
    correction?.resolvedCheckpointResults ?? correction?.checkpointResults ?? [];

  const rubricVersion = response?.rubricVersionUsed ?? null;
  const rubricCheckpoints = readCheckpoints(rubricVersion?.markingCheckpoints);
  const rubricApproaches = readApproaches(rubricVersion?.solutionApproaches);

  const reasonBadge = reviewReasonBadge(item.reason);
  const statusBadge = reviewItemBadge(item.status);
  const evidenceBadge = grading ? evidenceSourceBadge(grading.evidenceSource) : null;
  const answerText = response ? getAnswerText(response.studentAnswer) : "";

  return (
    <div>
      <PageHeader
        breadcrumb={[
          { label: "Review queue", href: "/teacher/review-queue" },
          { label: student?.name ?? "Review item" },
        ]}
        title={REVIEW_REASON_DESCRIPTION[item.reason] ?? "Flagged for your review"}
        description={
          <>
            {student?.name ?? "Unknown student"}
            {question ? ` · Question ${question.questionNumber} · ${maximumMarks} marks` : ""}
            {assessment ? ` · ${assessment.title}` : ""}
          </>
        }
        meta={
          <>
            <StatusBadge label={reasonBadge.label} tone={reasonBadge.tone} />
            <StatusBadge label={statusBadge.label} tone={statusBadge.tone} />
            {response && (
              <StatusBadge
                label={questionResponseBadge(response.status).label}
                tone={questionResponseBadge(response.status).tone}
              />
            )}
          </>
        }
        actions={
          assessment && (
            <Link
              href={`/teacher/assessments/${assessment.id}/submissions`}
              className="text-sm font-medium text-accent-text hover:underline"
            >
              All submissions &rarr;
            </Link>
          )
        }
      />

      {!isOpen && (
        <Card tone="muted" className="mb-6">
          <p className="text-sm font-medium">This review has already been resolved.</p>
          {decision && (
            <p className="mt-1 text-sm text-muted">
              {decision.action === "OVERRIDDEN" && decision.awardedMarks !== null
                ? `Mark overridden to ${decision.awardedMarks} / ${maximumMarks}`
                : decision.action === "CONFIRMED"
                  ? `Evaluated mark confirmed${
                      decision.awardedMarks !== null
                        ? ` (${decision.awardedMarks} / ${maximumMarks})`
                        : ""
                    }`
                  : "Flag dismissed without changing the mark"}
              {item.reviewer?.name ? ` by ${item.reviewer.name}` : ""}
              {" · "}
              {new Date(decision.decidedAt).toLocaleString()}
            </p>
          )}
          {decision?.feedbackNote && (
            <p className="mt-2 text-sm text-muted">
              Feedback given: &ldquo;{decision.feedbackNote}&rdquo;
            </p>
          )}
        </Card>
      )}

      {otherOpen > 0 && (
        <Card tone="warning" className="mb-6">
          <p className="text-sm">
            This response has {otherOpen} other open review {otherOpen === 1 ? "flag" : "flags"}.
            Resolving this one won&apos;t close {otherOpen === 1 ? "it" : "them"}.
          </p>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ---------------- Evidence ---------------- */}
        <div className="flex flex-col gap-4 lg:col-span-2">
          {item.submission && item.submission.answerSheetPages.length > 0 && (
            <Evidence
              title="Answer sheet pages"
              hint="The original handwritten pages this submission was read from."
            >
              <ul className="flex flex-wrap gap-2">
                {item.submission.answerSheetPages.map((page) => (
                  <li key={page.id} className="flex gap-2">
                    <a
                      href={`/api/teacher/submissions/${item.submission!.id}/answer-sheets/${page.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={buttonClass("secondary", "sm")}
                    >
                      View page {page.pageNumber}
                    </a>
                    {annotatedPageIds.has(page.id) && (
                      <a
                        href={`/api/teacher/submissions/${item.submission!.id}/answer-sheets/${page.id}?annotated=1`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={buttonClass("secondary", "sm")}
                      >
                        Marked
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </Evidence>
          )}

          {question && (
            <Evidence title="Question">
              <p className="whitespace-pre-wrap text-sm leading-relaxed">
                {question.questionText}
              </p>
            </Evidence>
          )}

          <Evidence title="Student's answer">
            {response ? (
              answerText ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{answerText}</p>
              ) : (
                <p className="text-sm italic text-subtle">
                  The student left this answer blank.
                </p>
              )
            ) : (
              <p className="text-sm italic text-subtle">No response recorded.</p>
            )}
          </Evidence>

          <Evidence
            title="Evaluation outcome"
            hint={
              grading && evidenceBadge
                ? EVIDENCE_SOURCE_DESCRIPTION[grading.evidenceSource]
                : undefined
            }
          >
            {grading ? (
              <div className="flex flex-wrap items-center gap-4">
                <p className="text-2xl font-semibold tabular-nums">
                  {grading.awardedMarks}
                  <span className="text-subtle"> / {grading.maximumMarks || maximumMarks}</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge
                    label={grading.outcome === "FINAL" ? "Final" : "Held for review"}
                    tone={grading.outcome === "FINAL" ? "success" : "warning"}
                    size="sm"
                  />
                  {evidenceBadge && (
                    <StatusBadge
                      label={evidenceBadge.label}
                      tone={evidenceBadge.tone}
                      size="sm"
                    />
                  )}
                </div>
                {grading.teacherReview && (
                  <p className="w-full text-xs text-subtle">
                    Previously {grading.teacherReview.previousAwardedMarks ?? "—"} /{" "}
                    {grading.maximumMarks} before review.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted">
                No completed evaluation is stored for this response
                {response ? ` (${humanize(response.status)})` : ""}.
              </p>
            )}
          </Evidence>

          {checkpointResults.length > 0 && (
            <Evidence
              title="Checkpoint evidence"
              hint="What each rubric checkpoint was awarded, and the evidence found in the answer."
            >
              <ul className="flex flex-col divide-y divide-line">
                {checkpointResults.map((checkpoint) => (
                  <li key={checkpoint.checkpointIndex} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="text-sm font-medium">{checkpoint.description}</p>
                      <div className="flex shrink-0 items-center gap-2">
                        <StatusBadge
                          label={humanize(checkpoint.outcome)}
                          tone={OUTCOME_TONE[checkpoint.outcome] ?? "neutral"}
                          size="sm"
                        />
                        <span className="text-sm font-semibold tabular-nums">
                          {checkpoint.marksAwarded}
                          <span className="text-subtle">/{checkpoint.maximumMarks}</span>
                        </span>
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {checkpoint.matchedTerms.length > 0
                        ? `Evidence found: ${checkpoint.matchedTerms.join(", ")}`
                        : "No matching evidence found in the answer"}
                      {" · "}
                      {checkpoint.confidence.level} confidence
                    </p>
                  </li>
                ))}
              </ul>
            </Evidence>
          )}

          {correction?.comparison && correction.comparison.checkpointComparisons.length > 0 && (
            <Evidence
              title="Agreement between the two evaluations"
              hint={
                correction.comparison.checkpointComparisons.every(
                  (c) => c.agreement === "ai_unavailable",
                )
                  ? "No independent second opinion was available, so checkpoint matching stands on its own."
                  : correction.comparison.disagreementCount === 0
                    ? "Both evaluations reached the same conclusion on every checkpoint."
                    : `${correction.comparison.disagreementCount} checkpoint${
                        correction.comparison.disagreementCount === 1 ? "" : "s"
                      } did not match and were sent for verification.`
              }
            >
              <ul className="flex flex-col gap-2">
                {correction.comparison.checkpointComparisons.map((comparison) => {
                  const display =
                    AGREEMENT_DISPLAY[comparison.agreement] ?? {
                      label: comparison.agreement,
                      tone: "neutral" as BadgeTone,
                    };
                  return (
                    <li
                      key={comparison.checkpointIndex}
                      className="flex flex-wrap items-center gap-2 text-sm"
                    >
                      <span className="font-medium">
                        Checkpoint {comparison.checkpointIndex + 1}
                      </span>
                      <StatusBadge label={display.label} tone={display.tone} size="sm" />
                      <span className="text-xs text-muted">
                        rubric matching: {humanize(comparison.deterministicOutcome)}
                        {comparison.aiOutcome
                          ? ` · second opinion: ${humanize(comparison.aiOutcome)}`
                          : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Evidence>
          )}

          {correction?.verification && (
            <Evidence
              title="Verification"
              hint={
                correction.verification.requiresReview
                  ? "Verification asked for a human check."
                  : "Verification resolved the disagreement."
              }
            >
              <ul className="flex flex-col gap-2 text-sm">
                {correction.verification.checkpointVerifications.map((verification) => (
                  <li key={verification.checkpointIndex}>
                    <span className="font-medium">
                      Checkpoint {verification.checkpointIndex + 1}:
                    </span>{" "}
                    {humanize(verification.recommendedOutcome)}
                    {verification.reason && (
                      <span className="text-muted"> — {verification.reason}</span>
                    )}
                  </li>
                ))}
              </ul>
            </Evidence>
          )}

          {correction?.aiEvaluation && correction.aiEvaluation.checkpointEvaluations.length > 0 && (
            <details className="group rounded-xl border border-line bg-surface p-5">
              <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-wide text-muted">
                Independent second opinion
                <span className="ml-2 font-normal normal-case text-accent-text group-open:hidden">
                  show
                </span>
                <span className="ml-2 hidden font-normal normal-case text-accent-text group-open:inline">
                  hide
                </span>
              </summary>
              <ul className="mt-3 flex flex-col gap-2 text-sm">
                {correction.aiEvaluation.checkpointEvaluations.map((evaluation) => (
                  <li key={evaluation.checkpointIndex}>
                    <span className="font-medium">
                      Checkpoint {evaluation.checkpointIndex + 1}:
                    </span>{" "}
                    {humanize(evaluation.outcome)}
                    {evaluation.evidence.length > 0 && (
                      <span className="text-muted"> — quoted: {evaluation.evidence.join("; ")}</span>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {novelCandidates.length > 0 && (
            <Evidence
              title="Possible new approach"
              hint="Recorded because the answer didn't match any approach in the rubric. Adding it to the rubric is a separate, deliberate action — nothing here changes the rubric."
            >
              <ul className="flex flex-col gap-4">
                {novelCandidates.map((candidate) => {
                  const data = readNovelApproach(candidate.approachData);
                  const againstPinnedRubric = candidate.rubricVersionId === rubricVersion?.id;
                  return (
                    <li key={candidate.id} className="text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge label={humanize(candidate.status)} tone="novel" size="sm" />
                        <span className="text-xs text-subtle">
                          Recorded {candidate.createdAt.toLocaleDateString()}
                        </span>
                      </div>
                      {data?.aiSummary && <p className="mt-2">{data.aiSummary}</p>}
                      {data?.aiReasoning && (
                        <p className="mt-1 text-xs text-muted">{data.aiReasoning}</p>
                      )}
                      <p className="mt-1.5 text-xs text-muted">
                        Closest rubric approach: {data?.bestMatchApproachLabel ?? "none matched"}
                        {data?.overlapRatio !== null && data?.overlapRatio !== undefined
                          ? ` · ${Math.round(data.overlapRatio * 100)}% vocabulary overlap`
                          : ""}
                        {data?.confidenceLevel ? ` · ${data.confidenceLevel} confidence` : ""}
                      </p>
                      {!againstPinnedRubric && (
                        <p className="mt-1 text-xs text-subtle">
                          Found against a different rubric version than the one below.
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Evidence>
          )}

          {annotation?.aiAnnotation && (
            <details className="group rounded-xl border border-line bg-surface p-5">
              <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-wide text-muted">
                Feedback prepared for the student
                <span className="ml-2 font-normal normal-case text-accent-text group-open:hidden">
                  show
                </span>
                <span className="ml-2 hidden font-normal normal-case text-accent-text group-open:inline">
                  hide
                </span>
              </summary>
              <p className="mt-3 text-sm">{annotation.aiAnnotation.summary}</p>
            </details>
          )}

          {annotation?.teacherFeedback && (
            <Evidence title="Your feedback to the student">
              <p className="text-sm">{annotation.teacherFeedback.note}</p>
            </Evidence>
          )}

          {pipelineWarnings.length > 0 && (
            <section className="rounded-xl border border-warning-line bg-warning-soft p-5">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-warning">
                Warnings recorded during evaluation
              </h2>
              <ul className="mt-3 flex flex-col gap-1 text-sm text-warning">
                {pipelineWarnings.map((warning, index) => (
                  <li key={index}>
                    <span className="font-medium">{warning.stage}:</span> {warning.message}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <details className="group rounded-xl border border-line bg-surface p-5">
            <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-wide text-muted">
              Rubric used for this evaluation
              <span className="ml-2 font-normal normal-case text-accent-text group-open:hidden">
                show
              </span>
              <span className="ml-2 hidden font-normal normal-case text-accent-text group-open:inline">
                hide
              </span>
            </summary>
            {rubricVersion ? (
              <div className="mt-3">
                <p className="text-xs text-subtle">
                  Version {rubricVersion.versionNumber} ({rubricVersion.status.toLowerCase()}) — the
                  version pinned when this response was evaluated, even if the rubric has changed
                  since.
                </p>
                {rubricCheckpoints.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-1 text-sm">
                    {rubricCheckpoints.map((checkpoint, index) => (
                      <li key={index}>
                        <span className="text-subtle">{checkpoint.marks} marks —</span>{" "}
                        {checkpoint.description}
                      </li>
                    ))}
                  </ul>
                )}
                {rubricApproaches.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                      Accepted approaches
                    </p>
                    <ul className="mt-1.5 flex flex-col gap-1 text-sm text-muted">
                      {rubricApproaches.map((approach, index) => (
                        <li key={index}>
                          <span className="font-medium text-foreground">{approach.label}</span>
                          {approach.description ? `: ${approach.description}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted">
                No rubric version was pinned for this response.
              </p>
            )}
          </details>
        </div>

        {/* ---------------- Decision ---------------- */}
        <div className="lg:col-span-1">
          <div className="lg:sticky lg:top-24">
            {isOpen ? (
              <div className="rounded-xl border border-accent-soft bg-surface p-5 shadow-sm">
                <h2 className="text-base font-semibold">Your decision</h2>
                <p className="mt-1 text-sm text-muted">
                  {question
                    ? "Confirming or overriding marks this response as finally graded and closes this flag."
                    : "This flag isn't about one specific question — dismiss it once you've reviewed the submission."}
                </p>
                <div className="mt-4">
                  <ReviewDecisionForm
                    reviewItemId={item.id}
                    maximumMarks={maximumMarks}
                    suggestedMarks={grading ? grading.awardedMarks : null}
                    canConfirm={canConfirm}
                    canDismiss={canDismiss}
                    hasQuestion={Boolean(question)}
                  />
                </div>
              </div>
            ) : (
              <Card tone="muted">
                <p className="text-sm font-medium">No action needed</p>
                <p className="mt-1 text-sm text-muted">
                  This review is closed. It stays here as a record of the decision.
                </p>
                <Link
                  href="/teacher/review-queue"
                  className="mt-3 inline-block text-sm font-medium text-accent-text hover:underline"
                >
                  Back to review queue &rarr;
                </Link>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
