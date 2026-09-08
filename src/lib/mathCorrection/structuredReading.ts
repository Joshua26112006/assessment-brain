import type { ChatCompletionContentPart } from "openai/resources/chat/completions";
import { READ_MODEL } from "@/lib/ai/models";
import { callStructuredAiWithContent } from "@/lib/ai/callStructured";
import { parseNumericExpression } from "@/lib/mathCorrection/numericExpression";
import { reconcileByKey, type ReconciledEntry } from "@/lib/mathCorrection/reconcile";
import {
  MATH_PROBLEM_TYPES,
  type ExtractedValue,
  type MathProblemType,
  type ReconciledMathReading,
  type ReconcileConfidence,
} from "@/types/mathCorrection";
import type { HandwrittenPageInput } from "@/lib/handwritten/types";

/**
 * Stage 1 of the Mathematics correction flow: read each question's working off
 * the student's pages and decompose it into named quantities and a final
 * value, so a later deterministic stage can compare it against the rubric.
 *
 * Read TWICE and reconciled (see reconcile.ts). A single vision-model pass
 * over handwriting is not reliably repeatable — the same upload can disagree
 * with itself about whether a question was even attempted — and every stage
 * downstream depends on these extracted values, so an unverified single read
 * would put an unmeasured error rate underneath the whole pipeline.
 *
 * Extraction only. This stage never solves the question, never consults the
 * rubric, and never judges correctness: it reports what the student wrote.
 * Keeping it ignorant of the expected answer is what stops it from quietly
 * "reading" the answer the rubric wanted to see.
 */

const MAX_TRANSCRIPTION_LENGTH = 4000;
const MAX_STEPS = 30;
const MAX_STEP_LENGTH = 500;
const MAX_VARIABLES = 40;
const MAX_VALUE_LENGTH = 200;

interface RawStructuredReadingEntry {
  questionNumber?: unknown;
  attempted?: unknown;
  transcription?: unknown;
  problemType?: unknown;
  steps?: unknown;
  variables?: unknown;
  studentAnswer?: unknown;
  structureConfidence?: unknown;
}

interface RawStructuredReadingResponse {
  answers?: unknown;
}

/** One question as a single pass read it, before any cross-pass reconciliation. */
interface SinglePassReading {
  questionNumber: number;
  attempted: boolean;
  transcription: string;
  problemType: MathProblemType;
  steps: string[];
  variables: Record<string, ExtractedValue>;
  studentAnswer: ExtractedValue | null;
  structureConfidence: ReconcileConfidence;
}

export interface MathReadingQuestion {
  questionNumber: number;
  questionText: string;
}

function buildSystemPrompt(): string {
  return [
    "You are reading a student's handwritten Mathematics answer sheet (multiple photographed pages, in order) so that a separate program can check their working.",
    "You are NOT grading. Never judge whether anything is correct, never award marks, never correct the student's values, and never solve any question yourself.",
    "Respond with ONLY a single JSON object, no text before or after it, matching exactly:",
    '{"answers": [{"questionNumber": number, "attempted": boolean, "transcription": string, "problemType": string, "steps": [string], "variables": {"<name>": "<value>"}, "studentAnswer": string, "structureConfidence": "high" | "medium" | "low"}]}',
    "",
    "Rules, all mandatory:",
    "1. Include exactly one entry for every question number listed below, in ascending order — even the ones the student did not answer.",
    "2. attempted: false only when you find no written work for that question anywhere on the pages. When false, use an empty transcription, empty steps, empty variables and an empty studentAnswer.",
    "3. A question's answer begins at the student's own marker for it (e.g. \"3)\", \"Q3\", \"(3)\") and ends where the next question's marker begins. An answer may continue across pages — collect all of it.",
    "4. transcription: what the student actually wrote, as exactly as you can read it, including their working and any mistakes. Never fix, complete, tidy or paraphrase it. If part is illegible, transcribe what you can and leave the rest out rather than guessing.",
    "5. problemType: exactly one of \"mean\", \"median\", \"mode\", \"range\", \"probability\", \"algebra\", \"coordinate_geometry\". Use \"unknown\" whenever you are not confident — never force a guess.",
    "6. steps: the distinct logical steps the student actually wrote, in their order (e.g. \"stated the mode formula\", \"substituted values\", \"simplified\"). Do not invent steps they did not write, and do not omit steps they did.",
    "7. variables: every named quantity the student explicitly wrote a value for, as name to value (e.g. {\"l\": \"30\", \"f1\": \"15\", \"f0\": \"9\"}). Copy each value EXACTLY as the student wrote it — keep fractions, decimals and expressions as-is, and never compute, round or simplify anything. Use the student's own names for the quantities. Use {} if they named none.",
    "8. studentAnswer: the student's own final concluding value, verbatim (e.g. \"33\", \"5/12\"). Empty string if they never reached one. Never supply a value the student did not write.",
    "9. structureConfidence: how confident you are that this decomposition faithfully reflects what is written — \"low\" if the handwriting was hard to read or the working was hard to follow.",
  ].join("\n");
}

function buildQuestionList(questions: MathReadingQuestion[]): string {
  return questions.map((q) => `- Question ${q.questionNumber}: ${q.questionText}`).join("\n");
}

