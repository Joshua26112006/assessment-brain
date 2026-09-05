import { prisma } from "@/lib/prisma";
import { requireTeacherSession } from "@/lib/require-teacher";

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
      assessment: { select: { title: true } },
      question: { select: { questionNumber: true, assessment: { select: { title: true } } } },
      submission: {
        select: {
          student: { select: { name: true } },
          assessment: { select: { title: true } },
        },
      },
    },
  });

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Review Queue</h1>
      <p className="mt-2 text-sm text-black/60 dark:text-white/60">
        Cases the evaluation pipeline flags for your attention will appear
        here once the AI pipeline is implemented.
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
            const assessmentTitle =
              item.assessment?.title ??
              item.question?.assessment.title ??
              item.submission?.assessment.title ??
              "Unknown assessment";
            const student = item.submission?.student.name;

            return (
              <li
                key={item.id}
                className="rounded-lg border border-black/10 p-4 dark:border-white/15"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{assessmentTitle}</span>
                  <span className="rounded bg-black/5 px-2 py-0.5 text-xs uppercase tracking-wide dark:bg-white/10">
                    {item.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-black/60 dark:text-white/60">
                  Reason: {item.reason.replaceAll("_", " ").toLowerCase()}
                  {item.question ? ` · Question ${item.question.questionNumber}` : ""}
                  {student ? ` · Student: ${student}` : ""}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
