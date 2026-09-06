import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireTeacherSession } from "@/lib/require-teacher";
import { isActionableReviewStatus, reviewItemOwnedByTeacher } from "@/lib/review-scope";
import { PageHeader, EmptyState, Section } from "@/components/ui/Page";
import StatusBadge, {
  REVIEW_REASON_DESCRIPTION,
  reviewItemBadge,
  reviewReasonBadge,
} from "@/components/ui/StatusBadge";

export const metadata = { title: "Review queue" };

/**
 * Extracts a short, safe-to-show detail from a ReviewItem's context JSON, per
 * its reason. Never dumps raw JSON — only known, pre-sanitized fields.
 */
function summarizeContext(reason: string, context: unknown): string | null {
  if (typeof context !== "object" || context === null) return null;
  const record = context as Record<string, unknown>;

  if (reason === "UNCERTAIN_CORRECTION" && typeof record.correctionTotal === "number") {
    return `Tentative mark: ${record.correctionTotal}`;
  }
  if (reason === "NOVEL_APPROACH") {
    const novelApproach = record.novelApproach as Record<string, unknown> | undefined;
    const label = novelApproach?.bestMatchApproachLabel;
    if (typeof label === "string" && label) {
      return `Closest known approach: ${label}`;
    }
    return "The answer doesn't clearly match any approach in the rubric.";
  }
  if (reason === "VERIFICATION_FAILURE" && typeof record.errorMessage === "string") {
    return record.errorMessage;
  }
  return null;
}

export default async function ReviewQueuePage() {
  const session = await requireTeacherSession();
  const reviewItems = await loadReviewItems(session.user.id);

  const openItems = reviewItems.filter((item) => isActionableReviewStatus(item.status));
  const closedItems = reviewItems.filter((item) => !isActionableReviewStatus(item.status));

  return (
    <div>
      <PageHeader
        title="Review queue"
        description="Responses the evaluation pipeline wasn't confident enough to finalise on its own. Your decision sets the student's mark."
        meta={
          openItems.length > 0 ? (
            <StatusBadge
              label={`${openItems.length} waiting on you`}
              tone="warning"
            />
          ) : (
            <StatusBadge label="All clear" tone="success" />
          )
        }
      />

      {openItems.length === 0 ? (
        <EmptyState
          title="Nothing needs your review"
          description="When an evaluation is uncertain, fails, or spots an approach your rubric doesn't cover, it will appear here with its full evidence."
        />
      ) : (
        <Section title={`Needs your review (${openItems.length})`}>
          <ul className="flex flex-col gap-3">
            {openItems.map((item) => (
              <ReviewItemCard key={item.id} item={item} open />
            ))}
          </ul>
        </Section>
      )}

      {closedItems.length > 0 && (
        <Section
          className="mt-10"
          title={`Resolved (${closedItems.length})`}
          description="Decisions you've already made, most recent first."
        >
          <ul className="flex flex-col gap-2">
            {closedItems.map((item) => (
              <ReviewItemCard key={item.id} item={item} open={false} />
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

type ReviewQueueItem = Awaited<ReturnType<typeof loadReviewItems>>[number];

/**
 * ReviewItem's links to assessment/question/submission/questionResponse are
 * all independently optional, so ownership has to be checked across every
 * path back to an assessment this teacher owns — the same scoping the detail
 * page and every review action re-apply.
 */
async function loadReviewItems(teacherId: string) {
  return prisma.reviewItem.findMany({
    where: reviewItemOwnedByTeacher(teacherId),
    orderBy: { createdAt: "desc" },
    include: {
      assessment: { select: { id: true, title: true } },
      question: {
        select: {
          id: true,
          questionNumber: true,
          questionText: true,
          assessment: { select: { id: true, title: true } },
        },
      },
      submission: {
        select: {
          id: true,
          student: { select: { name: true } },
          assessment: { select: { id: true, title: true } },
        },
      },
    },
  });
}

function ReviewItemCard({ item, open }: { item: ReviewQueueItem; open: boolean }) {
  const assessmentTitle =
    item.assessment?.title ??
    item.question?.assessment.title ??
    item.submission?.assessment.title ??
    "Unknown assessment";
  const student = item.submission?.student.name;
  const detail = summarizeContext(item.reason, item.context);
  const reason = reviewReasonBadge(item.reason);
  const status = reviewItemBadge(item.status);

  return (
    <li>
      <Link
        href={`/teacher/review-queue/${item.id}`}
        className={`block rounded-xl border p-5 transition-colors ${
          open
            ? "border-line bg-surface hover:border-line-strong"
            : "border-line bg-surface-muted hover:border-line-strong"
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge label={reason.label} tone={reason.tone} size="sm" />
              {!open && <StatusBadge label={status.label} tone={status.tone} size="sm" />}
            </div>
            <p className="mt-2 text-sm font-medium">
              {student ?? "Unknown student"}
              {item.question ? ` · Question ${item.question.questionNumber}` : ""}
            </p>
            <p className="mt-0.5 text-xs text-muted">{assessmentTitle}</p>
          </div>
          <span className="shrink-0 text-sm font-medium text-accent-text">
            {open ? "Review →" : "View decision →"}
          </span>
        </div>

        {item.question?.questionText && (
          <p className="mt-3 line-clamp-2 text-sm text-muted">{item.question.questionText}</p>
        )}

        <p className="mt-3 text-sm text-foreground">
          {REVIEW_REASON_DESCRIPTION[item.reason] ?? "Flagged for your review."}
        </p>
        {detail && <p className="mt-1 text-xs text-subtle">{detail}</p>}
      </Link>
    </li>
  );
}
