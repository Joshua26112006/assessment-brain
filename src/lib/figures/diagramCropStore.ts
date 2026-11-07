import { prisma } from "@/lib/prisma";
import { loadOrderedAnswerSheetPages } from "@/lib/handwritten/pages";
import { detectStudentDiagrams, type DetectionServices, type DiagramDetection } from "@/lib/figures/studentDiagramDetection";
import { locateDiagramsWithModel } from "@/lib/figures/modelDiagrams";
import { analysePage } from "@/lib/structuredCorrection/annotation/textractPage";
import { newDiagramCropKey, readFigureFile, removeFigureFile, writeFigureFile } from "@/lib/storage/questionFigures";

/**
 * Files the diagrams found on a student's sheet, and finds them for a submission. A fresh finding replaces the one
 * before it, but only after the new crops are safely stored: a failure leaves the earlier crops as they were.
 */

export interface StoredCrop {
  id: string;
  questionId: string | null;
  pageNumber: number;
  confident: boolean;
  foundByInk: boolean;
  foundByModel: boolean;
  adjustedByTeacher: boolean;
  boxLeft: number;
  boxTop: number;
  boxWidth: number;
  boxHeight: number;
}

export async function storeStudentDiagrams(
  submissionId: string,
  detection: DiagramDetection,
  questionIdByNumber: Map<number, string>,
): Promise<number> {
  const earlier = await prisma.diagramCrop.findMany({ where: { submissionId }, select: { id: true, storageKey: true } });

  const createdIds: string[] = [];
  const written: string[] = [];
  try {
    for (const diagram of detection.diagrams) {
      const key = newDiagramCropKey(submissionId);
      // Recorded before the write, so a file is taken back even if its own row is never made.
      written.push(key);
      await writeFigureFile(key, diagram.png);
      const row = await prisma.diagramCrop.create({
        data: {
          submissionId,
          questionId: diagram.questionNumber === null ? null : (questionIdByNumber.get(diagram.questionNumber) ?? null),
          pageNumber: diagram.pageNumber,
          boxLeft: diagram.left,
          boxTop: diagram.top,
          boxWidth: diagram.width,
          boxHeight: diagram.height,
          storageKey: key,
          widthPx: diagram.pixelWidth,
          heightPx: diagram.pixelHeight,
          confident: diagram.confident,
          foundByInk: diagram.foundByInk,
          foundByModel: diagram.foundByModel,
        },
        select: { id: true },
      });
      createdIds.push(row.id);
    }
  } catch (error) {
    await prisma.diagramCrop.deleteMany({ where: { id: { in: createdIds } } });
    await Promise.all(written.map((key) => removeFigureFile(key)));
    throw error;
  }

  if (earlier.length > 0) {
    await prisma.diagramCrop.deleteMany({ where: { id: { in: earlier.map((e) => e.id) } } });
    await Promise.all(earlier.map((e) => removeFigureFile(e.storageKey)));
  }
  return createdIds.length;
}

const REAL_SERVICES: DetectionServices = { analyse: analysePage, locate: locateDiagramsWithModel };

export interface DetectionSummary {
  diagrams: number;
  confident: number;
  notes: string[];
}

/** Finds the diagrams on every page of a submission and files them. Pages the reader said hold a drawing always get the model's opinion. */
export async function detectAndStoreStudentDiagrams(
  submissionId: string,
  assessmentId: string,
  flaggedPages: ReadonlySet<number> = new Set(),
  services: DetectionServices = REAL_SERVICES,
): Promise<DetectionSummary> {
  const pages = await loadOrderedAnswerSheetPages(submissionId);
  const questions = await prisma.question.findMany({
    where: { assessmentId },
    select: { id: true, questionNumber: true, label: true },
    orderBy: { questionNumber: "asc" },
  });
  const detection = await detectStudentDiagrams(
    pages.filter((page) => page.mimeType.startsWith("image/")).map((page) => ({ pageNumber: page.pageNumber, buffer: page.buffer })),
    questions.map((q) => ({ questionNumber: q.questionNumber, label: q.label })),
    services,
    { flaggedPages },
  );
  const stored = await storeStudentDiagrams(submissionId, detection, new Map(questions.map((q) => [q.questionNumber, q.id])));
  return { diagrams: stored, confident: detection.diagrams.filter((d) => d.confident).length, notes: detection.notes };
}

export async function listDiagramCrops(submissionId: string, teacherId: string): Promise<StoredCrop[]> {
  return prisma.diagramCrop.findMany({
    where: { submissionId, submission: { assessment: { teacherId } } },
    orderBy: [{ pageNumber: "asc" }, { boxTop: "asc" }],
    select: { id: true, questionId: true, pageNumber: true, confident: true, foundByInk: true, foundByModel: true, adjustedByTeacher: true, boxLeft: true, boxTop: true, boxWidth: true, boxHeight: true },
  });
}

/** One crop's picture, for the teacher who owns the assessment. */
export async function readCropForTeacher(submissionId: string, cropId: string, teacherId: string): Promise<Buffer | null> {
  const row = await prisma.diagramCrop.findFirst({
    where: { id: cropId, submissionId, submission: { assessment: { teacherId } } },
    select: { storageKey: true },
  });
  return row ? readFigureFile(row.storageKey) : null;
}
