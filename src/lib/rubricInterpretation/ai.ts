import { JUDGE_MODEL } from "@/lib/ai/models";
import { callStructuredAi } from "@/lib/ai/callStructured";
import { stageResultBase } from "@/lib/pipeline/stageResult";
import type { AiCheckpointInterpretation, AiRubricInterpretationResult, InterpretedCheckpoint } from "@/types/pipeline";

interface RawAiRubricInterpretation {
  checkpointInterpretations?: unknown;
  rubricWarnings?: unknown;
}

/**
 * AI-assisted clarification of the teacher-authored rubric — interpretation
 * only, never authority (Phase 2.2 Step 6). Every checkpointIndex the model
 * returns is validated against the real deterministic checkpoints; any
 * that don't match an actual checkpoint are dropped, never trusted as a
 * new criterion.
 */
export async function interpretRubricWithAi(params: {
  questionText: string;
  checkpoints: InterpretedCheckpoint[];
}): Promise<AiRubricInterpretationResult> {
  const validIndices = new Set(params.checkpoints.map((c) => c.index));

  const systemPrompt = [
    "You clarify an existing, teacher-authored marking rubric for a grading system.",
    "You must NOT invent new checkpoints, change any checkpoint's marks, or replace the rubric — only explain the existing checkpoints listed below.",
    "Respond with ONLY a single JSON object, no text before or after it, matching exactly:",
    '{"checkpointInterpretations": [{"checkpointIndex": number, "meaning": "string", "expectedEvidence": ["string", ...]}], "rubricWarnings": ["string", ...]}',
    "checkpointIndex must be one of the exact index values given below — do not invent new ones.",
    "meaning: what satisfying this checkpoint actually requires, in plain terms.",
    "expectedEvidence: concrete things in a student's answer that would count as evidence for this checkpoint.",
    "rubricWarnings: only genuine issues with the rubric as written (e.g. vague wording); empty array if none.",
  ].join("\n");

  const checkpointList = params.checkpoints
    .map((c) => `- index ${c.index}: "${c.description}" (${c.maximumMarks} marks)`)
    .join("\n");
  const userPrompt = `Question:\n${params.questionText}\n\nRubric checkpoints:\n${checkpointList}`;

  const raw = await callStructuredAi<RawAiRubricInterpretation>({
    model: JUDGE_MODEL,
    systemPrompt,
    userPrompt,
  });

  return validate(raw, validIndices);
}

function validate(raw: RawAiRubricInterpretation, validIndices: Set<number>): AiRubricInterpretationResult {
  const rawInterpretations = Array.isArray(raw.checkpointInterpretations) ? raw.checkpointInterpretations : [];

  const checkpointInterpretations: AiCheckpointInterpretation[] = rawInterpretations
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      checkpointIndex: typeof item.checkpointIndex === "number" ? item.checkpointIndex : -1,
      meaning: typeof item.meaning === "string" ? item.meaning : "",
      expectedEvidence: Array.isArray(item.expectedEvidence)
        ? item.expectedEvidence.filter((e): e is string => typeof e === "string")
        : [],
    }))
    // Never trust an AI-invented checkpoint that doesn't exist in the real rubric.
    .filter((item) => validIndices.has(item.checkpointIndex) && item.meaning);

  const rubricWarnings = Array.isArray(raw.rubricWarnings)
    ? raw.rubricWarnings.filter((w): w is string => typeof w === "string")
    : [];

  return {
    ...stageResultBase("RUBRIC_INTERPRETATION_AI"),
    checkpointInterpretations,
    rubricWarnings,
  };
}
