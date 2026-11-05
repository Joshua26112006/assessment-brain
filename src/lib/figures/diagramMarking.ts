import { prisma } from "@/lib/prisma";
import { VERIFY_MODEL } from "@/lib/ai/models";
import { decideDiagramMark, judgeDiagram, type ReferenceKind } from "@/lib/figures/diagramJudging";
import { figuresForQuestion } from "@/lib/figures/figureStore";
import { readFigureFile } from "@/lib/storage/questionFigures";
import type { SchemeCriterion } from "@/lib/scheme/criteria";
import type { StructuredQuestionCorrection } from "@/lib/structuredCorrection/pipeline";
import type { MarkingDetail } from "@/lib/structuredCorrection/scoring";
import type { ReconciledReading } from "@/types/structuredCorrection";

/**
 * Drafts a mark for a diagram answer, in exactly the shape every other draft mark has, so the teacher's review screen,
 * the audit trail and the marked copy all work as they already do. The answer is flagged for the teacher unless every
 * condition for "very clear" held (diagramJudging.ts); the teacher accepts every mark either way.
 *
 * Returns `held` (no mark) when there is nothing to judge: no diagram was found for the question, or the checker could
 * not complete a single run. A held answer is parked for the teacher exactly as diagram answers always were.
 */

export type DiagramMarkingResult = { correction: StructuredQuestionCorrection } | { held: string };

export function referenceKindOf(roles: Array<"QUESTION_FIGURE" | "MODEL_DIAGRAM">): ReferenceKind {
  const paper = roles.includes("QUESTION_FIGURE");
  const model = roles.includes("MODEL_DIAGRAM");
  return paper && model ? "BOTH" : model ? "MODEL_DIAGRAM" : paper ? "PAPER_FIGURE" : "NONE";
}

/** A plain description of what the drawing showed, written from the criteria, never by a model, so it cannot invent anything. */
export function diagramFeedback(parts: Array<{ description: string; met: "yes" | "no" | "unclear" }>): string {
  const shown = parts.filter((p) => p.met === "yes").map((p) => p.description);
  const missing = parts.filter((p) => p.met !== "yes").map((p) => p.description);
  const lines: string[] = [];
  if (shown.length > 0) lines.push(`Your diagram clearly showed: ${shown.join("; ")}.`);
  if (missing.length > 0) lines.push(`It did not clearly show: ${missing.join("; ")}.`);
  return lines.join(" ");
}

export async function markDiagramAnswer(input: {
  submissionId: string;
  questionId: string;
  questionNumber: number;
  questionText: string;
  subject: string;
  maximumMarks: number;
  criteria: SchemeCriterion[];
}): Promise<DiagramMarkingResult> {
  const crops = await prisma.diagramCrop.findMany({
    where: { submissionId: input.submissionId, questionId: input.questionId },
    orderBy: [{ pageNumber: "asc" }, { boxTop: "asc" }],
    select: { id: true, pageNumber: true, storageKey: true, confident: true },
  });
  if (crops.length === 0) return { held: "No diagram could be found for this question on the answer sheet, so it was not marked automatically." };

  const pictures: Buffer[] = [];
  for (const crop of crops) {
    const picture = await readFigureFile(crop.storageKey);
    if (picture) pictures.push(picture);
  }
  if (pictures.length === 0) return { held: "The cropped diagram is unavailable, so it was not marked automatically." };

  const references = await figuresForQuestion(input.questionId);
  const reference = referenceKindOf(references.map((r) => r.role));

  const runs = await judgeDiagram({
    questionText: input.questionText,
    subject: input.subject,
    maximumMarks: input.maximumMarks,
    criteria: input.criteria,
    studentCrops: pictures,
    references,
  });
  if (runs.length === 0) return { held: "The diagram could not be checked automatically, so it has no draft mark." };

  const cropsConfident = crops.every((crop) => crop.confident);
  const decision = decideDiagramMark({ criteria: input.criteria, runs, cropsConfident, reference });

  const kindById = new Map(input.criteria.map((c) => [c.id, c.kind]));
  const marking: MarkingDetail = {
    criteria: decision.perCriterion.map((c) => ({
      id: c.id,
      kind: kindById.get(c.id) ?? "VALUE_POINT",
      description: c.description,
      maxMarks: c.maxMarks,
      awarded: c.awarded,
      ...(c.evidence ? { evidence: c.evidence } : {}),
      ...(c.met === "unclear" ? { note: "The checker could not tell whether this is drawn, so it is not counted." } : {}),
    })),
    runTotals: decision.runTotals,
    spread: decision.spread,
    unsure: !decision.veryClear,
    reasons: decision.reasons,
    model: VERIFY_MODEL,
    flags: [],
    diagram: { cropIds: crops.map((c) => c.id), reference, legibility: decision.legibility, cropsConfident },
  };

  const confidence = cropsConfident ? "high" : "low";
  const reading: ReconciledReading = {
    questionNumber: input.questionNumber,
    transcription: "[diagram]",
    attempted: true,
    agreementConfidence: confidence,
    problemType: "unknown",
    steps: [],
    variables: {},
    studentAnswer: null,
    structureConfidence: confidence,
    segments: crops.map((crop) => ({ page: crop.pageNumber, status: "active" as const, marked: true, text: "[diagram]" })),
    containsDiagram: true,
    languages: [],
    conflictingAttempts: false,
  };

  return {
    correction: {
      questionId: input.questionId,
      questionNumber: input.questionNumber,
      reading,
      score: {
        awardedMarks: decision.awardedMarks,
        maximumMarks: input.maximumMarks,
        feedback: diagramFeedback(decision.perCriterion),
        marking,
      },
      comparison: { status: "skipped_unsolvable", matchedApproachLabel: null, errors: [], matchedVariableCount: 0, totalExpectedVariableCount: 0 },
      verification: null,
      explanations: [],
      mistakesWithheld: false,
    },
  };
}
