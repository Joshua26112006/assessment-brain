import { redirect } from "next/navigation";
import { requireStudentSession } from "@/lib/require-student";
import {
  getEligibleAssessmentOrNotFound,
  getOrCreateSubmission,
} from "@/lib/student-assessment-access";
import { prisma } from "@/lib/prisma";
import { PageHeader, Card } from "@/components/ui/Page";
import QuestionPaper from "./QuestionPaper";
import AnswerSheetWorkflow from "./AnswerSheetWorkflow";

/**
 * The primary student assessment-taking experience: a read-only question
 * paper plus the handwritten answer-sheet upload workflow (Phase 3.2).
 *
 * The previous per-question typed-answer interface (AnswerForm,
 * SubmitAssessmentButton, actions.ts) is intentionally left in place and
 * fully functional underneath — this page simply no longer reaches it,
 * since the product now expects answers written on paper and photographed
 * rather than typed in per-question. See the Phase 3.2 report for why the
 * old files were preserved rather than deleted.
 */
export default async function TakeAssessmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireStudentSession();
  const assessment = await getEligibleAssessmentOrNotFound(id, session.user.id);
  const submission = await getOrCreateSubmission(id, session.user.id);

  // Post-submission edit lock: once submitted, this page is no longer the
  // right place to be.
  if (submission.status !== "DRAFT") {
    redirect(`/student/results/${submission.id}`);
  }

  const pages = await prisma.answerSheetPage.findMany({
    where: { submissionId: submission.id },
    orderBy: { pageNumber: "asc" },
    select: {
      id: true,
      pageNumber: true,
      originalFilename: true,
      mimeType: true,
      fileSizeBytes: true,
      createdAt: true,
    },
  });

  const totalMarks = assessment.questions.reduce((sum, q) => sum + Number(q.maximumMarks), 0);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        breadcrumb={[
          { label: "Assessments", href: "/student/assessments" },
          { label: assessment.title, href: `/student/assessments/${assessment.id}` },
          { label: "Answering" },
        ]}
        title={assessment.title}
        description="Read every question below, then write your answers on paper and upload photos of each page."
      />

      <QuestionPaper
        questions={assessment.questions.map((q) => ({
          id: q.id,
          questionNumber: q.questionNumber,
          questionText: q.questionText,
          maximumMarks: Number(q.maximumMarks),
        }))}
        totalMarks={totalMarks}
      />

      <Card className="mb-6" tone="muted">
        <h2 className="text-sm font-semibold">Write your answers on paper</h2>
        <ol className="mt-3 flex flex-col gap-1.5 pl-5 text-sm text-muted marker:text-subtle list-decimal">
          <li>Read every question carefully before you start writing.</li>
          <li>Write your answers by hand on plain paper.</li>
          <li>Keep each page well-lit and fully visible — no cropped edges or shadows.</li>
          <li>Photograph or scan every page of your answer sheet.</li>
          <li>Upload your pages below, in the same order you wrote them.</li>
        </ol>
      </Card>

      <AnswerSheetWorkflow
        submissionId={submission.id}
        initialPages={pages}
      />
    </div>
  );
}
