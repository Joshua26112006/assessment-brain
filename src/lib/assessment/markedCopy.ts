import { prisma } from "@/lib/prisma";
import { loadOrderedAnswerSheetPages } from "@/lib/handwritten/pages";
import { loadSubmissionReview } from "@/lib/assessment/markRelease";
import { roundMarks } from "@/lib/assessment/markReview";
import { annotateAnswerSheet, type AnnotatableQuestion } from "@/lib/structuredCorrection/annotation";
import type { ErrorExplanation } from "@/types/structuredCorrection";

/**
 * Draws the marked-up copy of a student's answer sheet — ticks, the marks the
 * TEACHER settled on, the total, and a ring round each finding the teacher
 * kept — at the moment of release (decision D5 of 06-correction-hardening-plan.md).
 *
 * It used to be drawn when the AI finished marking, which showed the AI's
 * marks whatever the teacher later decided. Now nothing is drawn until the
 * marks are final, and only findings a teacher kept are ever circled.
 *
 * Best-effort and never throws: the marks are already released and recorded, so
 * a failure here leaves the student with their own unmarked pages, never with
 * a wrong marked copy (release clears any earlier one first). A failure is
 * reported back so the caller can tell the teacher.
 */
export interface MarkedCopyOutcome {
  /** False when drawing failed outright; true otherwise, including when there was nothing to draw on. */
  ok: boolean;
  annotatedPages: number;
  failedPages: number;
  reason: string | null;
}

export async function generateMarkedCopy(submissionId: string): Promise<MarkedCopyOutcome> {
  try {
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      select: { id: true, assessmentId: true },
    });
    if (!submission) return { ok: false, annotatedPages: 0, failedPages: 0, reason: "Submission not found." };

    const pages = await loadOrderedAnswerSheetPages(submission.id);
    // A typed assessment has no photographed pages to draw on.
    if (pages.length === 0) return { ok: true, annotatedPages: 0, failedPages: 0, reason: null };

    const rows = await loadSubmissionReview(prisma, submission.id, submission.assessmentId);

    const questions: AnnotatableQuestion[] = rows.flatMap((row) => {
      if (!row.response) return [];
      const explanations: ErrorExplanation[] = row.response.findings
        .filter((finding) => finding.kept)
        .map((finding) => ({
          errorId: finding.id,
          explanationType: finding.type,
          explanation: finding.explanation,
          wrongText: finding.wrongText ?? undefined,
          correctVersion: finding.correctVersion ?? undefined,
        }));
      return [
        {
          questionNumber: row.questionNumber,
          awardedMarks: row.response.awardedMarks ?? 0,
          maximumMarks: row.maximumMarks,
          explanations,
          sourcePages: row.response.sourcePages,
        },
      ];
    });

    // Out of the WHOLE paper, not only the questions the student answered.
    const total = {
      awarded: roundMarks(questions.reduce((sum, question) => sum + question.awardedMarks, 0)),
      maximum: roundMarks(rows.reduce((sum, row) => sum + row.maximumMarks, 0)),
    };

    const outcomes = await annotateAnswerSheet(
      pages.map((page) => ({
        pageId: page.pageId,
        pageNumber: page.pageNumber,
        submissionId: submission.id,
        buffer: page.buffer,
      })),
      questions,
      total,
    );

    const annotatedPages = outcomes.filter((outcome) => outcome.annotated).length;
    return { ok: true, annotatedPages, failedPages: outcomes.length - annotatedPages, reason: null };
  } catch (error) {
    console.error("Could not generate the marked copy", error);
    return { ok: false, annotatedPages: 0, failedPages: 0, reason: "The marked copy could not be drawn." };
  }
}
