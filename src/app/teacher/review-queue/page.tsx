import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireTeacherSession } from "@/lib/require-teacher";

const REASON_COPY: Record<string, string> = {
  NOVEL_APPROACH: "Student may have used a valid approach not yet in the rubric",
  AMBIGUOUS_EXTRACTION: "Answer was hard to read or extract",
  UNCERTAIN_CORRECTION: "Correction result was uncertain and needs confirmation",
  VERIFICATION_FAILURE: "Evaluation could not be completed",
  AMBIGUOUS_ANNOTATION: "Feedback generation was uncertain",
  UNDETERMINED_GRADING: "Grading outcome could not be determined automatically",
  OTHER: "Flagged for review",
};

/** Extracts a short, safe-to-show detail line from a ReviewItem's context JSON, per its reason. Never dumps raw JSON — only known, pre-sanitized fields. */
function summarizeContext(reason: string, context: unknown): string | null {
  if (typeof context !== "object" || context === null) return null;
  const record = context as Record<string, unknown>;

  if (reason === "UNCERTAIN_CORRECTION" && typeof record.correctionTotal === "number") {
    return `Tentative score: ${record.correctionTotal}`;
  }
  if (reason === "NOVEL_APPROACH") {
    const novelApproach = record.novelApproach as Record<string, unknown> | undefined;
    const label = novelApproach?.bestMatchApproachLabel;
    if (typeof label === "string" && label) {
      return `Closest known approach: ${label}`;
    }
    return "Answer's approach doesn't clearly match a known solution approach.";
  }
  if (reason === "VERIFICATION_FAILURE" && typeof record.errorMessage === "string") {
    return record.errorMessage;
  }
  return null;
}

export default async function ReviewQueuePage() {
  const session = await requireTeacherSession();
  const teacherId = session.user.id;

  // ReviewItem's links to assessment/question/submission/questionResponse
  // are all independently optional, so ownership has to be checked across
  // every possible path back to an assessment this teacher owns.
  const reviewItems = await prisma.reviewItem.findMany({
    where: {
      OR: [
        { assessment: { teacherId } },
        { question: { assessment: { teacherId } } },
        { submission: { assessment: { teacherId } } },
        { questionResponse: { submission: { assessment: { teacherId } } } },
      ],
    },
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

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Review Queue</h1>
      <p className="mt-2 text-sm text-black/60 dark:text-white/60">
        Cases the evaluation pipeline flagged for your attention across your assessments.
      </p>

      {reviewItems.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-black/15 p-10 text-center dark:border-white/20">
          <p className="text-sm text-black/60 dark:text-white/60">
            Nothing needs your review right now.
          </p>
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {reviewItems.map((item) => {
            const assessmentId = item.assessment?.id ?? item.question?.assessment.id ?? item.submission?.assessment.id;
            const assessmentTitle =
              item.assessment?.title ??
              item.question?.assessment.title ??
              item.submission?.assessment.title ??
              "Unknown assessment";
            const student = item.submission?.student.name;
            const detail = summarizeContext(item.reason, item.context);

            return (
              <li
                key={item.id}
                className="rounded-lg border border-black/10 p-4 dark:border-white/15"
              >
                <div className="flex items-center justify-between gap-4">
                  {assessmentId ? (
                    <Link href={`/teacher/assessments/${assessmentId}`} className="text-sm font-medium hover:underline">
                      {assessmentTitle}
                    </Link>
                  ) : (
                    <span className="text-sm font-medium">{assessmentTitle}</span>
                  )}
                  <span className="shrink-0 rounded bg-black/5 px-2 py-0.5 text-xs uppercase tracking-wide dark:bg-white/10">
                    {item.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-black/60 dark:text-white/60">
                  {student ? `Student: ${student}` : "Student: unknown"}
                  {item.question ? ` · Question ${item.question.questionNumber}` : ""}
                </p>
                {item.question?.questionText && (
                  <p className="mt-1 text-xs text-black/50 dark:text-white/50">{item.question.questionText}</p>
                )}
                <p className="mt-2 text-sm">{REASON_COPY[item.reason] ?? item.reason.replaceAll("_", " ").toLowerCase()}</p>
                {detail && <p className="mt-1 text-xs text-black/60 dark:text-white/60">{detail}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
