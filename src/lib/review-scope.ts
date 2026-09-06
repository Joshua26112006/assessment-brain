import type { Prisma, PrismaClient } from "@prisma/client";
import { REVIEW_DECISION_CONTRACT_VERSION, type ReviewDecisionRecord } from "@/types/review";

/**
 * Ownership scoping and read helpers for ReviewItems.
 *
 * Deliberately free of any `next/navigation` import (unlike review-access.ts,
 * which calls notFound()) so the review resolution logic that depends on
 * this stays plain server-side code, callable and testable outside a
 * Next.js request context.
 */

/**
 * "Does this review item belong to me?" — a ReviewItem's four entity links
 * (assessment / question / submission / questionResponse) are each
 * independently optional by design, so ownership has to be asked across
 * every path that can lead back to an assessment this teacher owns.
 * Centralized so the queue, the detail page, the dashboard count and every
 * mutating action ask the identical question rather than four slightly
 * different ones.
 */
export function reviewItemOwnedByTeacher(teacherId: string): Prisma.ReviewItemWhereInput {
  return {
    OR: [
      { assessment: { teacherId } },
      { question: { assessment: { teacherId } } },
      { submission: { assessment: { teacherId } } },
      { questionResponse: { submission: { assessment: { teacherId } } } },
    ],
  };
}

/** ReviewItem statuses a teacher can still act on. */
export const ACTIONABLE_REVIEW_STATUSES = ["PENDING", "IN_REVIEW"] as const;

export function isActionableReviewStatus(status: string): boolean {
  return (ACTIONABLE_REVIEW_STATUSES as readonly string[]).includes(status);
}

/**
 * Other still-open review items for the same QuestionResponse. A response
 * can legitimately carry more than one flag (e.g. an uncertain correction
 * *and* a novel approach), and resolving one says nothing about the others —
 * so the detail page surfaces them rather than implying the response is
 * fully handled.
 */
export async function countOtherOpenReviewItems(
  db: PrismaClient | Prisma.TransactionClient,
  questionResponseId: string,
  excludeReviewItemId: string,
): Promise<number> {
  return db.reviewItem.count({
    where: {
      questionResponseId,
      id: { not: excludeReviewItemId },
      status: { in: [...ACTIONABLE_REVIEW_STATUSES] },
    },
  });
}

/**
 * Defensive reader for ReviewItem.decision, which is an untyped Json column.
 * Same principle as src/lib/pipeline/parseResults.ts: a stored value that
 * doesn't match the contract is treated as absent rather than displayed as
 * if it were valid.
 */
export function parseReviewDecision(value: unknown): ReviewDecisionRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;

  if (record.contractVersion !== REVIEW_DECISION_CONTRACT_VERSION) return null;
  if (
    record.action !== "CONFIRMED" &&
    record.action !== "OVERRIDDEN" &&
    record.action !== "DISMISSED"
  ) {
    return null;
  }
  if (typeof record.decidedAt !== "string") return null;
  if (typeof record.reviewerId !== "string") return null;

  return value as unknown as ReviewDecisionRecord;
}
