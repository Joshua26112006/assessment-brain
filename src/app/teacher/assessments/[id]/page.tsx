import Link from "next/link";
import { requireTeacherSession } from "@/lib/require-teacher";
import { getOwnedAssessmentOrNotFound } from "@/lib/assessment-ownership";
import { computeAssessmentReadiness, describeAssessmentReadiness } from "@/lib/assessment/readiness";
import { PageHeader, Section, Card, EmptyState } from "@/components/ui/Page";
import StatusBadge, { assessmentBadge } from "@/components/ui/StatusBadge";
import { buttonClass } from "@/components/ui/styles";
import AddQuestionForm from "./AddQuestionForm";
import QuestionCard from "./QuestionCard";
import QuestionPaperSection from "./QuestionPaperSection";
import RubricGenerationWatcher from "./RubricGenerationWatcher";
import AssessmentReadinessPanel from "./AssessmentReadinessPanel";
import type { RubricViewerApproach, RubricViewerCheckpoint } from "./RubricViewer";

function toApproaches(raw: unknown): RubricViewerApproach[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const record = item as Record<string, unknown>;
    return {
      label: typeof record.label === "string" ? record.label : "",
      description: typeof record.description === "string" ? record.description : "",
      steps: Array.isArray(record.steps)
        ? record.steps.filter((s): s is string => typeof s === "string")
        : [],
      isPrimary: record.isPrimary === true,
    };
  });
}

function toCheckpoints(raw: unknown): RubricViewerCheckpoint[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const record = item as Record<string, unknown>;
    return {
      description: typeof record.description === "string" ? record.description : "",
      marks: typeof record.marks === "number" ? record.marks : Number(record.marks) || 0,
    };
  });
}

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
          activeVersion: q.rubric.activeVersion
            ? {
                id: q.rubric.activeVersion.id,
                versionNumber: q.rubric.activeVersion.versionNumber,
                expectedAnswer: q.rubric.activeVersion.expectedAnswer,
                partialCreditGuidance: q.rubric.activeVersion.partialCreditGuidance,
                solutionApproaches: toApproaches(q.rubric.activeVersion.solutionApproaches),
                markingCheckpoints: toCheckpoints(q.rubric.activeVersion.markingCheckpoints),
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
          }
        : null,
    })),
  );
  const readinessExplanation = describeAssessmentReadiness(readiness);

  return (
    <div>
      <RubricGenerationWatcher active={readiness.generatingCount > 0 || readiness.pendingCount > 0} />

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
        </Card>
      )}

      <QuestionPaperSection assessmentId={assessment.id} hasQuestions={questions.length > 0} />

      <Section
        id="questions-and-rubrics"
        title="Questions & rubrics"
        description="Assessment Brain automatically generates a detailed marking rubric for every question — the expected answer, solution approach, marking checkpoints, and partial-credit guidance. Manually editing a rubric is still available as an advanced override."
      >
        {questions.length === 0 ? (
          <EmptyState
            title="No questions yet"
            description="Add your first question below, then Assessment Brain writes its rubric for you."
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
