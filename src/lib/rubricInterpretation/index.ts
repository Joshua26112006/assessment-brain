import type {
  InterpretedCheckpoint,
  InterpretedSolutionApproach,
  RubricInterpretationInput,
  RubricInterpretationResult,
  PipelineStage,
} from "@/types/pipeline";
import { extractKeyTerms } from "@/lib/pipeline/text";
import { stageResultBase } from "@/lib/pipeline/stageResult";

/**
 * Parses RubricVersion.solutionApproaches / markingCheckpoints (untyped
 * JSON) into a validated, structured form the correction stage can trust.
 *
 * Mirrors the exact shape the teacher rubric editor writes
 * (src/app/teacher/assessments/[id]/actions.ts):
 *   solutionApproaches: { label: string; description: string }[]
 *   markingCheckpoints: { description: string; marks: number }[]
 *
 * Deliberately read-only/defensive here — a Json column has no static
 * schema, so this stage validates rather than assumes.
 */
export const interpretRubric: PipelineStage<RubricInterpretationInput, RubricInterpretationResult> = (
  input,
) => {
  const warnings: string[] = [];

  const approaches = parseApproaches(input.solutionApproaches, warnings);
  const checkpoints = parseCheckpoints(input.markingCheckpoints, warnings);

  if (approaches.length === 0) {
    warnings.push("No usable solution approaches found on this rubric version.");
  }
  if (checkpoints.length === 0) {
    warnings.push("No usable marking checkpoints found on this rubric version.");
  }

  return {
    ...stageResultBase("RUBRIC_INTERPRETATION", warnings),
    rubricVersionId: input.rubricVersionId,
    approaches,
    checkpoints,
    totalCheckpointMarks: checkpoints.reduce((sum, c) => sum + c.maximumMarks, 0),
  };
};

function parseApproaches(raw: unknown, warnings: string[]): InterpretedSolutionApproach[] {
  if (!Array.isArray(raw)) {
    if (raw !== null && raw !== undefined) {
      warnings.push("solutionApproaches was not an array; ignored.");
    }
    return [];
  }
  return raw
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => {
      const label = typeof item.label === "string" ? item.label.trim() : "";
      const description = typeof item.description === "string" ? item.description.trim() : "";
      return {
        label,
        description,
        keyTerms: extractKeyTerms(`${label} ${description}`),
      };
    })
    .filter((approach) => approach.label || approach.description);
}

function parseCheckpoints(raw: unknown, warnings: string[]): InterpretedCheckpoint[] {
  if (!Array.isArray(raw)) {
    if (raw !== null && raw !== undefined) {
      warnings.push("markingCheckpoints was not an array; ignored.");
    }
    return [];
  }
  return raw
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item, index) => {
      const description = typeof item.description === "string" ? item.description.trim() : "";
      const marks = Number(item.marks);
      return {
        index,
        description,
        maximumMarks: Number.isFinite(marks) && marks >= 0 ? marks : 0,
        keyTerms: extractKeyTerms(description),
      };
    })
    .filter((checkpoint) => checkpoint.description);
}
