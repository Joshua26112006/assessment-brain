import { prisma } from "@/lib/prisma";
import { requireTeacherSession } from "@/lib/require-teacher";
import { PageHeader } from "@/components/ui/Page";
import CreateAssessmentForm from "./CreateAssessmentForm";

export const metadata = { title: "Create assessment" };

export default async function CreateAssessmentPage() {
  const session = await requireTeacherSession();

  const classes = await prisma.class.findMany({
    where: { teacherId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, grade: true, section: true },
  });

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        breadcrumb={[
          { label: "Assessments", href: "/teacher/assessments" },
          { label: "New assessment" },
        ]}
        title="Create assessment"
        description="Set up the basics now — you'll add questions and rubrics next."
      />

      <CreateAssessmentForm classes={classes} />
    </div>
  );
}
