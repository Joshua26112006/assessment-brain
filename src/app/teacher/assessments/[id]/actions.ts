"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireTeacherSession } from "@/lib/require-teacher";

export type ActionState = { error?: string; success?: boolean };

async function getOwnedAssessment(assessmentId: string, teacherId: string) {
  return prisma.assessment.findFirst({
    where: { id: assessmentId, teacherId },
    select: { id: true },
  });
}

async function getOwnedQuestion(questionId: string, teacherId: string) {
  return prisma.question.findFirst({
    where: { id: questionId, assessment: { teacherId } },
    select: { id: true, assessmentId: true, maximumMarks: true },
  });
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

export async function createQuestion(
  assessmentId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireTeacherSession();

  const owned = await getOwnedAssessment(assessmentId, session.user.id);
  if (!owned) {
    return { error: "Assessment not found." };
  }

  const questionText = String(formData.get("questionText") ?? "").trim();
  const maximumMarksRaw = String(formData.get("maximumMarks") ?? "").trim();
  const maximumMarks = Number(maximumMarksRaw);

  if (!questionText) {
    return { error: "Question text is required." };
  }
  if (!maximumMarksRaw || !Number.isFinite(maximumMarks) || maximumMarks <= 0) {
    return { error: "Maximum marks must be a positive number." };
  }

  const highest = await prisma.question.aggregate({
    where: { assessmentId },
    _max: { questionNumber: true },
  });
  const nextNumber = (highest._max.questionNumber ?? 0) + 1;

  await prisma.question.create({
    data: {
      assessmentId,
      questionNumber: nextNumber,
      questionText,
      maximumMarks,
    },
  });

  revalidatePath(`/teacher/assessments/${assessmentId}`);
  return { success: true };
}

export async function updateQuestion(
  questionId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireTeacherSession();

  const question = await getOwnedQuestion(questionId, session.user.id);
  if (!question) {
    return { error: "Question not found." };
  }

  const questionText = String(formData.get("questionText") ?? "").trim();
  const maximumMarksRaw = String(formData.get("maximumMarks") ?? "").trim();
  const maximumMarks = Number(maximumMarksRaw);
  const questionNumberRaw = String(formData.get("questionNumber") ?? "").trim();
  const questionNumber = Number(questionNumberRaw);

  if (!questionText) {
    return { error: "Question text is required." };
  }
  if (!maximumMarksRaw || !Number.isFinite(maximumMarks) || maximumMarks <= 0) {
    return { error: "Maximum marks must be a positive number." };
  }
  if (!Number.isInteger(questionNumber) || questionNumber <= 0) {
    return { error: "Question number must be a positive whole number." };
  }

  try {
    await prisma.question.update({
      where: { id: questionId },
      data: { questionText, maximumMarks, questionNumber },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { error: `Question number ${questionNumber} is already used in this assessment.` };
    }
    throw error;
  }

  revalidatePath(`/teacher/assessments/${question.assessmentId}`);
  return { success: true };
}

export async function deleteQuestion(
  questionId: string,
  _prevState: ActionState,
): Promise<ActionState> {
  const session = await requireTeacherSession();

  const question = await getOwnedQuestion(questionId, session.user.id);
  if (!question) {
    return { error: "Question not found." };
  }

  try {
    await prisma.question.delete({ where: { id: questionId } });
  } catch (error) {
    // The database's own historical-data protection (QuestionResponse.question
    // is onDelete: Restrict) blocks deleting a question that already has
    // recorded student responses. Surface that as a plain explanation rather
    // than a raw constraint error.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2003" || error.code === "P2014")
    ) {
      return {
        error:
          "This question can't be deleted because student responses already exist for it.",
      };
    }
    throw error;
  }

  revalidatePath(`/teacher/assessments/${question.assessmentId}`);
  return { success: true };
}

// ---------------------------------------------------------------------------
// Rubric
// ---------------------------------------------------------------------------

type SolutionApproach = { label: string; description: string };
type MarkingCheckpoint = { description: string; marks: number };

function parseApproaches(raw: string): SolutionApproach[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (item): item is { label?: unknown; description?: unknown } =>
        typeof item === "object" && item !== null,
    )
    .map((item) => ({
      label: typeof item.label === "string" ? item.label.trim() : "",
      description:
        typeof item.description === "string" ? item.description.trim() : "",
    }))
    .filter((item) => item.label || item.description);
}

