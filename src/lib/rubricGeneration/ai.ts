import { JUDGE_MODEL } from "@/lib/ai/models";
import { callStructuredAi } from "@/lib/ai/callStructured";
import {
  buildStructuredExpectationInstructions,
  parseStructuredExpectation,
} from "./structuredExpectation";
import type {
  RawRubricDraft,
  RubricDraft,
  RubricMarkingCheckpoint,
  RubricSolutionApproach,
} from "@/types/rubricGeneration";

/** Everything the generator needs to know about one question, plus light assessment context. */
export interface RubricGenerationInput {
  questionText: string;
  maximumMarks: number;
  subject: string;
  grade: string;
  curriculum: string;
  assessmentTitle: string;
}

const MAX_EXPECTED_ANSWER_LENGTH = 2000;
const MAX_APPROACH_LABEL_LENGTH = 200;
const MAX_APPROACH_DESCRIPTION_LENGTH = 1000;
const MAX_STEP_LENGTH = 500;
const MAX_STEPS_PER_APPROACH = 12;
const MAX_CHECKPOINT_DESCRIPTION_LENGTH = 500;
const MAX_PARTIAL_CREDIT_LENGTH = 1500;
/** Below this, a checkpoint's AI-supplied marks are treated as unusable (see normalizeCheckpointMarks). */
const MARK_EPSILON = 0.01;

const SYSTEM_PROMPT = [
  "You are an expert exam assessor. You design a detailed, structured marking rubric for ONE exam question, for a teacher who will use it to grade real student answers later.",
  "You do not see any student answer here — you only design the marking scheme in advance, from the question itself.",
  "Respond with ONLY a single JSON object, no text before or after it, matching exactly:",
  '{"expectedAnswer": string, "solutionApproaches": [{"label": string, "description": string, "steps": string[], "isPrimary": boolean}], "markingCheckpoints": [{"description": string, "marks": number}], "partialCreditGuidance": string}',
  "",
  "Rules, all mandatory:",
  "1. expectedAnswer: the correct final answer or expected conclusion. For numerical/calculation questions, give the exact numeric answer (and units if applicable). For a question with no single fixed answer (an essay, explanation, or open-ended question), describe what a complete, correct answer must demonstrate instead — never leave this empty.",
  "2. solutionApproaches: at least one entry describing a valid way to reach the expected answer, broken into clear ordered `steps`. Mark exactly one entry isPrimary: true — the most standard/expected method. Only add further entries for approaches that are realistically different and would also deserve full credit; do not invent artificial alternatives where none genuinely exist for this question.",
  "3. markingCheckpoints: break the question's total marks into specific, checkable checkpoints (e.g. \"Correctly identifies the mean formula\", \"Correct final answer\"). Each checkpoint's marks must be a positive number, and the checkpoints' marks MUST sum to exactly the question's maximum marks given below — check your own arithmetic before responding.",
  "4. partialCreditGuidance: a short paragraph, specific to THIS question, on how marks should reasonably be awarded for common partial situations — e.g. a correct method with an arithmetic slip, an incomplete answer, a correct final answer reached without adequate reasoning (only if reasoning genuinely matters for this question), or an incorrect intermediate step. Do not write generic filler that could apply to any question.",
  "5. Never invent facts about the question that aren't implied by its text. Base everything only on the question text, its marks, and the subject/grade context given.",
  "6. Keep the expected answer and checkpoint descriptions concise and specific — this rubric is read by a teacher, not a student.",
].join("\n");

/**
 * Runs AI-assisted rubric generation for one question and returns a
 * validated, structurally-guaranteed-consistent draft. Throws on network/
 * parse failure or on a response that fails validation (caller persists
 * generationStatus FAILED with the message) — this never returns a value
 * that hasn't been checked against real, sane constraints, and never
 * returns checkpoint marks that don't sum to `maximumMarks`.
 */
export async function generateRubricWithAi(input: RubricGenerationInput): Promise<RubricDraft> {
  // Every question also produces a machine-comparable expectation, in the SAME
  // call. Two reasons it isn't gated on the subject: asking for it separately
  // would mean a second model deriving values for a rubric it didn't write,
  // and gating on a subject STRING silently failed in practice — a Statistics
  // paper is mathematics, but no subject-name test recognised it as such. The
  // rubric is the reliable judge of whether a question has one definite
  // checkable answer, so it decides; an essay simply reports solvable: false.
  const systemPrompt = `${SYSTEM_PROMPT}\n${buildStructuredExpectationInstructions()}`;

  const userPrompt = [
    `Subject: ${input.subject}`,
    `Grade/Class: ${input.grade}`,
    `Curriculum: ${input.curriculum}`,
    `Assessment: ${input.assessmentTitle}`,
    "",
    `Question (worth ${input.maximumMarks} marks):`,
    input.questionText,
  ].join("\n");

  const raw = await callStructuredAi<RawRubricDraft>({
    model: JUDGE_MODEL,
    systemPrompt,
    userPrompt,
    temperature: 0.2,
    maxAttempts: 2,
    stage: "RUBRIC_GENERATION",
  });

  const draft = validate(raw, input.maximumMarks);

  return {
    ...draft,
    structuredExpectation: parseStructuredExpectation(raw.structuredExpectation),
  };
}

