import Link from "next/link";
import { requireStudentSession } from "@/lib/require-student";
import { getAvailableAssessmentsForStudent } from "@/lib/student-assessment-access";
import { PageHeader, EmptyState, Section } from "@/components/ui/Page";
import StatusBadge, { submissionBadge } from "@/components/ui/StatusBadge";
import JoinClassForm from "./JoinClassForm";

export const metadata = { title: "Assessments" };

type StudentAssessment = Awaited<ReturnType<typeof getAvailableAssessmentsForStudent>>[number];

export default async function StudentAssessmentsPage() {
  const session = await requireStudentSession();
  const assessments = await getAvailableAssessmentsForStudent(session.user.id);

  const notStarted = assessments.filter((a) => !a.submission);
  const inProgress = assessments.filter((a) => a.submission?.status === "DRAFT");
  const done = assessments.filter(
    (a) => a.submission && a.submission.status !== "DRAFT",
  );

  return (
    <div>
      <PageHeader
        title="Assessments"
        description="Assessments published by your teachers for classes you belong to."
      />

      {assessments.length === 0 ? (
        <EmptyState
          title="You're not in a class yet"
          description="Assessments are set for a class. Enter the code your teacher gave you to join, then anything they publish will show up here."
          action={<JoinClassForm prominent />}
        />
      ) : (
        <div className="flex flex-col gap-8">
          {inProgress.length > 0 && (
            <Section title="Continue" description="Started but not submitted yet.">
              <AssessmentList assessments={inProgress} cta="Continue" />
            </Section>
          )}
          {notStarted.length > 0 && (
            <Section title="Not started">
              <AssessmentList assessments={notStarted} cta="Start" />
            </Section>
          )}
          {done.length > 0 && (
            <Section title="Submitted" description="Your results appear under Results.">
              <AssessmentList assessments={done} cta="View result" />
            </Section>
          )}

          <Section title="Join another class" description="Already in one class? You can join more.">
            <JoinClassForm />
          </Section>
        </div>
      )}
    </div>
  );
}

function AssessmentList({
  assessments,
  cta,
}: {
  assessments: StudentAssessment[];
  cta: string;
}) {
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {assessments.map((assessment) => {
        const badge = assessment.submission
          ? submissionBadge(assessment.submission.status, "student")
          : null;
        const href =
          assessment.submission && assessment.submission.status !== "DRAFT"
            ? `/student/results/${assessment.submission.id}`
            : `/student/assessments/${assessment.id}`;

        return (
          <li key={assessment.id}>
            <Link
              href={href}
              className="flex h-full flex-col rounded-xl border border-line bg-surface p-5 transition-colors hover:border-line-strong"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-medium leading-snug">{assessment.title}</h3>
                {badge ? (
                  <StatusBadge label={badge.label} tone={badge.tone} size="sm" />
                ) : (
                  <StatusBadge label="Not started" tone="neutral" size="sm" />
                )}
              </div>
              <p className="mt-1.5 text-sm text-muted">
                {assessment.subject} · {assessment.grade} · {assessment.curriculum}
              </p>
              <div className="mt-4 flex items-center justify-between text-xs">
                <span className="text-subtle">
                  {assessment._count.questions} question
                  {assessment._count.questions === 1 ? "" : "s"}
                </span>
                <span className="font-medium text-accent-text">{cta} &rarr;</span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
