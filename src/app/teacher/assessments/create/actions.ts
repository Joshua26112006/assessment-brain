"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireTeacherSession } from "@/lib/require-teacher";

export type CreateAssessmentState = {
  error?: string;
  fieldErrors?: Partial<
    Record<"title" | "subject" | "grade" | "curriculum" | "classId" | "newClassName", string>
  >;
};

/**
 * Creates an assessment for the authenticated teacher. `Assessment.classId`
 * is required by the schema (an assessment belongs to a class), but this
 * sprint doesn't include full class management — so the caller may either
 * pick an existing class or supply a name for a new one, created inline
 * here rather than through a separate class-management screen.
 */
export async function createAssessment(
  _prevState: CreateAssessmentState,
  formData: FormData,
): Promise<CreateAssessmentState> {
  const session = await requireTeacherSession();

  const title = String(formData.get("title") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const grade = String(formData.get("grade") ?? "").trim();
  const curriculum = String(formData.get("curriculum") ?? "").trim();
  const classId = String(formData.get("classId") ?? "").trim();
  const newClassName = String(formData.get("newClassName") ?? "").trim();

  const fieldErrors: CreateAssessmentState["fieldErrors"] = {};
  if (!title) fieldErrors.title = "Title is required.";
  if (!subject) fieldErrors.subject = "Subject is required.";
  if (!grade) fieldErrors.grade = "Grade is required.";
  if (!curriculum) fieldErrors.curriculum = "Curriculum is required.";
  if (!classId && !newClassName) {
    fieldErrors.classId = "Choose an existing class or name a new one.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors };
  }

  let resolvedClassId = classId;

  if (!resolvedClassId) {
    // Quick-create path: only reachable when the teacher chose "new class."
    const newClass = await prisma.class.create({
      data: {
        name: newClassName,
        grade,
        teacherId: session.user.id,
      },
    });
    resolvedClassId = newClass.id;
  } else {
    // Never trust a client-supplied classId at face value — confirm it's
    // actually one of this teacher's own classes before using it.
    const ownedClass = await prisma.class.findFirst({
      where: { id: resolvedClassId, teacherId: session.user.id },
      select: { id: true },
    });
    if (!ownedClass) {
      return { error: "Select a valid class." };
    }
  }

  const assessment = await prisma.assessment.create({
    data: {
      title,
      subject,
      grade,
      curriculum,
      teacherId: session.user.id, // derived from the session, never from the client
      classId: resolvedClassId,
      // status defaults to DRAFT per the schema — no need to set explicitly
    },
  });

  redirect(`/teacher/assessments/${assessment.id}`);
}
