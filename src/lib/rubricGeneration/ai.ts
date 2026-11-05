import { JUDGE_MODEL } from "@/lib/ai/models";
import { callStructuredAi, callStructuredAiWithContent } from "@/lib/ai/callStructured";
import { figureContentParts, figureInstructions, type FigurePicture } from "@/lib/figures/figureContent";
import { criteriaWithFallback } from "./criteriaDraft";
import { validateCriteria } from "@/lib/scheme/criteria";
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
  /** The figures printed with the question and the teacher's model diagram, if any. The model is shown them. */
  figures?: FigurePicture[];
}

const MAX_EXPECTED_ANSWER_LENGTH = 2000;
const MAX_APPROACH_LABEL_LENGTH = 200;
const MAX_APPROACH_DESCRIPTION_LENGTH = 1000;
const MAX_STEP_LENGTH = 500;
const MAX_STEPS_PER_APPROACH = 12;
const MAX_CHECKPOINT_DESCRIPTION_LENGTH = 500;
const MAX_PARTIAL_CREDIT_LENGTH = 1500;

const SYSTEM_PROMPT = [
  "You are an expert exam assessor. You design a detailed, structured marking rubric for ONE exam question, for a teacher who will use it to grade real student answers later.",
  "You do not see any student answer here — you only design the marking scheme in advance, from the question itself.",
  "Respond with ONLY a single JSON object, no text before or after it, matching exactly:",
  '{"expectedAnswer": string, "solutionApproaches": [{"label": string, "description": string, "steps": string[], "isPrimary": boolean}], "criteria": [{"kind": string, "description": string, "marks": number, "accepted": string[], "unit": string}], "partialCreditGuidance": string}',
  "",
  "Rules, all mandatory:",
  "1. expectedAnswer: the correct final answer or expected conclusion. For numerical/calculation questions, give the exact numeric answer (and units if applicable). For a question with no single fixed answer (an essay, explanation, or open-ended question), describe what a complete, correct answer must demonstrate instead — never leave this empty.",
  "2. solutionApproaches: at least one entry describing a valid way to reach the expected answer, broken into clear ordered `steps`. Mark exactly one entry isPrimary: true — the most standard/expected method. Only add further entries for approaches that are realistically different and would also deserve full credit; do not invent artificial alternatives where none genuinely exist for this question.",
  "3. criteria: the marking scheme. Break the question's total marks into specific yes/no criteria, each worth a positive number of marks in steps of 0.5, and the criteria's marks MUST sum to exactly the question's maximum marks given below — check your own arithmetic before responding. Give each criterion a `kind`, exactly one of:",
  "   - \"STEP\": a method step the student must show (e.g. \"Writes v = u + at\").",
  "   - \"VALUE\": a correct value substituted or computed along the way (numerical questions).",
  "   - \"FINAL_ANSWER\": the correct final answer (for a numerical question, the number).",
  "   - \"UNIT\": the unit is stated correctly. Add this ONLY when the answer has a unit and the question is worth 2 or more marks; make it worth 0.5. Put the unit in `unit` using standard symbols (e.g. \"m/s^2\", \"J\", \"g\").",
  "   - \"VALUE_POINT\": a fact, idea or point the answer must mention (descriptive questions: \"mentions chlorophyll\").",
  "   - \"LEVEL\": an overall quality band for a long answer or essay (use at most one, worth at least 2 marks, alongside VALUE_POINT criteria).",
  "   - \"EXACT_KEY\": a one-word, name, date, term, option letter or fill-in answer that is right or wrong exactly. List the correct answer and every acceptable spelling or variant in `accepted` (e.g. [\"Jawaharlal Nehru\", \"Nehru\"], [\"B\"]). Such a question normally has this single criterion worth all the marks.",
  "   Use `accepted` only for EXACT_KEY and `unit` only for UNIT; leave them as \"\" or [] otherwise. Do not invent steps the question does not need; a 1-mark question usually has one criterion.",
  "3a. Put marks only on what the QUESTION asks the student to produce. Do not give marks for a check or verification step (\"verifies the answer\", \"checks the atoms balance\") that students do not normally write down, unless the question says \"verify\", \"show\", \"explain\" or \"justify\". For a question that asks only for a result that is recalled rather than worked out (balance an equation, state a value, name a term), a correct result must earn ALL the marks: put them on FINAL_ANSWER (or EXACT_KEY), not on method steps. But for a CALCULATION or any question the student has to work through, keep the method steps (formula, substitution, intermediate result) as their own criteria worth real marks, so a correct method with a slip in the arithmetic still earns the method marks.",
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
  const figures = input.figures ?? [];
  const systemPrompt = `${SYSTEM_PROMPT}\n${buildStructuredExpectationInstructions()}${figureInstructions(figures)}`;

  const userPrompt = [
    `Subject: ${input.subject}`,
    `Grade/Class: ${input.grade}`,
    `Curriculum: ${input.curriculum}`,
    `Assessment: ${input.assessmentTitle}`,
    "",
    `Question (worth ${input.maximumMarks} marks):`,
    input.questionText,
  ].join("\n");

  // With pictures attached the request carries them; with none it is exactly the plain text request it always was.
  const raw =
    figures.length > 0
      ? await callStructuredAiWithContent<RawRubricDraft>({
          model: JUDGE_MODEL,
          systemPrompt,
          userContent: [{ type: "text", text: userPrompt }, ...(await figureContentParts(figures))],
          temperature: 0.2,
          maxAttempts: 2,
          stage: "RUBRIC_GENERATION",
        })
      : await callStructuredAi<RawRubricDraft>({
          model: JUDGE_MODEL,
          systemPrompt,
          userPrompt,
          temperature: 0.2,
          maxAttempts: 2,
          stage: "RUBRIC_GENERATION",
        });

  const draft = validate(raw, input.maximumMarks);
  const structuredExpectation = parseStructuredExpectation(raw.structuredExpectation);

  // A UNIT criterion with no unit of its own takes the unit the key's answer carries.
  const keyUnit = structuredExpectation?.correctAnswer?.unit ?? null;
  const criteria = draft.criteria.map((criterion) =>
    criterion.kind === "UNIT" && !criterion.unit && keyUnit ? { ...criterion, unit: keyUnit } : criterion,
  );

  return { ...draft, criteria, structuredExpectation };
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

  if (!(maximumMarks > 0)) {
    throw new Error("The question's maximum marks must be a positive number.");
  }

  // The model gives each criterion's kind and relative weight; code decides the marks, in half marks,
  // so they add up to exactly the question's maximum. An older-style checkpoint list is still accepted.
  const criteria = criteriaWithFallback(raw.criteria, parseCheckpoints(raw.markingCheckpoints), maximumMarks, expectedAnswer);
  if (criteria.length === 0) {
    throw new Error("AI rubric response did not include any usable marking criteria.");
  }
  const check = validateCriteria(criteria, maximumMarks);
  if (!check.ok) {
    throw new Error(`Could not reliably build marking criteria: ${check.errors[0]}`);
  }
  const markingCheckpoints: RubricMarkingCheckpoint[] = criteria.map((c) => ({ description: c.description, marks: c.marks }));

  const partialCreditGuidance =
    toTrimmedString(raw.partialCreditGuidance, MAX_PARTIAL_CREDIT_LENGTH) ||
    defaultPartialCreditGuidance(markingCheckpoints);

  return { expectedAnswer, solutionApproaches, markingCheckpoints, criteria, partialCreditGuidance };
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

function defaultPartialCreditGuidance(checkpoints: RubricMarkingCheckpoint[]): string {
  const namedCheckpoints = checkpoints
    .slice(0, 3)
    .map((c) => c.description)
    .join("; ");
  return `Award each checkpoint independently based on the evidence in the student's answer. A correct method with a minor arithmetic slip should still earn the method-related checkpoints (${namedCheckpoints}${
    checkpoints.length > 3 ? ", …" : ""
  }), even if the final-answer checkpoint is not earned.`;
}
