import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireTeacherSession } from "@/lib/require-teacher";

export default async function TeacherAssessmentsPage() {
  const session = await requireTeacherSession();

  // Scoped to the authenticated teacher — never all assessments.
  const assessments = await prisma.assessment.findMany({
    where: { teacherId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { questions: true, submissions: true } },
    },
  });

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Assessments</h1>
        <Link
          href="/teacher/assessments/create"
          className="rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white dark:bg-white dark:text-black"
        >
          Create Assessment
        </Link>
      </div>

      {assessments.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-black/15 p-10 text-center dark:border-white/20">
          <p className="text-sm text-black/60 dark:text-white/60">
            You haven&apos;t created any assessments yet.
          </p>
          <Link
            href="/teacher/assessments/create"
            className="mt-4 inline-block rounded-md bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
          >
            Create your first assessment
          </Link>
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {assessments.map((assessment) => (
            <li key={assessment.id}>
              <Link
                href={`/teacher/assessments/${assessment.id}`}
                className="block rounded-lg border border-black/10 p-4 hover:border-black/30 dark:border-white/15 dark:hover:border-white/30"
              >
                <div className="flex items-center justify-between gap-4">
                  <h2 className="font-medium">{assessment.title}</h2>
                  <span className="shrink-0 rounded bg-black/5 px-2 py-0.5 text-xs uppercase tracking-wide dark:bg-white/10">
                    {assessment.status}
                  </span>
                </div>
                <p className="mt-1 text-sm text-black/60 dark:text-white/60">
                  {assessment.subject} &middot; {assessment.grade} &middot;{" "}
                  {assessment.curriculum}
                </p>
                <p className="mt-2 text-xs text-black/50 dark:text-white/50">
                  {assessment._count.questions} question
                  {assessment._count.questions === 1 ? "" : "s"} &middot;{" "}
                  {assessment._count.submissions} submission
                  {assessment._count.submissions === 1 ? "" : "s"} &middot;
                  Created {assessment.createdAt.toLocaleDateString()}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
