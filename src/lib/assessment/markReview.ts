import { parseGradingResult } from "@/lib/pipeline/parseResults";

/**
 * Pure decisions behind the teacher's mark-review screen: how much attention an
 * answer needs, whether a mark a teacher typed is acceptable, and what stands
 * between a submission and being confirmed. No database and no framework, so
 * every rule here is covered by plain unit tests.
 *
 * Decisions D1, D12 and D15 of 06-correction-hardening-plan.md apply: a
 * teacher confirms every mark; marks move in steps of half a mark; and when the
 * system is unsure it says so rather than guessing.
 */

export type AttentionLevel = "CANNOT_READ" | "UNSURE" | "SURE";

export interface AnswerAttention {
  level: AttentionLevel;
  /** Plain-language reasons shown to the teacher, most important first. Empty for a sure answer. */
  reasons: string[];
  /** True when there is no usable mark yet, so the teacher has to enter one rather than accept one. */
  needsMark: boolean;
  /** True once a teacher has accepted or changed this answer's mark. */
  reviewed: boolean;
}

export interface AttentionInput {
  /** The response's stored status, or null when the student has no response row for this question. */
  responseStatus: string | null;
  gradingResult: unknown;
  /** `correctionResult.reading` as persisted by the structured flow, if any. */
  reading: { agreementConfidence?: unknown; structureConfidence?: unknown } | null;
  /** `studentAnswer.uncertain`: the mapping stage was unsure the writing belongs to this question. */
  mappingUncertain: boolean;
  /** Reasons of review items still open against this response. */
  openReviewReasons: string[];
  /**
   * Why the marking itself is doubtful, in plain words: the three marking runs disagreed, the final answer is
   * right but marks were withheld, no working was shown, and so on. Empty when the marking was steady.
   */
  markingReasons?: string[];
}

const REVIEW_REASON_TEXT: Record<string, string> = {
  NOVEL_APPROACH: "The student used a method the scheme does not list.",
  AMBIGUOUS_EXTRACTION: "The answer was hard to read or to match to this question.",
  UNCERTAIN_CORRECTION: "The marking checks disagreed about this answer.",
  VERIFICATION_FAILURE: "Marking this answer failed or could not be confirmed.",
  AMBIGUOUS_ANNOTATION: "It was unclear where to mark this on the page.",
  UNDETERMINED_GRADING: "No mark could be produced for this answer.",
  SCHEME_NOT_APPROVED: "The marking scheme for this question has not been approved, so nothing was marked.",
  SCHEME_CHANGED: "The marking scheme changed after this mark was accepted. Check that it still stands.",
  DIAGRAM_TEACHER_ONLY: "This answer is a diagram or drawing, which the AI does not mark. Look at the page and give a mark.",
  UNSUPPORTED_LANGUAGE: "This answer is not written in English, which is the only language the AI marks. Read the page and give a mark.",
  OTHER: "This answer was flagged for a teacher.",
};

function isHigh(value: unknown): boolean {
  return value === "high";
}

/**
 * How much attention an answer needs. Anything the system is not confident
 * about is routed to the teacher — never the other way round: a SURE answer is
 * one with a mark, a confident reading and nothing flagged against it.
 */
export function classifyAnswer(input: AttentionInput): AnswerAttention {
  const grading = parseGradingResult(input.gradingResult);
  const reviewed = Boolean(grading?.teacherReview);
  const hasUsableMark = input.responseStatus === "GRADED" && grading !== null && grading.outcome === "FINAL";

  if (!hasUsableMark) {
    const reasons = input.openReviewReasons.map((reason) => REVIEW_REASON_TEXT[reason] ?? REVIEW_REASON_TEXT.OTHER);
    if (reasons.length === 0) reasons.push("There is no mark for this answer yet.");
    return { level: "CANNOT_READ", reasons: [...new Set(reasons)], needsMark: true, reviewed: false };
  }

  const reasons: string[] = [];
  for (const reason of input.openReviewReasons) {
    reasons.push(REVIEW_REASON_TEXT[reason] ?? REVIEW_REASON_TEXT.OTHER);
  }
  for (const reason of input.markingReasons ?? []) reasons.push(reason);
  if (input.reading && (!isHigh(input.reading.agreementConfidence) || !isHigh(input.reading.structureConfidence))) {
    reasons.push("The handwriting was hard to read, so the transcription may be wrong.");
  }
  if (input.mappingUncertain) {
    reasons.push("It was unclear which question this writing answers.");
  }

  const unique = [...new Set(reasons)];
  return { level: unique.length > 0 ? "UNSURE" : "SURE", reasons: unique, needsMark: false, reviewed };
}

const LEVEL_RANK: Record<AttentionLevel, number> = { CANNOT_READ: 0, UNSURE: 1, SURE: 2 };

/**
 * Review order (the plan's Stage 4 queue): answers with no mark first, then the
 * ones the system is unsure of, then the sure ones; a question the student did
 * not answer comes last. Within each group, in question order.
 */
export function compareForReview(
  a: { questionNumber: number; answered: boolean; level: AttentionLevel },
  b: { questionNumber: number; answered: boolean; level: AttentionLevel },
): number {
  const rank = (entry: typeof a) => (entry.answered ? LEVEL_RANK[entry.level] : 3);
  return rank(a) - rank(b) || a.questionNumber - b.questionNumber;
}

/** The smallest step a mark may move by (decision D12). */
export const MARK_STEP = 0.5;

export type MarkValidation = { ok: true; marks: number } | { ok: false; message: string };

export function validateTeacherMark(raw: unknown, maximumMarks: number): MarkValidation {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return { ok: false, message: "Enter a valid number of marks." };
  }
  if (raw < 0) return { ok: false, message: "Marks cannot be negative." };
  if (raw > maximumMarks) {
    return { ok: false, message: `Marks cannot exceed the question's maximum of ${maximumMarks}.` };
  }
  // Compared in whole half-marks so 1.5 passes and 1.4 does not, without floating-point surprises.
  const halves = raw / MARK_STEP;
  if (Math.abs(halves - Math.round(halves)) > 1e-9) {
    return { ok: false, message: "Marks must be in steps of 0.5." };
  }
  return { ok: true, marks: Math.round(halves) * MARK_STEP };
}

export interface ConfirmationAnswer {
  questionNumber: number;
  /** What the paper calls it ("3(b)"); falls back to the number. */
  label?: string;
  needsMark: boolean;
  reviewed: boolean;
  /** True for a question the student never answered; confirmation records it as 0 and it needs no separate review. */
  notAnswered: boolean;
}

/** Why a submission cannot be confirmed yet; empty means it can. */
export function confirmationBlockers(answers: ConfirmationAnswer[]): string[] {
  const blockers: string[] = [];
  for (const answer of [...answers].sort((a, b) => a.questionNumber - b.questionNumber)) {
    if (answer.notAnswered) continue;
    if (answer.needsMark) {
      blockers.push(`Question ${answer.label ?? answer.questionNumber} has no mark yet — enter one.`);
    } else if (!answer.reviewed) {
      blockers.push(`Question ${answer.label ?? answer.questionNumber} has not been checked yet.`);
    }
  }
  return blockers;
}

/** Half-mark-safe rounding for totals. */
export function roundMarks(value: number): number {
  return Math.round(value * 100) / 100;
}
