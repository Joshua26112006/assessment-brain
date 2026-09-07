import type { AssessmentReadiness, RubricReadinessBucket } from "@/lib/assessment/readiness";

const ICON: Record<RubricReadinessBucket, string> = {
  READY: "✓",
  GENERATING: "⏳",
  FAILED: "⚠",
  PENDING: "○",
  MISSING: "○",
};

const ICON_TONE: Record<RubricReadinessBucket, string> = {
  READY: "text-success",
  GENERATING: "text-info",
  FAILED: "text-danger",
  PENDING: "text-subtle",
  MISSING: "text-subtle",
};

const STATE_LABEL: Record<RubricReadinessBucket, string> = {
  READY: "Ready",
  GENERATING: "Analyzing",
  FAILED: "Failed",
  PENDING: "Waiting",
  MISSING: "Waiting",
};

/**
 * Phase 4.3 Step 5 — the per-question generation checklist + progress bar,
 * shown on the assessment detail page whenever not every rubric is READY
 * yet (initial "nothing generated" state, mid-generation, and
 * partial-failure all render through this one component; it disappears
 * once readiness.isReady, replaced by the success state in
 * RubricGenerationActions). Purely derived from the same `readiness` object
 * the rest of the page already computed — never a separate calculation, and
 * never fake/animated progress.
 */
export default function RubricGenerationProgress({ readiness }: { readiness: AssessmentReadiness }) {
  const percent =
    readiness.totalQuestions > 0 ? Math.round((readiness.readyCount / readiness.totalQuestions) * 100) : 0;

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between text-xs font-medium text-muted">
        <span>
          {readiness.readyCount} of {readiness.totalQuestions} rubric
          {readiness.totalQuestions === 1 ? "" : "s"} complete
        </span>
        <span className="tabular-nums">{percent}%</span>
      </div>
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
      </div>

      <ul className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {readiness.questions.map((q) => (
          <li key={q.questionId} className="flex items-center gap-2">
            <span aria-hidden="true" className={`w-4 shrink-0 text-center font-semibold ${ICON_TONE[q.bucket]}`}>
              {ICON[q.bucket]}
            </span>
            <span className="text-foreground">Question {q.questionNumber}</span>
            <span className="text-xs text-muted">— {STATE_LABEL[q.bucket]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
