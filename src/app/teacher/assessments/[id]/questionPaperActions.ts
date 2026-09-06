"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireTeacherSession } from "@/lib/require-teacher";
import { findCurrentQuestionPaperForTeacher } from "@/lib/questionPaperAccess";
import { runQuestionPaperExtraction } from "@/lib/questionPaperExtraction";
import { generateRubricsForQuestions } from "@/lib/rubricGeneration";

export type QuestionPaperActionState = { error?: string; success?: boolean };

/**
 * Re-runs AI extraction on the already-uploaded pages, without requiring the
 * teacher to upload the file again (Step 14). Only valid from FAILED or
 * EXTRACTED (a fresh attempt is also a reasonable thing to want after a
 * successful-but-unsatisfying read) — never from PROCESSING (already
 * running) or APPROVED (terminal; the draft is no longer live).
 */
export async function retryExtraction(
  assessmentId: string,
  _prevState: QuestionPaperActionState,
): Promise<QuestionPaperActionState> {
  const session = await requireTeacherSession();

  const current = await findCurrentQuestionPaperForTeacher(assessmentId, session.user.id);
  if (!current) {
    return { error: "No question paper found for this assessment." };
  }
  if (current.extractionStatus === "PROCESSING") {
    return { error: "Extraction is already running." };
  }
  if (current.extractionStatus === "APPROVED") {
    return { error: "This question paper has already been approved." };
  }

  // Atomic compare-and-swap, matching approveExtraction's reasoning: two
  // near-simultaneous retry clicks (double-click, or two open tabs) could
  // otherwise both pass the checks above before either writes PROCESSING,
  // launching two concurrent extraction runs against the same row whose
  // results would race to overwrite each other. An UPDATE ... WHERE
  // extractionStatus IN (...) takes a row lock, so only one such request
  // can ever flip the status; the other sees count 0 and backs off cleanly.
  const claimed = await prisma.questionPaper.updateMany({
    where: { id: current.id, extractionStatus: { in: ["FAILED", "EXTRACTED"] } },
    data: { extractionStatus: "PROCESSING", extractionError: null },
  });
  if (claimed.count === 0) {
    return { error: "Extraction is already running." };
  }

  const questionPaperId = current.id;
  after(async () => {
    await runQuestionPaperExtraction(questionPaperId);
  });

  revalidatePath(`/teacher/assessments/${assessmentId}`);
  return { success: true };
}

interface DraftQuestionInput {
  number?: unknown;
  text?: unknown;
  marks?: unknown;
}

function parseDraftQuestions(raw: string): { number: number; text: string; marks: number | null }[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("Questions must be a list.");
  }

  return (parsed as DraftQuestionInput[]).map((item, index) => {
    const number = Number(item.number);
    const text = typeof item.text === "string" ? item.text.trim() : "";
    const marksRaw = item.marks;

    if (!Number.isInteger(number) || number <= 0) {
      throw new Error(`Question ${index + 1}: number must be a positive whole number.`);
    }
    if (!text) {
      throw new Error(`Question ${index + 1} (number ${number}): question text is required.`);
    }

    let marks: number | null = null;
    if (marksRaw !== null && marksRaw !== "" && marksRaw !== undefined) {
      const marksNumber = Number(marksRaw);
      if (!Number.isFinite(marksNumber) || marksNumber <= 0) {
        throw new Error(`Question ${number}: marks must be a positive number, or left blank.`);
      }
      marks = marksNumber;
    }

    return { number, text: text.slice(0, 4000), marks };
  });
}

/**
 * Approves a reviewed extraction draft: validates the final (teacher-edited)
 * data again server-side (Step 12.1 — never trusts what was merely
 * displayed), then creates the real Assessment Questions from it in one
 * transaction, each with a companion Rubric row (status PENDING) so the
 * detail page can immediately show "generating a rubric" rather than "no
 * rubric" while the background AI generation below is still starting up.
 * Idempotent by design: a second approval click (double-click, or a
 * resubmitted form after the first response already landed) is detected via
 * the QuestionPaper's own status and treated as a no-op success rather than
 * creating duplicate Questions or surfacing a scary error for what the
 * teacher experiences as "nothing happened, so I tried again."
 *
 * Phase 4.1: once the transaction commits, kicks off automatic AI rubric
 * generation for every newly-created question in the background (after the
 * response is sent — the teacher isn't made to wait), mirroring the exact
 * background-task pattern already used for extraction itself and for
 * handwritten-submission processing. The teacher is never required to write
 * a rubric by hand for these questions.
 */
