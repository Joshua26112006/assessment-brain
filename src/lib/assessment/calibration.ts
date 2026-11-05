import { prisma } from "@/lib/prisma";
import { labelOf } from "@/lib/questions/labels";
import { parseGradingResult } from "@/lib/pipeline/parseResults";

/**
 * Calibration (05-workflow.md, Stage 4): for a new scheme or a new teacher, the first 10 to 20 answers are
 * the test of whether the AI marks the way THIS teacher does. Each time the teacher accepts or changes an
 * AI mark, the AI's mark and the teacher's final mark are a pair; enough pairs say how well they agree. If
 * agreement is below the bar, the scheme should be adjusted or that question marked by hand.
 *
 * Informational only: it never changes a mark and never stops anything.
 */

/** How many reviewed answers a question needs before agreement means anything. */
export const CALIBRATION_MIN_ANSWERS = 10;
/**
 * The share of answers that must match the teacher within one mark. The plan's example launch bar is 90%;
 * 80% is used here as the "adjust the scheme or mark it by hand" line until the owner sets the school's own.
 */
export const CALIBRATION_BAR = 0.8;

export interface MarkPair {
  /** The AI's draft mark. */
  ai: number;
  /** The mark the teacher settled on. */
  teacher: number;
}

export interface AgreementStats {
  answers: number;
  /** Identical marks. */
  exact: number;
  /** Within one mark of each other. */
  withinOne: number;
  /** Answers where the teacher changed the AI's mark. */
  changed: number;
  /** Average of (teacher − AI): above 0 the AI is harsher than the teacher, below 0 it is more generous. */
  averageDifference: number;
}

export function summarizeAgreement(pairs: MarkPair[]): AgreementStats {
  const answers = pairs.length;
  if (answers === 0) return { answers: 0, exact: 0, withinOne: 0, changed: 0, averageDifference: 0 };
  const diffs = pairs.map((pair) => Math.round((pair.teacher - pair.ai) * 100) / 100);
  return {
    answers,
    exact: diffs.filter((d) => d === 0).length,
    withinOne: diffs.filter((d) => Math.abs(d) <= 1).length,
    changed: diffs.filter((d) => d !== 0).length,
    averageDifference: Math.round((diffs.reduce((a, b) => a + b, 0) / answers) * 100) / 100,
  };
}

export type CalibrationStatus = "TOO_FEW" | "AGREES" | "BELOW_BAR";

export interface CalibrationVerdict {
  status: CalibrationStatus;
  /** Share within one mark, 0 to 1. */
  share: number;
  /** A plain sentence for the teacher. */
  message: string;
}

export function calibrationVerdict(
  stats: AgreementStats,
  options: { minAnswers?: number; bar?: number } = {},
): CalibrationVerdict {
  const minAnswers = options.minAnswers ?? CALIBRATION_MIN_ANSWERS;
  const bar = options.bar ?? CALIBRATION_BAR;
  const share = stats.answers === 0 ? 0 : stats.withinOne / stats.answers;
  const percent = Math.round(share * 100);

  if (stats.answers < minAnswers) {
    return {
      status: "TOO_FEW",
      share,
      message: `${stats.answers} of the first ${minAnswers} answers reviewed so far. Agreement is shown once ${minAnswers} have been.`,
    };
  }

  const direction =
    stats.averageDifference >= 0.5
      ? " On average the AI marked lower than you."
      : stats.averageDifference <= -0.5
        ? " On average the AI marked higher than you."
        : "";
  if (share < bar) {
    return {
      status: "BELOW_BAR",
      share,
      message: `The AI matched your mark within one mark on ${stats.withinOne} of ${stats.answers} answers (${percent}%), below the ${Math.round(bar * 100)}% line.${direction} Consider adjusting this question's scheme, or marking it yourself.`,
    };
  }
  return {
    status: "AGREES",
    share,
    message: `The AI matched your mark within one mark on ${stats.withinOne} of ${stats.answers} answers (${percent}%).${direction}`,
  };
}

export interface QuestionCalibration {
  questionId: string;
  label: string;
  stats: AgreementStats;
  verdict: CalibrationVerdict;
}

/** Pairs of the AI's draft and the teacher's final mark for every answer a teacher has reviewed. */
export async function loadCalibration(assessmentId: string): Promise<QuestionCalibration[]> {
  const questions = await prisma.question.findMany({
    where: { assessmentId },
    orderBy: { questionNumber: "asc" },
    select: {
      id: true,
      questionNumber: true,
      label: true,
      responses: { where: { submission: { assessmentId } }, select: { gradingResult: true } },
    },
  });

  return questions.flatMap((question): QuestionCalibration[] => {
    const pairs: MarkPair[] = [];
    for (const response of question.responses) {
      const grading = parseGradingResult(response.gradingResult);
      const review = grading?.teacherReview;
      // Only answers the AI actually marked count: a mark a teacher entered from nothing says nothing about the AI.
      if (!grading || !review || review.previousAwardedMarks === null || review.previousAwardedMarks === undefined) continue;
      pairs.push({ ai: review.previousAwardedMarks, teacher: grading.awardedMarks });
    }
    if (pairs.length === 0) return [];
    const stats = summarizeAgreement(pairs);
    return [{ questionId: question.id, label: labelOf(question), stats, verdict: calibrationVerdict(stats) }];
  });
}