function parseCheckpoints(raw: string): MarkingCheckpoint[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (item): item is { description?: unknown; marks?: unknown } =>
        typeof item === "object" && item !== null,
    )
    .map((item) => ({
      description:
        typeof item.description === "string" ? item.description.trim() : "",
      marks: Number(item.marks),
    }))
    .filter(
      (item) => item.description && Number.isFinite(item.marks) && item.marks >= 0,
    );
}

/**
 * Creates a new, active RubricVersion for a question — either the question's
 * first rubric, or a new version of an existing one. Existing versions are
 * never edited in place: the prior active version (if any) is marked
 * SUPERSEDED, and Rubric.activeVersionId is repointed to the new row, all in
 * one transaction so the database's active-version composite FK is always
 * satisfied (the new version must exist before it can be pointed to).
 */
export async function saveRubricVersion(
  questionId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireTeacherSession();

  const question = await getOwnedQuestion(questionId, session.user.id);
  if (!question) {
    return { error: "Question not found." };
  }

  let approaches: SolutionApproach[];
  let checkpoints: MarkingCheckpoint[];
  try {
    approaches = parseApproaches(String(formData.get("approachesJson") ?? "[]"));
    checkpoints = parseCheckpoints(String(formData.get("checkpointsJson") ?? "[]"));
  } catch {
    return { error: "Rubric data was malformed. Please try again." };
  }

  if (approaches.length === 0) {
    return { error: "Add at least one accepted solution approach." };
  }
  if (checkpoints.length === 0) {
    return { error: "Add at least one marking checkpoint." };
  }

  await prisma.$transaction(async (tx) => {
    let rubric = await tx.rubric.findUnique({
      where: { questionId },
      include: { activeVersion: true },
    });

    if (!rubric) {
      rubric = await tx.rubric.create({
        data: { questionId },
        include: { activeVersion: true },
      });
    }

    const highestVersion = await tx.rubricVersion.aggregate({
      where: { rubricId: rubric.id },
      _max: { versionNumber: true },
    });
    const nextVersionNumber = (highestVersion._max.versionNumber ?? 0) + 1;

    const newVersion = await tx.rubricVersion.create({
      data: {
        rubricId: rubric.id,
        versionNumber: nextVersionNumber,
        status: "ACTIVE",
        solutionApproaches: approaches,
        markingCheckpoints: checkpoints,
      },
    });

    if (rubric.activeVersionId) {
      await tx.rubricVersion.update({
        where: { id: rubric.activeVersionId },
        data: { status: "SUPERSEDED" },
      });
    }

    await tx.rubric.update({
      where: { id: rubric.id },
      data: { activeVersionId: newVersion.id },
    });
  });

  revalidatePath(`/teacher/assessments/${question.assessmentId}`);
  return { success: true };
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

export async function publishAssessment(
  assessmentId: string,
  _prevState: ActionState,
): Promise<ActionState> {
  const session = await requireTeacherSession();

  const assessment = await prisma.assessment.findFirst({
    where: { id: assessmentId, teacherId: session.user.id },
    include: {
      questions: {
        include: { rubric: { select: { activeVersionId: true } } },
      },
    },
  });

  if (!assessment) {
    return { error: "Assessment not found." };
  }

  if (assessment.status !== "DRAFT") {
    return { error: `Assessment is already ${assessment.status.toLowerCase()}.` };
  }

  if (assessment.questions.length === 0) {
    return { error: "Add at least one question before publishing." };
  }

  const questionsMissingRubric = assessment.questions.filter(
    (q) => !q.rubric?.activeVersionId,
  );
  if (questionsMissingRubric.length > 0) {
    const numbers = questionsMissingRubric
      .map((q) => q.questionNumber)
      .sort((a, b) => a - b)
      .join(", ");
    return {
      error: `Add a rubric for question${questionsMissingRubric.length > 1 ? "s" : ""} ${numbers} before publishing.`,
    };
  }

  await prisma.assessment.update({
    where: { id: assessmentId },
    data: { status: "PUBLISHED" },
  });

  revalidatePath(`/teacher/assessments/${assessmentId}`);
  revalidatePath("/teacher/assessments");
  revalidatePath("/teacher/dashboard");
  return { success: true };
}
