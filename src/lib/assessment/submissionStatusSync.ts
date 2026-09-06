import type { Prisma, PrismaClient } from "@prisma/client";
import {
  deriveAggregateSubmissionStatus,
  summarizeQuestionResponseStatuses,
} from "@/lib/pipeline/submissionStatus";

/** Either the shared client or an interactive-transaction client. */
type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Re-derives a Submission's aggregate status from its QuestionResponse rows
 * and persists it, using the existing pure helpers in
 * src/lib/pipeline/submissionStatus.ts.
 *
 * Extracted (Phase 2.4) from the inline copy in the student submit action so
 * that action and the teacher review workflow share one implementation —
 * two divergent versions of "what status is this submission in" is exactly
 * the kind of drift that makes a student's result disagree with the
 * teacher's view of it.
 *
 * Takes the client to run on so it can participate in a caller's
 * transaction (review resolution) or run standalone (post-pipeline sweep).
 * Returns the status written, or null if there was nothing to derive from —
 * a submission with no responses yet has no meaningful aggregate, and
 * guessing one would be worse than leaving it alone.
 */
export async function recalculateSubmissionStatus(
  db: Db,
  submissionId: string,
): Promise<"PROCESSING" | "COMPLETED" | "NEEDS_REVIEW" | "FAILED" | null> {
  const responses = await db.questionResponse.findMany({
    where: { submissionId },
    select: { status: true },
  });

  if (responses.length === 0) {
    return null;
  }

  const summary = summarizeQuestionResponseStatuses(responses.map((r) => r.status));
  const status = deriveAggregateSubmissionStatus(summary);

  await db.submission.update({ where: { id: submissionId }, data: { status } });

  return status;
}
