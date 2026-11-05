import { prisma } from "@/lib/prisma";
import { parseLabel } from "@/lib/questions/labels";
import { detectPaperFigures, type FigureDetection } from "@/lib/figures/paperFigures";
import {
  newFigureKey,
  prepareFigureUpload,
  readFigureFile,
  removeFigureFile,
  writeFigureFile,
} from "@/lib/storage/questionFigures";
import { readQuestionPaperPageContent } from "@/lib/storage/questionPapers";

/**
 * Keeps the figures of an assessment: the ones found in its digital question paper, and the teacher's own uploads
 * (a model diagram for a question where the student draws; a replacement when a figure was missed or badly cropped).
 * Every function takes the assessment and checks the teacher owns it, so a figure id alone never gives access.
 */

export interface FigureView {
  id: string;
  questionId: string | null;
  role: "QUESTION_FIGURE" | "MODEL_DIAGRAM";
  source: "PDF_DETECTED" | "TEACHER_UPLOAD";
  pageNumber: number | null;
}

export type FigureResult<T = object> = ({ ok: true } & T) | { ok: false; message: string };

async function ownedAssessment(assessmentId: string, teacherId: string) {
  return prisma.assessment.findFirst({ where: { id: assessmentId, teacherId }, select: { id: true } });
}

export async function listFigures(assessmentId: string, teacherId: string): Promise<FigureView[]> {
  const rows = await prisma.questionFigure.findMany({
    where: { assessmentId, assessment: { teacherId } },
    orderBy: [{ pageNumber: "asc" }, { boxTop: "asc" }, { createdAt: "asc" }],
    select: { id: true, questionId: true, role: true, source: true, pageNumber: true },
  });
  return rows;
}

/** The picture of one figure, for the teacher who owns it. */
export async function readFigureForTeacher(assessmentId: string, figureId: string, teacherId: string): Promise<Buffer | null> {
  const row = await prisma.questionFigure.findFirst({
    where: { id: figureId, assessmentId, assessment: { teacherId } },
    select: { storageKey: true },
  });
  return row ? readFigureFile(row.storageKey) : null;
}

/**
 * The whole of a numbered question's figures for a part: a figure printed after "1(a)" is also what "1(b)" refers to,
 * so a part is given the figures of every part that shares its number.
 */
export function sharesNumber(labelA: string | null | undefined, labelB: string | null | undefined): boolean {
  if (!labelA || !labelB) return false;
  const a = parseLabel(labelA, { loose: true });
  const b = parseLabel(labelB, { loose: true });
  return a !== null && b !== null && a.number !== null && a.number === b.number;
}

/** The pictures a question should be shown with: its own figures and those of the other parts of its numbered question. */
export async function figuresForQuestion(questionId: string): Promise<Array<{ role: "QUESTION_FIGURE" | "MODEL_DIAGRAM"; png: Buffer }>> {
  const question = await prisma.question.findUnique({ where: { id: questionId }, select: { assessmentId: true, label: true } });
  if (!question) return [];
  const all = await prisma.questionFigure.findMany({
    where: { assessmentId: question.assessmentId, questionId: { not: null } },
    orderBy: [{ pageNumber: "asc" }, { boxTop: "asc" }, { createdAt: "asc" }],
    select: { questionId: true, role: true, storageKey: true, question: { select: { label: true } } },
  });
  const wanted = all.filter((figure) => {
    if (figure.questionId === questionId) return true;
    // Another part's printed figure is shared; another part's model diagram answers that part only.
    return figure.role === "QUESTION_FIGURE" && sharesNumber(question.label, figure.question?.label);
  });
  const out: Array<{ role: "QUESTION_FIGURE" | "MODEL_DIAGRAM"; png: Buffer }> = [];
  for (const figure of wanted) {
    const png = await readFigureFile(figure.storageKey);
    if (png) out.push({ role: figure.role, png });
  }
  return out;
}

/** Stores what the figure finder found, replacing what an earlier finding left for this assessment. */
export async function storeDetectedFigures(
  assessmentId: string,
  detection: FigureDetection,
  questionIdByNumber: Map<number, string>,
): Promise<number> {
  const earlier = await prisma.questionFigure.findMany({
    where: { assessmentId, source: "PDF_DETECTED" },
    select: { id: true, storageKey: true },
  });

  const created: Array<{ id: string; key: string }> = [];
  const written: string[] = [];
  try {
    for (const figure of detection.figures) {
      const key = newFigureKey(assessmentId);
      // Recorded before the write, so a file is taken back even if its own database row never gets made.
      written.push(key);
      await writeFigureFile(key, figure.png);
      const row = await prisma.questionFigure.create({
        data: {
          assessmentId,
          questionId: figure.questionNumber === null ? null : (questionIdByNumber.get(figure.questionNumber) ?? null),
          role: "QUESTION_FIGURE",
          source: "PDF_DETECTED",
          pageNumber: figure.pageNumber,
          boxLeft: figure.left,
          boxTop: figure.top,
          boxWidth: figure.width,
          boxHeight: figure.height,
          storageKey: key,
          mimeType: "image/png",
          widthPx: figure.pixelWidth,
          heightPx: figure.pixelHeight,
        },
        select: { id: true },
      });
      created.push({ id: row.id, key });
    }
  } catch (error) {
    // Half a finding is worse than none: take back what this attempt wrote and keep the earlier figures.
    await prisma.questionFigure.deleteMany({ where: { id: { in: created.map((c) => c.id) } } });
    await Promise.all(written.map((key) => removeFigureFile(key)));
    throw error;
  }

  // Only now, with the new figures safely stored, are the earlier detected ones removed.
  if (earlier.length > 0) {
    await prisma.questionFigure.deleteMany({ where: { id: { in: earlier.map((e) => e.id) } } });
    await Promise.all(earlier.map((e) => removeFigureFile(e.storageKey)));
  }
  return created.length;
}

