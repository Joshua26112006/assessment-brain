import Link from "next/link";
import { requireTeacherSession } from "@/lib/require-teacher";
import { getOwnedAssessmentOrNotFound } from "@/lib/assessment-ownership";
import { PageHeader, Section, Card, EmptyState } from "@/components/ui/Page";
import StatusBadge, { assessmentBadge } from "@/components/ui/StatusBadge";
import { buttonClass } from "@/components/ui/styles";
import AddQuestionForm from "./AddQuestionForm";
import QuestionCard from "./QuestionCard";
import PublishButton from "./PublishButton";
import QuestionPaperSection from "./QuestionPaperSection";

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
          activeVersion: q.rubric.activeVersion
            ? {
                id: q.rubric.activeVersion.id,
                versionNumber: q.rubric.activeVersion.versionNumber,
                solutionApproaches: Array.isArray(q.rubric.activeVersion.solutionApproaches)
                  ? (q.rubric.activeVersion.solutionApproaches as unknown[])
                  : [],
                markingCheckpoints: Array.isArray(q.rubric.activeVersion.markingCheckpoints)
                  ? (q.rubric.activeVersion.markingCheckpoints as unknown[])
                  : [],
              }
            : null,
          versionCount: q.rubric.versions.length,
        }
      : null,
  }));

  const badge = assessmentBadge(assessment.status);
  const isDraft = assessment.status === "DRAFT";
  const missingRubric = questions.filter((q) => !q.rubric?.activeVersion);
  const totalMarks = questions.reduce((sum, q) => sum + q.maximumMarks, 0);
  const readyToPublish = questions.length > 0 && missingRubric.length === 0;

  return (
    <div>
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
              {questions.length} question{questions.length === 1 ? "" : "s"} · {totalMarks} marks
              total
            </span>
          </>
        }
        actions={
          <>
            <Link
              href={`/teacher/assessments/${assessment.id}/submissions`}
              className={buttonClass("secondary")}
            >
              Submissions &amp; results
            </Link>
            <PublishButton assessmentId={assessment.id} status={assessment.status} />
          </>
        }
      />

      {/* Publishing readiness: informative while drafting, never alarming. */}
      {isDraft ? (
        <Card tone={readyToPublish ? "success" : "muted"} className="mb-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium">
                {readyToPublish ? "Ready to publish" : "Before you can publish"}
              </p>
              <p className="mt-1 text-sm text-muted">
                {questions.length === 0
                  ? "Add at least one question, then give it a rubric."
                  : missingRubric.length > 0
                    ? `Every question needs a rubric. Still missing on question${
                        missingRubric.length === 1 ? "" : "s"
                      } ${missingRubric.map((q) => q.questionNumber).join(", ")}.`
                    : "Every question has an active rubric. Publishing makes this visible to the class."}
              </p>
            </div>
            {readyToPublish && (
              <PublishButton assessmentId={assessment.id} status={assessment.status} />
            )}
          </div>
        </Card>
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
        title="Questions & rubrics"
        description="A rubric defines the accepted approaches and the checkpoints that earn marks. Editing a rubric creates a new version; past versions are kept so previous results stay reproducible."
      >
        {questions.length === 0 ? (
          <EmptyState
            title="No questions yet"
            description="Add your first question below, then attach a rubric to it."
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
