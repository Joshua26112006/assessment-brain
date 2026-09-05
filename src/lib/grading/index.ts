import type { GradingInput, GradingResult, PipelineStage } from "@/types/pipeline";
import { stageResultBase } from "@/lib/pipeline/stageResult";

/**
 * Final aggregation/policy step: clamps the correction stage's deterministic
 * total to the question's actual maximum (checkpoint marks are authored
 * independently and aren't guaranteed to sum exactly to
 * Question.maximumMarks), and decides FINAL vs NEEDS_REVIEW from
 * annotation's flag. This is deliberately the only place "final score" is
 * decided — correction produces evidence and a raw total; grading applies
 * the actual policy.
 */
export const gradeResponse: PipelineStage<GradingInput, GradingResult> = (input) => {
  const warnings: string[] = [];

  let awardedMarks = input.correctionTotal;
  if (awardedMarks > input.maximumMarks) {
    warnings.push(
      `Correction total (${input.correctionTotal}) exceeded the question's maximum (${input.maximumMarks}); clamped.`,
    );
    awardedMarks = input.maximumMarks;
  } else if (awardedMarks < 0) {
    warnings.push(`Correction total (${input.correctionTotal}) was negative; clamped to 0.`);
    awardedMarks = 0;
  }

  return {
    ...stageResultBase("GRADING", warnings),
    awardedMarks,
    maximumMarks: input.maximumMarks,
    outcome: input.needsHumanReview ? "NEEDS_REVIEW" : "FINAL",
    evidenceSource: input.evidenceSource,
  };
};
