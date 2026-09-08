import Link from "next/link";
import { requireTeacherSession } from "@/lib/require-teacher";
import { getOwnedAssessmentOrNotFound } from "@/lib/assessment-ownership";
import { computeAssessmentReadiness, describeAssessmentReadiness } from "@/lib/assessment/readiness";
import { PageHeader, Section, Card, EmptyState } from "@/components/ui/Page";
import StatusBadge, { assessmentBadge } from "@/components/ui/StatusBadge";
import { buttonClass } from "@/components/ui/styles";
import AddQuestionForm from "./AddQuestionForm";
import QuestionCard from "./QuestionCard";
import DeleteAllQuestionsButton from "./DeleteAllQuestionsButton";
import QuestionPaperSection from "./QuestionPaperSection";
import RubricGenerationWatcher from "./RubricGenerationWatcher";
import AssessmentReadinessPanel from "./AssessmentReadinessPanel";
import { parseRubricApproaches, parseRubricCheckpoints } from "./RubricViewer";

export default async function AssessmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireTeacherSession();
  const assessment = await getOwnedAssessmentOrNotFound(id, session.user.id);

  // Prisma's Decimal/Json values aren't plain-serializable across the
  // server/client boundary as-is — convert to plain numbers/arrays here so
  // the client components below receive ordinary JSON-safe props.
  const questions = assessment.questions.map((q) => ({
    id: q.id,
    questionNumber: q.questionNumber,
    questionText: q.questionText,
    maximumMarks: Number(q.maximumMarks),
    rubric: q.rubric
      ? {
          id: q.rubric.id,
          generationStatus: q.rubric.generationStatus,
          generationError: q.rubric.generationError,
          validationIssueType: q.rubric.validationIssueType,
          validationIssueSummary: q.rubric.validationIssueSummary,
          validationExplanation: q.rubric.validationExplanation,
          activeVersion: q.rubric.activeVersion
            ? {
                id: q.rubric.activeVersion.id,
                versionNumber: q.rubric.activeVersion.versionNumber,
                expectedAnswer: q.rubric.activeVersion.expectedAnswer,
                partialCreditGuidance: q.rubric.activeVersion.partialCreditGuidance,
                solutionApproaches: parseRubricApproaches(q.rubric.activeVersion.solutionApproaches),
                markingCheckpoints: parseRubricCheckpoints(q.rubric.activeVersion.markingCheckpoints),
              }
            : null,
          versionCount: q.rubric.versions.length,
        }
      : null,
  }));

  const badge = assessmentBadge(assessment.status);

  // The single source of truth for "is this assessment ready to publish" —
  // the exact same functions publishAssessment uses server-side (Phase
  // 4.2), computed here from the already-fetched assessment.questions so
  // this page needs no extra round trip. See src/lib/assessment/readiness.ts.
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
  const readinessExplanation = describeAssessmentReadiness(readiness);

  return (
    <div>
      {/* Only polls while generation is actually in flight — a merely
          PENDING question (Phase 4.3: generation is teacher-triggered, not
          automatic) can sit unchanged for as long as the teacher likes, so
          polling for that alone would just waste requests. */}
      <RubricGenerationWatcher active={readiness.generatingCount > 0} />

      <PageHeader
        breadcrumb={[
          { label: "Assessments", href: "/teacher/assessments" },
          { label: assessment.title },
        ]}
        title={assessment.title}
        description={`${assessment.subject} · ${assessment.grade} · ${assessment.curriculum} · Class: ${assessment.class.name}`}
        meta={
          <>
            <StatusBadge label={badge.label} tone={badge.tone} />
            <span className="text-xs text-subtle">
              {questions.length} question{questions.length === 1 ? "" : "s"} · {readiness.totalMarks}{" "}
              marks total
            </span>
          </>
        }
        actions={
          <Link
            href={`/teacher/assessments/${assessment.id}/submissions`}
            className={buttonClass("secondary")}
          >
            Submissions &amp; results
          </Link>
        }
      />

      {assessment.status === "DRAFT" ? (
        <AssessmentReadinessPanel
          assessmentId={assessment.id}
          status={assessment.status}
          readiness={readiness}
          explanation={readinessExplanation}
        />
      ) : (
        <Card tone="muted" className="mb-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium">This assessment is live</p>
              <p className="mt-1 text-sm text-muted">
                As students submit, answers are evaluated against these rubrics. Results appear under{" "}
                <Link
                  href={`/teacher/assessments/${assessment.id}/submissions`}
                  className="font-medium text-accent-text hover:underline"
                >
                  Submissions &amp; results
                </Link>
                , and anything the evaluation was unsure about goes to your{" "}
                <Link href="/teacher/review-queue" className="font-medium text-accent-text hover:underline">
                  review queue
                </Link>
                .
              </p>
            </div>
            <Link
              href={`/teacher/assessments/${assessment.id}/rubrics`}
              className={`${buttonClass("secondary")} shrink-0`}
            >
              View Complete Assessment Rubric
            </Link>
          </div>
        </Card>
      )}

      <QuestionPaperSection assessmentId={assessment.id} hasQuestions={questions.length > 0} />

      <Section
        id="questions-and-rubrics"
        title="Questions & rubrics"
        description='Once every question exists, use "Generate All Rubrics" above to have Assessment Brain write a detailed marking rubric for each one — the expected answer, solution approach, marking checkpoints, and partial-credit guidance. Manually editing a rubric is still available as an advanced override.'
        actions={
          questions.length > 0 && (
            <DeleteAllQuestionsButton assessmentId={assessment.id} count={questions.length} />
          )
        }
      >
        {questions.length === 0 ? (
          <EmptyState
            title="No questions yet"
            description="Add your first question below, or upload a question paper above — then generate rubrics for all of them at once."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {questions.map((question) => (
              <QuestionCard key={question.id} question={question} />
            ))}
          </div>
        )}

        <div className="mt-4">
          <AddQuestionForm assessmentId={assessment.id} />
        </div>
      </Section>
    </div>
  );
}
