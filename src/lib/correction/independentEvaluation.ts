import { VERIFY_MODEL } from "@/lib/ai/models";
import { callStructuredAi } from "@/lib/ai/callStructured";
import { stageResultBase } from "@/lib/pipeline/stageResult";
import type {
  AiCheckpointEvaluation,
  AiCheckpointOutcome,
  IndependentAiEvaluationResult,
  InterpretedCheckpoint,
} from "@/types/pipeline";

const VALID_OUTCOMES = new Set<string>(["satisfied", "partially_satisfied", "not_satisfied", "uncertain"]);

interface RawAiCheckpointEvaluation {
  checkpointIndex?: unknown;
  outcome?: unknown;
  evidence?: unknown;
  reasoning?: unknown;
}

interface RawIndependentEvaluation {
  checkpointEvaluations?: unknown;
  overallObservations?: unknown;
}

/**
 * Independently evaluates the answer against the rubric checkpoints, with
 * no visibility into the deterministic correction result — that's the
 * point: an independent second opinion to compare against, not a
 * confirmation-seeking rerun (Phase 2.2 Step 7). Never trusted as the
 * final grade; the orchestrator only uses this via deterministic
 * comparison and (if needed) verification.
 */
export async function evaluateIndependently(params: {
  questionText: string;
  normalizedAnswerText: string;
  checkpoints: InterpretedCheckpoint[];
  maximumMarks: number;
}): Promise<IndependentAiEvaluationResult> {
  const validIndices = new Set(params.checkpoints.map((c) => c.index));

  const systemPrompt = [
    "You independently evaluate a student's exam answer against a fixed marking rubric.",
    "You must evaluate ONLY the checkpoints listed below — never invent additional requirements or criteria.",
    "You do not decide a final numeric score or grade; another system does that from your evidence.",
    "Respond with ONLY a single JSON object, no text before or after it, matching exactly:",
    '{"checkpointEvaluations": [{"checkpointIndex": number, "outcome": "satisfied" | "partially_satisfied" | "not_satisfied" | "uncertain", "evidence": ["string", ...], "reasoning": "string"}], "overallObservations": ["string", ...]}',
    "checkpointIndex must be one of the exact index values given below.",
    "evidence: direct quotes or close paraphrases from the student's answer that support your outcome — never evidence that isn't actually present in the answer.",
    "reasoning: one concise sentence, not a chain-of-thought transcript.",
    "Use \"uncertain\" when the answer is genuinely ambiguous rather than guessing.",
  ].join("\n");

  const checkpointList = params.checkpoints
    .map((c) => `- index ${c.index}: "${c.description}" (${c.maximumMarks} marks)`)
    .join("\n");
  const userPrompt = [
    `Question (worth ${params.maximumMarks} marks total):\n${params.questionText}`,
    `Rubric checkpoints:\n${checkpointList}`,
    `Student answer:\n${params.normalizedAnswerText}`,
  ].join("\n\n");

  const raw = await callStructuredAi<RawIndependentEvaluation>({
    model: VERIFY_MODEL,
    systemPrompt,
    userPrompt,
    stage: "INDEPENDENT_AI_EVALUATION",
  });

  return validate(raw, validIndices);
}

function validate(raw: RawIndependentEvaluation, validIndices: Set<number>): IndependentAiEvaluationResult {
  const rawEvaluations = Array.isArray(raw.checkpointEvaluations) ? raw.checkpointEvaluations : [];

  const checkpointEvaluations: AiCheckpointEvaluation[] = rawEvaluations
    .filter((item): item is RawAiCheckpointEvaluation => typeof item === "object" && item !== null)
    .map((item) => ({
      checkpointIndex: typeof item.checkpointIndex === "number" ? item.checkpointIndex : -1,
      outcome: typeof item.outcome === "string" && VALID_OUTCOMES.has(item.outcome) ? (item.outcome as AiCheckpointOutcome) : null,
      evidence: Array.isArray(item.evidence) ? item.evidence.filter((e): e is string => typeof e === "string") : [],
      reasoning: typeof item.reasoning === "string" ? item.reasoning : "",
    }))
    // Never trust an evaluation for a checkpoint that doesn't really exist, or with an invalid outcome value.
    .filter((item): item is AiCheckpointEvaluation => item.outcome !== null && validIndices.has(item.checkpointIndex));

  if (checkpointEvaluations.length === 0 && validIndices.size > 0) {
    throw new Error("AI independent evaluation returned no usable checkpoint evaluations.");
  }

  const overallObservations = Array.isArray(raw.overallObservations)
    ? raw.overallObservations.filter((o): o is string => typeof o === "string")
    : [];

  return {
    ...stageResultBase("INDEPENDENT_AI_EVALUATION"),
    checkpointEvaluations,
    overallObservations,
  };
}