export interface DetectSummary {
  status: "DETECTED" | "NOT_A_PDF" | "NO_PAPER";
  figures: number;
  notes: string[];
}

/** Finds the figures of the assessment's approved digital question paper and stores them. Never throws on a bad PDF. */
export async function detectAndStorePaperFigures(assessmentId: string): Promise<DetectSummary> {
  const paper = await prisma.questionPaper.findFirst({
    where: { assessmentId, extractionStatus: "APPROVED" },
    orderBy: { createdAt: "desc" },
    include: { pages: { orderBy: { pageNumber: "asc" } } },
  });
  if (!paper || paper.pages.length === 0) return { status: "NO_PAPER", figures: 0, notes: ["There is no approved question paper."] };

  const pdfPage = paper.pages.find((page) => page.mimeType === "application/pdf");
  if (!pdfPage) {
    return {
      status: "NOT_A_PDF",
      figures: 0,
      notes: ["This question paper was uploaded as pictures, not a PDF, so its figures were not found automatically. You can upload a figure for a question yourself."],
    };
  }

  const content = await readQuestionPaperPageContent(pdfPage.storageKey);
  if (!content) return { status: "NO_PAPER", figures: 0, notes: ["The question paper's file is unavailable."] };

  const questions = await prisma.question.findMany({
    where: { assessmentId },
    select: { id: true, questionNumber: true, label: true },
    orderBy: { questionNumber: "asc" },
  });
  const detection = await detectPaperFigures(
    content,
    questions.map((q) => ({ questionNumber: q.questionNumber, label: q.label })),
  );
  const stored = await storeDetectedFigures(assessmentId, detection, new Map(questions.map((q) => [q.questionNumber, q.id])));
  return { status: "DETECTED", figures: stored, notes: detection.notes };
}

/** A teacher's own picture for a question: a model diagram, or a figure the finder missed. */
export async function addFigureUpload(input: {
  assessmentId: string;
  teacherId: string;
  questionId: string;
  role: "QUESTION_FIGURE" | "MODEL_DIAGRAM";
  file: Buffer;
}): Promise<FigureResult<{ figureId: string }>> {
  if (!(await ownedAssessment(input.assessmentId, input.teacherId))) return { ok: false, message: "Assessment not found." };
  const question = await prisma.question.findFirst({ where: { id: input.questionId, assessmentId: input.assessmentId }, select: { id: true } });
  if (!question) return { ok: false, message: "Question not found." };

  const prepared = await prepareFigureUpload(input.file);
  if (!prepared.ok) return prepared;

  const key = newFigureKey(input.assessmentId);
  await writeFigureFile(key, prepared.png);
  try {
    const row = await prisma.questionFigure.create({
      data: {
        assessmentId: input.assessmentId,
        questionId: input.questionId,
        role: input.role,
        source: "TEACHER_UPLOAD",
        storageKey: key,
        mimeType: "image/png",
        widthPx: prepared.widthPx,
        heightPx: prepared.heightPx,
      },
      select: { id: true },
    });
    return { ok: true, figureId: row.id };
  } catch (error) {
    await removeFigureFile(key);
    throw error;
  }
}

export async function removeFigure(input: { assessmentId: string; teacherId: string; figureId: string }): Promise<FigureResult> {
  const row = await prisma.questionFigure.findFirst({
    where: { id: input.figureId, assessmentId: input.assessmentId, assessment: { teacherId: input.teacherId } },
    select: { id: true, storageKey: true },
  });
  if (!row) return { ok: false, message: "Figure not found." };
  await prisma.questionFigure.delete({ where: { id: row.id } });
  await removeFigureFile(row.storageKey);
  return { ok: true };
}

/** Puts a figure under a question (or back to none). */
export async function assignFigure(input: { assessmentId: string; teacherId: string; figureId: string; questionId: string | null }): Promise<FigureResult> {
  const row = await prisma.questionFigure.findFirst({
    where: { id: input.figureId, assessmentId: input.assessmentId, assessment: { teacherId: input.teacherId } },
    select: { id: true },
  });
  if (!row) return { ok: false, message: "Figure not found." };
  if (input.questionId !== null) {
    const question = await prisma.question.findFirst({ where: { id: input.questionId, assessmentId: input.assessmentId }, select: { id: true } });
    if (!question) return { ok: false, message: "Question not found." };
  }
  await prisma.questionFigure.update({ where: { id: row.id }, data: { questionId: input.questionId } });
  return { ok: true };
}
