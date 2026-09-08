import Link from "next/link";
import { requireTeacherSession } from "@/lib/require-teacher";
import { getOwnedAssessmentOrNotFound } from "@/lib/assessment-ownership";
import { computeAssessmentReadiness } from "@/lib/assessment/readiness";
import { PageHeader, EmptyState } from "@/components/ui/Page";
import StatusBadge, { rubricGenerationBadge, questionValidationIssueLabel } from "@/components/ui/StatusBadge";
import { buttonClass } from "@/components/ui/styles";
import RubricViewer, {
  parseRubricApproaches,
  parseRubricCheckpoints,
  type RubricViewerApproach,
  type RubricViewerCheckpoint,
} from "../RubricViewer";
import RetryRubricButton from "../RetryRubricButton";
import RubricGenerationWatcher from "../RubricGenerationWatcher";

export const metadata = { title: "Complete assessment rubric" };

interface QuestionForRubricsPage {
  id: string;
  questionNumber: number;
  questionText: string;
  maximumMarks: number;
  rubric: {
    generationStatus: "PENDING" | "GENERATING" | "READY" | "FAILED" | "REVIEW_REQUIRED";
    generationError: string | null;
    validationIssueType: string | null;
    validationIssueSummary: string | null;
    validationExplanation: string | null;
    activeVersion: {
      versionNumber: number;
      expectedAnswer: string | null;
      partialCreditGuidance: string | null;
      solutionApproaches: RubricViewerApproach[];
      markingCheckpoints: RubricViewerCheckpoint[];
    } | null;
  } | null;
}

/**
 * Phase 4.3 Step 7 — the consolidated, assessment-level rubric page: every
 * question's rubric on one page, instead of a teacher opening each
 * QuestionCard individually on the assessment detail page. Reuses
 * RubricViewer unchanged for the READY case (Step 8's exact section list —
 * expected answer, solution approach, alternatives, marking breakdown,
 * partial credit — already lives there); this page only adds the
 * navigation shell and the per-question incomplete-state handling (Step 9).
 *
 * Ownership is established once via getOwnedAssessmentOrNotFound, exactly
 * like the sibling submissions/page.tsx route.
 */
