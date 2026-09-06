import { prisma } from "@/lib/prisma";
import { Card } from "@/components/ui/Page";
import QuestionPaperUpload from "./QuestionPaperUpload";
import QuestionPaperReview from "./QuestionPaperReview";
import type { ExtractedPaperDraft } from "@/types/questionPaper";

/**
 * Decides which of the three question-paper states to show on the
 * assessment detail page. Ownership of `assessmentId` is already verified
 * by the parent page (getOwnedAssessmentOrNotFound) before this renders, so
 * this queries by assessmentId alone — the same trust boundary
 * AddQuestionForm/QuestionCard already rely on.
 */
export default async function QuestionPaperSection({
  assessmentId,
  hasQuestions,
}: {
  assessmentId: string;
  hasQuestions: boolean;
}) {
  const current = await prisma.questionPaper.findFirst({
    where: { assessmentId },
    orderBy: { createdAt: "desc" },
    include: { pages: { orderBy: { pageNumber: "asc" } } },
  });

  // Once real Questions exist, uploading a new question paper is no longer
  // offered — manual add/edit below remains the way to keep changing them.
  if (hasQuestions) {
    if (current?.extractionStatus === "APPROVED") {
      return (
        <Card className="mb-6" tone="muted">
          <p className="text-sm text-muted">These questions were created from an uploaded question paper.</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {current.pages.map((page) => (
              <li key={page.id}>
                <a
                  href={`/api/teacher/assessments/${assessmentId}/question-paper/pages/${page.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-accent-text hover:underline"
                >
                  {page.mimeType === "application/pdf" ? "View original PDF" : `View page ${page.pageNumber}`}
                </a>
              </li>
            ))}
          </ul>
        </Card>
      );
    }
    return null;
  }

  if (!current) {
    return <QuestionPaperUpload assessmentId={assessmentId} />;
  }

  return (
    <QuestionPaperReview
      assessmentId={assessmentId}
      questionPaper={{
        id: current.id,
        extractionStatus: current.extractionStatus,
        extractionError: current.extractionError,
        extractedContent: current.extractedContent as unknown as ExtractedPaperDraft | null,
        pages: current.pages.map((p) => ({
          id: p.id,
          pageNumber: p.pageNumber,
          originalFilename: p.originalFilename,
          mimeType: p.mimeType,
        })),
      }}
    />
  );
}
