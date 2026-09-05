import { prisma } from "@/lib/prisma";
import { requireTeacherSession } from "@/lib/require-teacher";
import CreateAssessmentForm from "./CreateAssessmentForm";

export default async function CreateAssessmentPage() {
  const session = await requireTeacherSession();

  const classes = await prisma.class.findMany({
    where: { teacherId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, grade: true, section: true },
  });

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold tracking-tight">
        Create Assessment
      </h1>
      <p className="mt-2 text-sm text-black/60 dark:text-white/60">
        Set up the basics now — you&apos;ll add questions and rubrics next.
      </p>

      <CreateAssessmentForm classes={classes} />
    </div>
  );
}
