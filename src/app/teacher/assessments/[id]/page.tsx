import Link from "next/link";
import { requireTeacherSession } from "@/lib/require-teacher";
import { getOwnedAssessmentOrNotFound } from "@/lib/assessment-ownership";
import AddQuestionForm from "./AddQuestionForm";
import QuestionCard from "./QuestionCard";
import PublishButton from "./PublishButton";

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

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-black/50 dark:text-white/50">
            <Link href="/teacher/assessments" className="hover:underline">
              Assessments
            </Link>{" "}
            / {assessment.title}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {assessment.title}
          </h1>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            {assessment.subject} &middot; {assessment.grade} &middot;{" "}
            {assessment.curriculum} &middot; Class: {assessment.class.name}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded bg-black/5 px-2 py-1 text-xs font-medium uppercase tracking-wide dark:bg-white/10">
            {assessment.status}
          </span>
          <PublishButton
            assessmentId={assessment.id}
            status={assessment.status}
          />
        </div>
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-medium">Questions</h2>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          Each question needs a rubric with at least one accepted approach
          and one marking checkpoint before the assessment can be published.
        </p>

        <div className="mt-4 flex flex-col gap-4">
          {questions.map((question) => (
            <QuestionCard key={question.id} question={question} />
          ))}
        </div>

        <div className="mt-4">
          <AddQuestionForm assessmentId={assessment.id} />
        </div>
      </section>
    </div>
  );
}
