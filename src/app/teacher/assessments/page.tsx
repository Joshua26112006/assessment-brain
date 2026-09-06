import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireTeacherSession } from "@/lib/require-teacher";
import { PageHeader, EmptyState } from "@/components/ui/Page";
import StatusBadge, { assessmentBadge } from "@/components/ui/StatusBadge";
import { buttonClass } from "@/components/ui/styles";

export const metadata = { title: "Assessments" };

export default async function TeacherAssessmentsPage() {
  const session = await requireTeacherSession();

  // Scoped to the authenticated teacher — never all assessments.
  const assessments = await prisma.assessment.findMany({
    where: { teacherId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: {
      class: { select: { name: true } },
      _count: { select: { questions: true, submissions: true } },
    },
  });

  const drafts = assessments.filter((a) => a.status === "DRAFT");
  const live = assessments.filter((a) => a.status !== "DRAFT");

  return (
    <div>
      <PageHeader
        title="Assessments"
        description="Everything you've created, newest first."
        actions={
          <Link href="/teacher/assessments/create" className={buttonClass("primary")}>
            Create assessment
          </Link>
        }
      />

      {assessments.length === 0 ? (
        <EmptyState
          title="No assessments yet"
          description="An assessment holds your questions and their rubrics. Once every question has a rubric, you can publish it to a class."
          action={
            <Link href="/teacher/assessments/create" className={buttonClass("primary")}>
              Create your first assessment
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-8">
          {live.length > 0 && <AssessmentGroup title="Published" assessments={live} />}
          {drafts.length > 0 && (
            <AssessmentGroup
              title="Drafts"
              description="Not visible to students yet."
              assessments={drafts}
            />
          )}
        </div>
      )}
    </div>
  );
}

type AssessmentRow = {
  id: string;
  title: string;
  subject: string;
  grade: string;
  curriculum: string;
  status: string;
  createdAt: Date;
  class: { name: string };
  _count: { questions: number; submissions: number };
};

function AssessmentGroup({
  title,
  description,
  assessments,
}: {
  title: string;
  description?: string;
  assessments: AssessmentRow[];
}) {
  return (
    <section>
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        <span className="text-sm text-subtle">{assessments.length}</span>
        {description && <span className="text-sm text-subtle">· {description}</span>}
      </div>
      <ul className="grid gap-3 md:grid-cols-2">
        {assessments.map((assessment) => {
          const badge = assessmentBadge(assessment.status);
          return (
            <li key={assessment.id}>
              <Link
                href={`/teacher/assessments/${assessment.id}`}
                className="flex h-full flex-col rounded-xl border border-line bg-surface p-5 transition-colors hover:border-line-strong"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-medium leading-snug">{assessment.title}</h3>
                  <StatusBadge label={badge.label} tone={badge.tone} size="sm" />
                </div>
                <p className="mt-1.5 text-sm text-muted">
                  {assessment.subject} · {assessment.grade} · {assessment.curriculum}
                </p>
                <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle">
                  <span>{assessment.class.name}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {assessment._count.questions} question
                    {assessment._count.questions === 1 ? "" : "s"}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {assessment._count.submissions} submission
                    {assessment._count.submissions === 1 ? "" : "s"}
                  </span>
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