export async function approveExtraction(
  assessmentId: string,
  _prevState: QuestionPaperActionState,
  formData: FormData,
): Promise<QuestionPaperActionState> {
  const session = await requireTeacherSession();
  const teacherId = session.user.id;

  const current = await findCurrentQuestionPaperForTeacher(assessmentId, teacherId);
  if (!current) {
    return { error: "No question paper found for this assessment." };
  }
  if (current.extractionStatus === "APPROVED") {
    // Already done — most likely a duplicate click. Treat as success so the
    // UI doesn't show an alarming error for something that already worked.
    return { success: true };
  }
  if (current.extractionStatus !== "EXTRACTED") {
    return { error: "This question paper isn't ready to approve yet." };
  }

  let questions: { number: number; text: string; marks: number | null }[];
  try {
    questions = parseDraftQuestions(String(formData.get("questionsJson") ?? "[]"));
  } catch (error) {
    return { error: error instanceof Error ? error.message : "The reviewed questions were malformed." };
  }

  if (questions.length === 0) {
    return { error: "Add at least one question before approving." };
  }
  if (questions.some((q) => q.marks === null)) {
    return { error: "Every question needs marks before approving — fill in any blanks." };
  }

  const numbers = questions.map((q) => q.number);
  const duplicateNumbers = numbers.filter((n, i) => numbers.indexOf(n) !== i);
  if (duplicateNumbers.length > 0) {
    return {
      error: `Question number${duplicateNumbers.length > 1 ? "s" : ""} ${[...new Set(duplicateNumbers)].join(", ")} ${duplicateNumbers.length > 1 ? "are" : "is"} used more than once — each must be unique.`,
    };
  }

  const existingQuestions = await prisma.question.findMany({
    where: { assessmentId },
    select: { questionNumber: true },
  });
  const existingNumbers = new Set(existingQuestions.map((q) => q.questionNumber));
  const collisions = numbers.filter((n) => existingNumbers.has(n));
  if (collisions.length > 0) {
    return {
      error: `Question number${collisions.length > 1 ? "s" : ""} ${[...new Set(collisions)].join(", ")} ${collisions.length > 1 ? "are" : "is"} already used by an existing question in this assessment. Renumber before approving.`,
    };
  }

  const title = String(formData.get("title") ?? "").trim();
  const instructionsRaw = String(formData.get("instructions") ?? "").trim();

  let createdQuestionIds: string[] = [];
  try {
    createdQuestionIds = await prisma.$transaction(async (tx) => {
      // Atomic compare-and-swap, not a plain read-then-write: a SELECT here
      // (even inside a transaction) takes no row lock under PostgreSQL's
      // default READ COMMITTED isolation, so two genuinely concurrent
      // approval requests could both observe EXTRACTED and both proceed —
      // creating duplicate Questions. An UPDATE ... WHERE extractionStatus
      // = 'EXTRACTED' does take a row lock: only one concurrent transaction
      // can ever match and flip the status, so `claimed.count === 0`
      // reliably means someone else already claimed (or is claiming) this
      // approval, and no Questions are created on this path.
      const claimed = await tx.questionPaper.updateMany({
        where: { id: current.id, extractionStatus: "EXTRACTED" },
        data: { extractionStatus: "APPROVED", approvedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new AlreadyApprovedRaceError();
      }

      await tx.question.createMany({
        data: questions.map((q) => ({
          assessmentId,
          questionNumber: q.number,
          questionText: q.text,
          maximumMarks: q.marks as number,
        })),
      });

      // createMany doesn't return the created rows, so look them up by the
      // (assessmentId, questionNumber) pairs just inserted — already
      // validated above as unique within this batch and not colliding with
      // any pre-existing question, so this unambiguously identifies exactly
      // the rows this call just created.
      const created = await tx.question.findMany({
        where: { assessmentId, questionNumber: { in: numbers } },
        select: { id: true },
      });

      await tx.rubric.createMany({
        data: created.map((q) => ({ questionId: q.id })),
      });

      const assessmentUpdate: { title?: string; instructions?: string | null } = {};
      if (title) assessmentUpdate.title = title.slice(0, 300);
      assessmentUpdate.instructions = instructionsRaw ? instructionsRaw.slice(0, 4000) : null;
      await tx.assessment.update({ where: { id: assessmentId }, data: assessmentUpdate });

      return created.map((q) => q.id);
    });
  } catch (error) {
    if (error instanceof AlreadyApprovedRaceError) {
      return { success: true };
    }
    // A question number collided with one created elsewhere (e.g. a manual
    // Add-question in another tab) in the narrow window between the
    // pre-check above and this transaction — surfaced as a clear, retryable
    // message rather than an unhandled exception reaching the error boundary.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return {
        error:
          "One of these question numbers was just used by another question. Please review the numbers and try approving again.",
      };
    }
    throw error;
  }

  after(async () => {
    await generateRubricsForQuestions(createdQuestionIds);
  });

  revalidatePath(`/teacher/assessments/${assessmentId}`);
  return { success: true };
}

class AlreadyApprovedRaceError extends Error {}
