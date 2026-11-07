import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { validateCropBox } from "@/lib/figures/cropBox";
import { readAnswerSheetPageContent } from "@/lib/storage/answerSheets";
import { newDiagramCropKey, removeFigureFile, writeFigureFile } from "@/lib/storage/questionFigures";

/**
 * A teacher's own corrections to where a student's diagram is: draw a crop that was missed, redraw one that is wrong, or
 * remove one that is not a diagram. The crop is cut again from the student's original page at full resolution, the
 * teacher's box is certain by definition, and it can be done only while the marks are not yet confirmed.
 */

export type CropAdminResult<T = object> = ({ ok: true } & T) | { ok: false; message: string };

async function openSubmission(submissionId: string, teacherId: string) {
  return prisma.submission.findFirst({
    where: { id: submissionId, assessment: { teacherId } },
    select: { id: true, confirmedAt: true, assessmentId: true },
  });
}

const LOCKED = "These marks are already confirmed. Reopen the submission to change a diagram.";

/** Draws a new crop (cropId null) or replaces the box of an existing one. */
export async function saveTeacherCrop(input: {
  teacherId: string;
  submissionId: string;
  questionId: string;
  cropId: string | null;
  pageNumber: number;
  box: { left: unknown; top: unknown; width: unknown; height: unknown };
}): Promise<CropAdminResult<{ cropId: string }>> {
  const submission = await openSubmission(input.submissionId, input.teacherId);
  if (!submission) return { ok: false, message: "Submission not found." };
  if (submission.confirmedAt) return { ok: false, message: LOCKED };

  const checked = validateCropBox(input.box);
  if (!checked.ok) return checked;

  const question = await prisma.question.findFirst({ where: { id: input.questionId, assessmentId: submission.assessmentId }, select: { id: true } });
  if (!question) return { ok: false, message: "Question not found." };

  const existing = input.cropId
    ? await prisma.diagramCrop.findFirst({ where: { id: input.cropId, submissionId: submission.id }, select: { id: true, storageKey: true, questionId: true } })
    : null;
  if (input.cropId && !existing) return { ok: false, message: "That diagram was not found." };

  const page = await prisma.answerSheetPage.findFirst({
    where: { submissionId: submission.id, pageNumber: input.pageNumber },
    select: { storageKey: true, mimeType: true },
  });
  if (!page || !page.mimeType.startsWith("image/")) return { ok: false, message: "That page was not found." };
  const original = await readAnswerSheetPageContent(page.storageKey);
  if (!original) return { ok: false, message: "That page's file is unavailable." };

  // The page the way a person holds it: the box was drawn on that picture.
  const oriented = await sharp(original).rotate().toBuffer();
  const meta = await sharp(oriented).metadata();
  if (!meta.width || !meta.height) return { ok: false, message: "That page could not be read." };
  const { box } = checked;
  const crop = {
    left: Math.min(meta.width - 1, Math.round(box.left * meta.width)),
    top: Math.min(meta.height - 1, Math.round(box.top * meta.height)),
    width: Math.max(1, Math.round(box.width * meta.width)),
    height: Math.max(1, Math.round(box.height * meta.height)),
  };
  crop.width = Math.min(crop.width, meta.width - crop.left);
  crop.height = Math.min(crop.height, meta.height - crop.top);
  const png = await sharp(oriented).extract(crop).png().toBuffer();

  const key = newDiagramCropKey(submission.id);
  await writeFigureFile(key, png);
  try {
    const data = {
      questionId: input.questionId,
      pageNumber: input.pageNumber,
      boxLeft: box.left,
      boxTop: box.top,
      boxWidth: box.width,
      boxHeight: box.height,
      storageKey: key,
      widthPx: crop.width,
      heightPx: crop.height,
      confident: true,
      adjustedByTeacher: true,
    };
    const row = existing
      ? await prisma.diagramCrop.update({ where: { id: existing.id }, data, select: { id: true } })
      : await prisma.diagramCrop.create({ data: { ...data, submissionId: submission.id, foundByInk: false, foundByModel: false }, select: { id: true } });
    if (existing) await removeFigureFile(existing.storageKey);
    return { ok: true, cropId: row.id };
  } catch (error) {
    await removeFigureFile(key);
    throw error;
  }
}

/** Removes a crop that is not a diagram. */
export async function removeTeacherCrop(input: { teacherId: string; submissionId: string; cropId: string }): Promise<CropAdminResult> {
  const submission = await openSubmission(input.submissionId, input.teacherId);
  if (!submission) return { ok: false, message: "Submission not found." };
  if (submission.confirmedAt) return { ok: false, message: LOCKED };
  const row = await prisma.diagramCrop.findFirst({ where: { id: input.cropId, submissionId: submission.id }, select: { id: true, storageKey: true } });
  if (!row) return { ok: false, message: "That diagram was not found." };
  await prisma.diagramCrop.delete({ where: { id: row.id } });
  await removeFigureFile(row.storageKey);
  return { ok: true };
}