function toTrimmedString(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

/**
 * Structural validation — never trusts AI output blindly. A malformed or
 * incomplete response throws here rather than silently producing an empty/
 * garbage rubric, so the caller can persist a clear FAILED state instead of
 * a READY one that looks successful but isn't trustworthy.
 */
function validate(raw: RawRubricDraft, maximumMarks: number): Omit<RubricDraft, "structuredExpectation"> {
  const expectedAnswer = toTrimmedString(raw.expectedAnswer, MAX_EXPECTED_ANSWER_LENGTH);
  if (!expectedAnswer) {
    throw new Error("AI rubric response did not include an expected answer.");
  }

  const solutionApproaches = parseApproaches(raw.solutionApproaches);
  if (solutionApproaches.length === 0) {
    throw new Error("AI rubric response did not include any solution approach.");
  }
  if (!solutionApproaches.some((approach) => approach.isPrimary)) {
    solutionApproaches[0].isPrimary = true;
  }

  const rawCheckpoints = parseCheckpoints(raw.markingCheckpoints);
  if (rawCheckpoints.length === 0) {
    throw new Error("AI rubric response did not include any marking checkpoints.");
  }
  if (!(maximumMarks > 0)) {
    throw new Error("The question's maximum marks must be a positive number.");
  }
  const markingCheckpoints = normalizeCheckpointMarks(rawCheckpoints, maximumMarks);

  const partialCreditGuidance =
    toTrimmedString(raw.partialCreditGuidance, MAX_PARTIAL_CREDIT_LENGTH) ||
    defaultPartialCreditGuidance(markingCheckpoints);

  return { expectedAnswer, solutionApproaches, markingCheckpoints, partialCreditGuidance };
}

function parseApproaches(raw: unknown): RubricSolutionApproach[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item): RubricSolutionApproach => ({
      label: toTrimmedString(item.label, MAX_APPROACH_LABEL_LENGTH),
      description: toTrimmedString(item.description, MAX_APPROACH_DESCRIPTION_LENGTH),
      steps: Array.isArray(item.steps)
        ? item.steps
            .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
            .slice(0, MAX_STEPS_PER_APPROACH)
            .map((s) => s.trim().slice(0, MAX_STEP_LENGTH))
        : [],
      isPrimary: item.isPrimary === true,
    }))
    .filter((approach) => approach.label || approach.description || approach.steps.length > 0);
}

function parseCheckpoints(raw: unknown): { description: string; marks: number }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => {
      const description = toTrimmedString(item.description, MAX_CHECKPOINT_DESCRIPTION_LENGTH);
      const marksNumber = Number(item.marks);
      const marks = Number.isFinite(marksNumber) && marksNumber > 0 ? marksNumber : 0;
      return { description, marks };
    })
    .filter((checkpoint) => checkpoint.description);
}

/**
 * Guarantees the returned checkpoints' marks sum to exactly `maximumMarks`,
 * regardless of what the AI actually returned — the safe-normalization
 * strategy required instead of ever persisting an invalid mark total.
 *
 * Scales the AI's own relative weighting when it gave usable (positive)
 * marks; falls back to an even split across checkpoints when it didn't.
 * Either way, rounding drift is absorbed entirely by the last checkpoint so
 * the total is exact rather than merely close.
 */
function normalizeCheckpointMarks(
  checkpoints: { description: string; marks: number }[],
  maximumMarks: number,
): RubricMarkingCheckpoint[] {
  const n = checkpoints.length;
  const round2 = (value: number) => Math.round(value * 100) / 100;
  const sum = checkpoints.reduce((total, c) => total + c.marks, 0);

  let scaled: number[];
  if (sum > MARK_EPSILON) {
    const factor = maximumMarks / sum;
    scaled = checkpoints.map((c) => round2(c.marks * factor));
  } else {
    const even = round2(maximumMarks / n);
    scaled = checkpoints.map(() => even);
  }

  const sumExceptLast = scaled.slice(0, n - 1).reduce((total, v) => total + v, 0);
  scaled[n - 1] = round2(maximumMarks - sumExceptLast);

  // A pathological AI-supplied outlier could in principle push the final,
  // drift-absorbing checkpoint negative — fall back to an exact even split
  // rather than ever persist a negative mark value.
  if (scaled[n - 1] < 0) {
    const even = round2(maximumMarks / n);
    scaled = checkpoints.map(() => even);
    scaled[n - 1] = round2(maximumMarks - even * (n - 1));
  }

  const finalSum = scaled.reduce((total, v) => total + v, 0);
  if (Math.abs(finalSum - maximumMarks) > 0.02) {
    throw new Error("Could not reliably allocate checkpoint marks to match the question's total marks.");
  }

  return checkpoints.map((c, i) => ({ description: c.description, marks: scaled[i] }));
}

function defaultPartialCreditGuidance(checkpoints: RubricMarkingCheckpoint[]): string {
  const namedCheckpoints = checkpoints
    .slice(0, 3)
    .map((c) => c.description)
    .join("; ");
  return `Award each checkpoint independently based on the evidence in the student's answer. A correct method with a minor arithmetic slip should still earn the method-related checkpoints (${namedCheckpoints}${
    checkpoints.length > 3 ? ", …" : ""
  }), even if the final-answer checkpoint is not earned.`;
}