export default async function AssessmentRubricsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireTeacherSession();
  const assessment = await getOwnedAssessmentOrNotFound(id, session.user.id);

  const questions: QuestionForRubricsPage[] = assessment.questions.map((q) => ({
    id: q.id,
    questionNumber: q.questionNumber,
    questionText: q.questionText,
    maximumMarks: Number(q.maximumMarks),
    rubric: q.rubric
      ? {
          generationStatus: q.rubric.generationStatus,
          generationError: q.rubric.generationError,
          validationIssueType: q.rubric.validationIssueType,
          validationIssueSummary: q.rubric.validationIssueSummary,
          validationExplanation: q.rubric.validationExplanation,
          activeVersion: q.rubric.activeVersion
            ? {
                versionNumber: q.rubric.activeVersion.versionNumber,
                expectedAnswer: q.rubric.activeVersion.expectedAnswer,
                partialCreditGuidance: q.rubric.activeVersion.partialCreditGuidance,
                solutionApproaches: parseRubricApproaches(q.rubric.activeVersion.solutionApproaches),
                markingCheckpoints: parseRubricCheckpoints(q.rubric.activeVersion.markingCheckpoints),
              }
            : null,
        }
      : null,
  }));

  // Reuses the exact shared readiness calculation (Phase 4.2) purely to
  // decide whether to keep polling — never a second "is this ready"
  // calculation of its own.
  const readiness = computeAssessmentReadiness(
    assessment.questions.map((q) => ({
      id: q.id,
      questionNumber: q.questionNumber,
      maximumMarks: q.maximumMarks,
      rubric: q.rubric
        ? {
            generationStatus: q.rubric.generationStatus,
            activeVersionId: q.rubric.activeVersionId,
            generationError: q.rubric.generationError,
            validationIssueType: q.rubric.validationIssueType,
            validationIssueSummary: q.rubric.validationIssueSummary,
          }
        : null,
    })),
  );

  return (
    <div>
      <RubricGenerationWatcher active={readiness.generatingCount > 0} />

      <PageHeader
        breadcrumb={[
          { label: "Assessments", href: "/teacher/assessments" },
          { label: assessment.title, href: `/teacher/assessments/${assessment.id}` },
          { label: "Complete rubric" },
        ]}
        title="Complete Assessment Rubric"
        description={assessment.title}
        meta={
          <span className="text-xs text-subtle">
            {questions.length} question{questions.length === 1 ? "" : "s"} · {readiness.totalMarks} marks
            total
          </span>
        }
        actions={
          <Link href={`/teacher/assessments/${assessment.id}`} className={buttonClass("secondary")}>
            ← Back to assessment
          </Link>
        }
      />

      {questions.length === 0 ? (
        <EmptyState
          title="No questions yet"
          description="Go back to the assessment and add questions before viewing its rubric."
          action={
            <Link href={`/teacher/assessments/${assessment.id}`} className={buttonClass("primary")}>
              Back to assessment
            </Link>
          }
        />
      ) : (
        <div className="grid gap-8 lg:grid-cols-[180px_1fr]">
          <nav aria-label="Questions" className="hidden lg:block">
            <div className="sticky top-24 flex flex-col gap-0.5 text-sm">
              <p className="mb-1.5 px-2 text-xs font-semibold uppercase tracking-wide text-muted">
                Questions
              </p>
              {questions.map((q) => {
                const badge = rubricGenerationBadge(q.rubric?.generationStatus ?? "PENDING");
                return (
                  <a
                    key={q.id}
                    href={`#question-${q.questionNumber}`}
                    className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-muted hover:bg-surface-muted hover:text-foreground"
                  >
                    <span>Question {q.questionNumber}</span>
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        badge.tone === "accent"
                          ? "bg-accent"
                          : badge.tone === "danger"
                            ? "bg-danger"
                            : badge.tone === "info"
                              ? "bg-info"
                              : badge.tone === "warning"
                                ? "bg-warning"
                                : "bg-subtle"
                      }`}
                    />
                  </a>
                );
              })}
            </div>
          </nav>

          <div className="flex flex-col gap-6">
            {questions.map((question) => (
              <QuestionRubricSection key={question.id} assessmentId={assessment.id} question={question} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function QuestionRubricSection({
  assessmentId,
  question,
}: {
  assessmentId: string;
  question: QuestionForRubricsPage;
}) {
  const rubric = question.rubric;
  const activeVersion = rubric?.activeVersion ?? null;
  const generationStatus = rubric?.generationStatus ?? "PENDING";
  const badge = rubricGenerationBadge(generationStatus);

  return (
    <section
      id={`question-${question.questionNumber}`}
      className="scroll-mt-24 rounded-xl border border-line bg-surface p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="text-base font-semibold">Question {question.questionNumber}</h3>
        <span className="shrink-0 text-xs font-medium text-subtle">{question.maximumMarks} marks</span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{question.questionText}</p>

      {generationStatus === "READY" && activeVersion ? (
        <RubricViewer
          rubric={{
            versionNumber: activeVersion.versionNumber,
            expectedAnswer: activeVersion.expectedAnswer,
            solutionApproaches: activeVersion.solutionApproaches,
            markingCheckpoints: activeVersion.markingCheckpoints,
            partialCreditGuidance: activeVersion.partialCreditGuidance,
          }}
        />
      ) : generationStatus === "REVIEW_REQUIRED" ? (
        <div className="mt-4 rounded-lg border border-danger-line bg-danger-soft p-4">
          <StatusBadge label={badge.label} tone={badge.tone} size="sm" />
          <p className="mt-2 text-sm font-semibold text-danger">
            Issue: {rubric?.validationIssueType ? questionValidationIssueLabel(rubric.validationIssueType) : "—"}
          </p>
          {rubric?.validationIssueSummary && (
            <p className="mt-1 text-sm text-danger">{rubric.validationIssueSummary}</p>
          )}
          {rubric?.validationExplanation && (
            <p className="mt-1.5 text-sm text-muted">{rubric.validationExplanation}</p>
          )}
          <p className="mt-3 text-sm text-muted">
            Assessment Brain could not safely generate a rubric for this question — it would have had to
            guess. Fix the question, then generate rubrics again.
          </p>
          <a
            href={`/teacher/assessments/${assessmentId}#question-${question.questionNumber}`}
            className={`${buttonClass("secondary", "sm")} mt-3 inline-block`}
          >
            Edit Question
          </a>
        </div>
      ) : generationStatus === "FAILED" ? (
        <div className="mt-4 rounded-lg border border-danger-line bg-danger-soft p-4">
          <StatusBadge label={badge.label} tone={badge.tone} size="sm" />
          <p className="mt-1.5 text-sm text-danger">
            {rubric?.generationError || "Something went wrong while generating this rubric."}
          </p>
          <RetryRubricButton questionId={question.id} />
        </div>
      ) : rubric === null ? (
        <div className="mt-4 rounded-lg border border-warning-line bg-warning-soft p-4">
          <StatusBadge label="No rubric yet" tone="warning" size="sm" />
          <p className="mt-1.5 text-sm text-warning">
            This question doesn&apos;t have a rubric generation record yet.
          </p>
          <RetryRubricButton questionId={question.id} />
        </div>
      ) : generationStatus === "GENERATING" ? (
        <div className="mt-4 rounded-lg border border-info-line bg-info-soft p-4">
          <StatusBadge label={badge.label} tone={badge.tone} size="sm" />
          <p className="mt-1.5 text-sm text-info">
            Assessment Brain is writing a marking rubric for this question.
          </p>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-line bg-surface-muted p-4">
          <StatusBadge label={badge.label} tone={badge.tone} size="sm" />
          <p className="mt-1.5 text-sm text-muted">
            Not generated yet — go back to the assessment and use &quot;Generate All Rubrics&quot;.
          </p>
        </div>
      )}
    </section>
  );
}