function toTrimmed(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

/** Numeric worth is decided by our own evaluator, never by the model — see numericExpression.ts. */
function toExtractedValue(value: unknown): ExtractedValue {
  const raw = toTrimmed(value, MAX_VALUE_LENGTH);
  return { raw, parsed: raw ? parseNumericExpression(raw) : null };
}

function toConfidence(value: unknown): ReconcileConfidence {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function toProblemType(value: unknown): MathProblemType {
  return typeof value === "string" && (MATH_PROBLEM_TYPES as readonly string[]).includes(value)
    ? (value as MathProblemType)
    : "unknown";
}

function parsePassResponse(
  raw: RawStructuredReadingResponse,
  validQuestionNumbers: Set<number>,
): Map<number, SinglePassReading> {
  const entries = Array.isArray(raw.answers) ? raw.answers : [];
  const result = new Map<number, SinglePassReading>();

  for (const item of entries) {
    if (typeof item !== "object" || item === null) continue;
    const entry = item as RawStructuredReadingEntry;

    const questionNumber = typeof entry.questionNumber === "number" ? entry.questionNumber : null;
    // Never trust a reading for a question that isn't on this assessment — the
    // same discipline the handwritten answer-index mapping already applies.
    if (questionNumber === null || !validQuestionNumbers.has(questionNumber)) continue;

    const variables: Record<string, ExtractedValue> = {};
    if (entry.variables && typeof entry.variables === "object" && !Array.isArray(entry.variables)) {
      for (const [name, value] of Object.entries(entry.variables as Record<string, unknown>).slice(0, MAX_VARIABLES)) {
        const trimmedName = name.trim();
        if (!trimmedName) continue;
        const extracted = toExtractedValue(value);
        if (extracted.raw) variables[trimmedName] = extracted;
      }
    }

    const steps = Array.isArray(entry.steps)
      ? entry.steps
          .filter((step): step is string => typeof step === "string" && step.trim().length > 0)
          .slice(0, MAX_STEPS)
          .map((step) => step.trim().slice(0, MAX_STEP_LENGTH))
      : [];

    const transcription = toTrimmed(entry.transcription, MAX_TRANSCRIPTION_LENGTH);
    const studentAnswer = toExtractedValue(entry.studentAnswer);

    // A model that reports attempted:true but transcribed nothing has not
    // actually found an answer — trust the content over the flag.
    const attempted = entry.attempted === true && transcription.length > 0;

    result.set(questionNumber, {
      questionNumber,
      attempted,
      transcription,
      problemType: toProblemType(entry.problemType),
      steps,
      variables,
      studentAnswer: studentAnswer.raw ? studentAnswer : null,
      structureConfidence: toConfidence(entry.structureConfidence),
    });
  }

  return result;
}

async function readOnce(
  pages: HandwrittenPageInput[],
  questions: MathReadingQuestion[],
  validQuestionNumbers: Set<number>,
): Promise<Map<number, SinglePassReading>> {
  const userContent: ChatCompletionContentPart[] = [
    {
      type: "text",
      text: [
        "Read the following handwritten Mathematics answer-sheet pages, in order.",
        "",
        "The questions on this assessment are:",
        buildQuestionList(questions),
      ].join("\n"),
    },
    ...pages.map(
      (page): ChatCompletionContentPart => ({
        type: "image_url",
        image_url: { url: `data:${page.mimeType};base64,${page.buffer.toString("base64")}` },
      }),
    ),
  ];

  const raw = await callStructuredAiWithContent<RawStructuredReadingResponse>({
    model: READ_MODEL,
    systemPrompt: buildSystemPrompt(),
    userContent,
    temperature: 0.1,
    maxAttempts: 2,
    // Generous: this returns a full transcription, steps and variables for
    // every question on the paper at once, and a truncated response would fail
    // to parse and lose the whole read.
    maxTokens: 8000,
    stage: "MATH_STRUCTURED_READING",
  });

  return parsePassResponse(raw, validQuestionNumbers);
}

/** Prefers the read that found an answer at all, then the fuller transcription. */
function pickPreferred(a: SinglePassReading, b: SinglePassReading): SinglePassReading {
  if (a.attempted !== b.attempted) return a.attempted ? a : b;
  return a.transcription.length >= b.transcription.length ? a : b;
}

/**
 * Reads every question twice in parallel and reconciles the two passes.
 *
 * Throws only if BOTH passes fail — a single failed pass still yields a
 * usable reading, marked low confidence because it could not be cross-checked.
 */
export async function readMathAnswers(
  pages: HandwrittenPageInput[],
  questions: MathReadingQuestion[],
): Promise<Map<number, ReconciledMathReading>> {
  if (pages.length === 0 || questions.length === 0) return new Map();

  const validQuestionNumbers = new Set(questions.map((q) => q.questionNumber));

  const [passA, passB] = await Promise.allSettled([
    readOnce(pages, questions, validQuestionNumbers),
    readOnce(pages, questions, validQuestionNumbers),
  ]);

  if (passA.status === "rejected" && passB.status === "rejected") {
    throw passA.reason instanceof Error
      ? passA.reason
      : new Error("Both structured reading passes failed.");
  }

  const readingsA = passA.status === "fulfilled" ? passA.value : new Map<number, SinglePassReading>();
  const readingsB = passB.status === "fulfilled" ? passB.value : new Map<number, SinglePassReading>();

  const reconciled = reconcileByKey(readingsA, readingsB, (value) => value.transcription, pickPreferred);

  const result = new Map<number, ReconciledMathReading>();
  for (const [questionNumber, entry] of reconciled) {
    result.set(questionNumber, toReconciledReading(questionNumber, entry));
  }
  return result;
}

function toReconciledReading(
  questionNumber: number,
  entry: ReconciledEntry<SinglePassReading>,
): ReconciledMathReading {
  const { value } = entry;
  return {
    questionNumber,
    transcription: value.transcription,
    attempted: value.attempted,
    agreementConfidence: entry.confidence,
    problemType: value.problemType,
    steps: value.steps,
    variables: value.variables,
    studentAnswer: value.studentAnswer,
    structureConfidence: value.structureConfidence,
  };
}
