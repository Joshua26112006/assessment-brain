import Link from "next/link";
import { requireStudentSession } from "@/lib/require-student";
import { getAvailableAssessmentsForStudent } from "@/lib/student-assessment-access";

const SUBMISSION_LABEL: Record<string, string> = {
  DRAFT: "In progress",
  SUBMITTED: "Submitted",
  PROCESSING: "Processing",
  COMPLETED: "Evaluated",
  NEEDS_REVIEW: "Under review",
  FAILED: "Needs attention",
};

export default async function StudentAssessmentsPage() {
  const session = await requireStudentSession();
  const assessments = await getAvailableAssessmentsForStudent(session.user.id);

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Assessments</h1>
      <p className="mt-2 text-sm text-black/60 dark:text-white/60">
        Assessments published by your teachers for classes you belong to.
      </p>

      {assessments.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-black/15 p-10 text-center dark:border-white/20">
          <p className="text-sm text-black/60 dark:text-white/60">
            No assessments are available yet. Check back once your teacher
            publishes one.
          </p>
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {assessments.map((assessment) => (
            <li key={assessment.id}>
              <Link
                href={`/student/assessments/${assessment.id}`}
                className="block rounded-lg border border-black/10 p-4 hover:border-black/30 dark:border-white/15 dark:hover:border-white/30"
              >
                <div className="flex items-center justify-between gap-4">
                  <h2 className="font-medium">{assessment.title}</h2>
                  <span className="shrink-0 rounded bg-black/5 px-2 py-0.5 text-xs uppercase tracking-wide dark:bg-white/10">
                    {assessment.submission
                      ? SUBMISSION_LABEL[assessment.submission.status]
                      : "Not started"}
                  </span>
                </div>
                <p className="mt-1 text-sm text-black/60 dark:text-white/60">
                  {assessment.subject} &middot; {assessment.grade} &middot;{" "}
                  {assessment.curriculum}
                </p>
                <p className="mt-2 text-xs text-black/50 dark:text-white/50">
                  {assessment._count.questions} question
                  {assessment._count.questions === 1 ? "" : "s"}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
