import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireTeacherSession } from "@/lib/require-teacher";

export default async function TeacherDashboardPage() {
  const session = await requireTeacherSession();
  const teacherId = session.user.id;

  const [totalAssessments, draftCount, publishedCount, totalSubmissions, pendingReviewCount, recentAssessments] =
    await Promise.all([
      prisma.assessment.count({ where: { teacherId } }),
      prisma.assessment.count({ where: { teacherId, status: "DRAFT" } }),
      prisma.assessment.count({ where: { teacherId, status: "PUBLISHED" } }),
      prisma.submission.count({ where: { assessment: { teacherId } } }),
      prisma.reviewItem.count({
        where: {
          status: "PENDING",
          OR: [
            { assessment: { teacherId } },
            { question: { assessment: { teacherId } } },
            { submission: { assessment: { teacherId } } },
            { questionResponse: { submission: { assessment: { teacherId } } } },
          ],
        },
      }),
      prisma.assessment.findMany({
        where: { teacherId },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { _count: { select: { questions: true } } },
      }),
    ]);

  const summaryCards = [
    { label: "Total Assessments", value: totalAssessments },
    { label: "Drafts", value: draftCount },
    { label: "Published", value: publishedCount },
    { label: "Total Submissions", value: totalSubmissions },
    { label: "Pending Reviews", value: pendingReviewCount },
  ];

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">
          Teacher Dashboard
        </h1>
        <Link
          href="/teacher/assessments/create"
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
        >
          + Create Assessment
        </Link>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {summaryCards.map((card) => (
          <div
            key={card.label}
            className="rounded-lg border border-black/10 p-4 dark:border-white/15"
          >
            <p className="text-2xl font-semibold">{card.value}</p>
            <p className="mt-1 text-xs text-black/60 dark:text-white/60">
              {card.label}
            </p>
          </div>
        ))}
      </div>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Recent Assessments</h2>
          <Link href="/teacher/assessments" className="text-sm hover:underline">
            View all
          </Link>
        </div>

        {recentAssessments.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-black/15 p-8 text-center dark:border-white/20">
            <p className="text-sm text-black/60 dark:text-white/60">
              No assessments yet. Create your first one to get started.
            </p>
            <Link
              href="/teacher/assessments/create"
              className="mt-4 inline-block rounded-md bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
            >
              Create Assessment
            </Link>
          </div>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {recentAssessments.map((assessment) => (
              <li key={assessment.id}>
                <Link
                  href={`/teacher/assessments/${assessment.id}`}
                  className="flex items-center justify-between rounded-lg border border-black/10 px-4 py-3 hover:border-black/30 dark:border-white/15 dark:hover:border-white/30"
                >
                  <div>
                    <p className="font-medium">{assessment.title}</p>
                    <p className="text-xs text-black/50 dark:text-white/50">
                      {assessment._count.questions} question
                      {assessment._count.questions === 1 ? "" : "s"}
                    </p>
                  </div>
                  <span className="rounded bg-black/5 px-2 py-0.5 text-xs uppercase tracking-wide dark:bg-white/10">
                    {assessment.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
