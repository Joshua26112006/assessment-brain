import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordCorrectedText } from "@/lib/assessment/correctedReading";
import { ACTIONABLE_REVIEW_STATUSES } from "@/lib/review-scope";
import { createReviewItemIfNeeded } from "@/lib/assessment/pipelineReviewItems";
import { stageResultBase } from "@/lib/pipeline/stageResult";
import { answerTypeOf, exactKeyOf } from "@/lib/questions/answerType";
import { matchExactKey, type ExactKeyResult } from "@/lib/questions/exactKey";
import { mayMarkAgainst } from "@/lib/assessment/schemeGate";
import { schemeOf, type SchemeCriterion } from "@/lib/scheme/criteria";
import type { StructuredExpectation } from "@/types/structuredCorrection";

/**
 * Marks answers that are right or wrong exactly — an option letter, one word, a
 * name, a date, a fill-in (decision D4 of 06-correction-hardening-plan.md) — in
 * CODE, with no model. This runs before the marking routes, which then skip these
 * answers because they are already finished.
 *
 * Code only decides what it is sure of. An exact match earns the marks; a
 * different option letter earns 0. Anything else — a near miss, a different word
 * that might be a valid variant, a doubtful reading of the handwriting — goes to
 * the teacher with what was written and what the key says (decision D15).
 */

const TERMINAL_STATUSES = ["GRADED", "NEEDS_REVIEW", "FAILED"] as const;

export type ExactKeyDecision =
  | { kind: "MARK"; awardedMarks: number; note: string }
  | { kind: "TEACHER"; proposedMarks: number | null; note: string };

export function decideExactKey(args: { result: ExactKeyResult; fullMarks: number; readingUncertain: boolean }): ExactKeyDecision {
  const { result, fullMarks, readingUncertain } = args;

  if (result.verdict === "EMPTY") {
    return { kind: "TEACHER", proposedMarks: null, note: "No answer could be read for this question." };
  }

  // The handwriting itself is in doubt: the reading may be wrong, so even a clean match or miss is not safe to act on.
  if (readingUncertain) {
    const proposed = result.verdict === "MATCH" ? fullMarks : result.verdict === "MISS" ? 0 : null;
    return { kind: "TEACHER", proposedMarks: proposed, note: "The handwriting was hard to read, so this answer was not marked automatically." };
  }

  if (result.verdict === "MATCH") return { kind: "MARK", awardedMarks: fullMarks, note: "Matches the answer key." };
  if (result.verdict === "CLOSE") {
    return { kind: "TEACHER", proposedMarks: null, note: "Close to the answer key but not exact. Check whether it should count." };
  }
  if (result.definite) return { kind: "MARK", awardedMarks: 0, note: "A different option from the answer key." };
  return {
    kind: "TEACHER",
    proposedMarks: 0,
    note: "Different from the answer key. Check whether it is a valid alternative the key does not list.",
  };
}

function readingUncertain(studentAnswer: unknown): boolean {
  if (typeof studentAnswer !== "object" || studentAnswer === null) return true;
  const answer = studentAnswer as { uncertain?: unknown; readingConfidence?: unknown };
  if (answer.uncertain === true) return true;
  return typeof answer.readingConfidence === "number" && answer.readingConfidence < 0.7;
}

function answerTextOf(studentAnswer: unknown): string {
  if (typeof studentAnswer === "object" && studentAnswer !== null && "text" in studentAnswer) {
    const text = (studentAnswer as { text: unknown }).text;
    return typeof text === "string" ? text : "";
  }
  return "";
}

/** Marks every waiting exact-answer response of a submission. Returns how many were dealt with. Never throws. */
export async function markExactKeyAnswers(submissionId: string): Promise<number> {
  try {
    const submission = await prisma.submission.findUnique({ where: { id: submissionId }, select: { assessmentId: true } });
    if (!submission) return 0;

    const responses = await prisma.questionResponse.findMany({
      where: { submissionId, status: { notIn: [...TERMINAL_STATUSES] } },
      select: {
        id: true,
        questionId: true,
        studentAnswer: true,
        question: {
          select: {
            maximumMarks: true,
            answerType: true,
            rubric: {
              select: {
                activeVersion: {
                  select: { approvedAt: true, criteria: true, markingCheckpoints: true, structuredExpectation: true },
                },
              },
            },
          },
        },
      },
    });

    let handled = 0;
    for (const response of responses) {
      const version = response.question.rubric?.activeVersion ?? null;
      // An unapproved scheme is left for the marking routes, which park the answer for the teacher.
      if (!version || !mayMarkAgainst(version)) continue;

      const maximumMarks = Number(response.question.maximumMarks);
      const scheme = schemeOf(version, maximumMarks);
      const expectation = version.structuredExpectation as unknown as StructuredExpectation | null;
      const type = answerTypeOf({
        answerType: response.question.answerType,
        criteria: scheme.criteria,
        numericSolvable: expectation?.solvable === true,
      });
      if (type !== "EXACT_KEY") continue;

      const key = exactKeyOf(scheme.criteria);
      if (!key) continue;

      const result = matchExactKey(answerTextOf(response.studentAnswer), key.accepted);
      const decision = decideExactKey({ result, fullMarks: key.marks, readingUncertain: readingUncertain(response.studentAnswer) });

      const written = await prisma.$transaction(async (tx) => {
        if (decision.kind === "MARK") {
          const updated = await tx.questionResponse.updateMany({
            where: { id: response.id, status: { notIn: [...TERMINAL_STATUSES] } },
            data: {
              status: "GRADED",
              rubricVersionUsedId: null,
              gradingResult: {
                ...stageResultBase("GRADING", [decision.note]),
                awardedMarks: decision.awardedMarks,
                maximumMarks,
                outcome: "FINAL",
                evidenceSource: "DETERMINISTIC",
              } as unknown as object,
              correctionResult: { exactKey: { verdict: result.verdict, matched: result.matched ?? null, definite: result.definite } } as unknown as object,
            },
          });
          if (updated.count === 0) return false;
          await tx.markEvent.create({
            data: {
              kind: "AI_DRAFT",
              submissionId,
              questionResponseId: response.id,
              marks: decision.awardedMarks,
              reason: decision.note,
              payload: { method: "EXACT_KEY", verdict: result.verdict } as unknown as object,
            },
          });
          return true;
        }

        const updated = await tx.questionResponse.updateMany({
          where: { id: response.id, status: { notIn: [...TERMINAL_STATUSES] } },
          data: {
            status: "NEEDS_REVIEW",
            correctionResult: {
              exactKey: { verdict: result.verdict, matched: result.matched ?? null, definite: result.definite, proposedMarks: decision.proposedMarks },
            } as unknown as object,
          },
        });
        return updated.count > 0;
      });

      if (!written) continue;
      handled++;

      if (decision.kind === "TEACHER") {
        await createReviewItemIfNeeded({
          reason: "UNCERTAIN_CORRECTION",
          assessmentId: submission.assessmentId,
          questionId: response.questionId,
          submissionId,
          questionResponseId: response.id,
          context: {
            kind: "EXACT_KEY",
            written: answerTextOf(response.studentAnswer).slice(0, 200),
            acceptedAnswers: key.accepted,
            proposedMarks: decision.proposedMarks,
            detail: decision.note,
          },
        });
      }
    }
    return handled;
  } catch (error) {
    console.error("Could not mark exact-answer questions in code; they will go to the usual marking route", error);
    return 0;
  }
}

