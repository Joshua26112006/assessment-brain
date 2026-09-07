import { Card, MetricCard } from "@/components/ui/Page";
import StatusBadge from "@/components/ui/StatusBadge";
import PublishButton from "./PublishButton";
import RubricGenerationActions from "./RubricGenerationActions";
import RubricGenerationProgress from "./RubricGenerationProgress";
import type { AssessmentReadiness, ReadinessExplanation } from "@/lib/assessment/readiness";

const CARD_TONE = {
  success: "success",
  warning: "warning",
  danger: "danger",
  info: "accent",
  neutral: "muted",
} as const;

/**
 * Phase 4.2 — the single prominent "is this assessment ready?" surface,
 * replacing the two smaller, independently-calculated cards page.tsx had
 * before (an "Assessment analysis" metrics card and a separate "ready to
 * publish" narrative card). Both `readiness` and `explanation` come from
 * src/lib/assessment/readiness.ts — the same functions publishAssessment
 * uses server-side — so this can never show a state the publish action
 * would actually disagree with.
 *
 * Phase 4.3 added the two interactive pieces on the right
 * (RubricGenerationActions — "Generate All Rubrics" / "Retry Failed
 * Rubrics" / "View Complete Assessment Rubric", depending on state) and the
 * per-question checklist (RubricGenerationProgress) shown while not every
 * rubric is ready yet — both still driven entirely by this same `readiness`
 * object, never a second calculation.
 *
 * Deliberately a server component: everything here is derived from already-
 * fetched data, and the interactive pieces (PublishButton,
 * RubricGenerationActions) are their own small client islands, exactly like
 * the rest of this page.
 */
export default function AssessmentReadinessPanel({
  assessmentId,
  status,
  readiness,
  explanation,
}: {
  assessmentId: string;
  status: string;
  readiness: AssessmentReadiness;
  explanation: ReadinessExplanation;
}) {
  const isDraft = status === "DRAFT";
  const analysisPercent =
    readiness.totalQuestions > 0 ? Math.round((readiness.readyCount / readiness.totalQuestions) * 100) : 0;

  return (
    <Card tone={CARD_TONE[explanation.tone]} className="mb-8">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Assessment Brain — {readiness.isReady ? "Readiness check" : "Analysis"}
          </p>

          {readiness.totalQuestions > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricCard label="Questions" value={readiness.totalQuestions} />
              <MetricCard
                label="Rubrics ready"
                value={`${readiness.readyCount} / ${readiness.totalQuestions}`}
                emphasis={!readiness.isReady}
              />
              <MetricCard label="Total marks" value={readiness.totalMarks} />
              <MetricCard
                label="Analysis complete"
                value={`${analysisPercent}%`}
                emphasis={analysisPercent < 100}
              />
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <StatusBadge label={explanation.headline} tone={explanation.tone} />
            <span className="text-sm text-muted">{explanation.message}</span>
          </div>

          {!readiness.isReady && readiness.totalQuestions > 0 && (
            <RubricGenerationProgress readiness={readiness} />
          )}

          {(readiness.failedCount > 0 || readiness.missingCount > 0) && (
            <a
              href="#questions-and-rubrics"
              className="mt-3 inline-block text-xs font-medium text-accent-text hover:underline"
            >
              Review problem question{readiness.failedCount + readiness.missingCount === 1 ? "" : "s"} below →
            </a>
          )}
        </div>

        {isDraft && (
          <div className="flex flex-col items-end gap-3">
            <RubricGenerationActions assessmentId={assessmentId} readiness={readiness} />
            <PublishButton
              assessmentId={assessmentId}
              status={status}
              isReady={readiness.isReady}
              notReadyMessage={explanation.message}
            />
          </div>
        )}
      </div>
    </Card>
  );
}
