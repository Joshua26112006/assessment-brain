"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireTeacherSession } from "@/lib/require-teacher";
import { addFigureUpload, assignFigure, detectAndStorePaperFigures, removeFigure } from "@/lib/figures/figureStore";

export type FigureActionState = { error?: string; success?: string };

const MESSAGE_SEPARATOR = " ";

/** A teacher's own picture for a question: a model diagram (where the student draws) or a figure the finder missed. */
export async function uploadFigureAction(
  assessmentId: string,
  questionId: string,
  role: "QUESTION_FIGURE" | "MODEL_DIAGRAM",
  _prev: FigureActionState,
  formData: FormData,
): Promise<FigureActionState> {
  const session = await requireTeacherSession();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a picture to upload." };

  const result = await addFigureUpload({
    assessmentId,
    teacherId: session.user.id,
    questionId,
    role,
    file: Buffer.from(await file.arrayBuffer()),
  });
  if (!result.ok) return { error: result.message };

  revalidatePath(`/teacher/assessments/${assessmentId}`);
  return { success: role === "MODEL_DIAGRAM" ? "Model diagram added." : "Figure added." };
}

export async function removeFigureAction(assessmentId: string, figureId: string, _prev: FigureActionState): Promise<FigureActionState> {
  const session = await requireTeacherSession();
  const result = await removeFigure({ assessmentId, teacherId: session.user.id, figureId });
  if (!result.ok) return { error: result.message };
  revalidatePath(`/teacher/assessments/${assessmentId}`);
  return { success: "Removed." };
}

export async function assignFigureAction(
  assessmentId: string,
  figureId: string,
  _prev: FigureActionState,
  formData: FormData,
): Promise<FigureActionState> {
  const session = await requireTeacherSession();
  const chosen = String(formData.get("questionId") ?? "");
  if (!chosen) return { error: "Choose the question this figure belongs to." };
  const result = await assignFigure({ assessmentId, teacherId: session.user.id, figureId, questionId: chosen });
  if (!result.ok) return { error: result.message };
  revalidatePath(`/teacher/assessments/${assessmentId}`);
  return { success: "Placed." };
}

/** Looks for the figures of the approved question paper again, replacing the ones found before. Uploads are kept. */
export async function redetectFiguresAction(assessmentId: string, _prev: FigureActionState): Promise<FigureActionState> {
  const session = await requireTeacherSession();
  const owned = await prisma.assessment.findFirst({ where: { id: assessmentId, teacherId: session.user.id }, select: { id: true } });
  if (!owned) return { error: "Assessment not found." };

  try {
    const summary = await detectAndStorePaperFigures(assessmentId);
    revalidatePath(`/teacher/assessments/${assessmentId}`);
    if (summary.status !== "DETECTED") return { error: summary.notes.join(MESSAGE_SEPARATOR) };
    const found = `${summary.figures} figure${summary.figures === 1 ? "" : "s"} found.`;
    return { success: [found, ...summary.notes].join(MESSAGE_SEPARATOR) };
  } catch {
    return { error: "The question paper could not be read for figures. Your uploaded pictures are unchanged." };
  }
}