/**
 * The teacher corrected what was read for an answer that is right or wrong exactly, so it is marked again, in code, from
 * their text. Only before the marks are confirmed and only for an answer the teacher has not decided. The typed text and
 * the new draft are stored together. The reading is not in doubt any more (a person read it), so a clean match or miss is
 * marked outright; a near miss still goes to the teacher.
 */
export async function redraftExactKey(input: {
  responseId: string;
  submissionId: string;
  assessmentId: string;
  questionId: string;
  teacherId: string;
  text: string;
  maximumMarks: number;
  criteria: SchemeCriterion[];
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const key = exactKeyOf(input.criteria);
  if (!key) return { ok: false, message: "This question has no exact answer key to mark against." };
  const result = matchExactKey(input.text, key.accepted);
  const decision = decideExactKey({ result, fullMarks: key.marks, readingUncertain: false });

  const stored = await prisma.$transaction(async (tx) => {
    const current = await tx.questionResponse.findUnique({
      where: { id: input.responseId },
      select: { status: true, gradingResult: true, submission: { select: { confirmedAt: true } } },
    });
    if (!current || current.submission.confirmedAt || (current.gradingResult as { teacherReview?: unknown } | null)?.teacherReview) return false;
    if (!["GRADED", "NEEDS_REVIEW", "FAILED", "PENDING"].includes(current.status)) return false;

    await tx.questionResponse.update({
      where: { id: input.responseId },
      data:
        decision.kind === "MARK"
          ? {
              status: "GRADED",
              rubricVersionUsedId: null,
              gradingResult: {
                ...stageResultBase("GRADING", [decision.note]),
                awardedMarks: decision.awardedMarks,
                maximumMarks: input.maximumMarks,
                outcome: "FINAL",
                evidenceSource: "DETERMINISTIC",
              } as unknown as object,
              correctionResult: { exactKey: { verdict: result.verdict, matched: result.matched ?? null, definite: result.definite } } as unknown as object,
            }
          : {
              status: "NEEDS_REVIEW",
              // The earlier mark no longer stands, so it must not stay on the answer.
              gradingResult: Prisma.DbNull,
              correctionResult: {
                exactKey: { verdict: result.verdict, matched: result.matched ?? null, definite: result.definite, proposedMarks: decision.proposedMarks },
              } as unknown as object,
            },
    });
    await recordCorrectedText(tx, { responseId: input.responseId, submissionId: input.submissionId, teacherId: input.teacherId, text: input.text });
    if (decision.kind === "MARK") {
      await tx.markEvent.create({
        data: {
          kind: "AI_DRAFT",
          submissionId: input.submissionId,
          questionResponseId: input.responseId,
          marks: decision.awardedMarks,
          reason: decision.note,
          payload: { method: "EXACT_KEY", verdict: result.verdict, redraft: true } as unknown as object,
        },
      });
    }
    // The old reason this answer needed the teacher no longer applies.
    await tx.reviewItem.updateMany({
      where: { questionResponseId: input.responseId, status: { in: [...ACTIONABLE_REVIEW_STATUSES] } },
      data: { status: "RESOLVED", reviewerId: input.teacherId },
    });
    return true;
  });
  if (!stored) return { ok: false, message: "This answer was decided or confirmed meanwhile, so nothing was changed." };

  if (decision.kind === "TEACHER") {
    await createReviewItemIfNeeded({
      reason: "UNCERTAIN_CORRECTION",
      assessmentId: input.assessmentId,
      questionId: input.questionId,
      submissionId: input.submissionId,
      questionResponseId: input.responseId,
      context: { kind: "EXACT_KEY", written: input.text.slice(0, 200), acceptedAnswers: key.accepted, proposedMarks: decision.proposedMarks, detail: decision.note },
    });
  }
  return { ok: true };
}
