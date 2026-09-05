/**
 * Defensive parsers for reading QuestionResponse's pipeline JSON columns
 * back out for display. These columns are untyped Json in the database —
 * writing them is contract-safe (the orchestrator only ever writes real
 * CorrectionResult/AnnotationResult/GradingResult objects), but reading
 * them back should never assume the stored value still matches the
 * contract (a future contract version bump, partial write, or manual DB
 * edit could all produce something that doesn't parse). Every function
 * here returns null rather than throwing or trusting an unexpected shape.
 */

import type { AnnotationResult, CorrectionResult, GradingResult } from "@/types/pipeline";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseGradingResult(value: unknown): GradingResult | null {
  if (!isRecord(value)) return null;
  if (value.stage !== "GRADING") return null;
  if (typeof value.awardedMarks !== "number") return null;
  if (typeof value.maximumMarks !== "number") return null;
  if (value.outcome !== "FINAL" && value.outcome !== "NEEDS_REVIEW") return null;
  return value as unknown as GradingResult;
}

export function parseAnnotationResult(value: unknown): AnnotationResult | null {
  if (!isRecord(value)) return null;
  if (value.stage !== "ANNOTATION") return null;
  if (!Array.isArray(value.entries)) return null;
  if (typeof value.needsHumanReview !== "boolean") return null;
  return value as unknown as AnnotationResult;
}

export function parseCorrectionResult(value: unknown): CorrectionResult | null {
  if (!isRecord(value)) return null;
  if (value.stage !== "DETERMINISTIC_CORRECTION") return null;
  if (!Array.isArray(value.checkpointResults)) return null;
  if (typeof value.correctionTotal !== "number") return null;
  return value as unknown as CorrectionResult;
}
