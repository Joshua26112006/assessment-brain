import { JUDGE_MODEL } from "@/lib/ai/models";
import { callStructuredAi } from "@/lib/ai/callStructured";
import type { ReconciledMathReading } from "@/types/mathCorrection";
import type { RubricMarkingCheckpoint } from "@/types/rubricGeneration";

/**
 * Awards the marks for one question, from the reconciled transcription and the
 * teacher-facing rubric.
 *
 * Deliberately independent of the error-finding stages and run alongside them,
 * not after: marking and fault-finding answer different questions. Marks come
 * from the rubric's own checkpoints and partial-credit guidance, whereas the
 * comparison stages exist to locate precisely where working went wrong so it
 * can be shown on the page. Letting the error count drive the mark would mean
 * a student silently losing marks for a mistake the pipeline merely failed to
 * confirm.
 *
 * Reads the transcription only — never the page images. The reading stage
 * already resolved what the student wrote, twice; re-deriving that here from
 * the images would reintroduce exactly the inconsistency the double pass was
 * built to remove, and would pay for the image tokens a second time.
 */

/** Fixed so identical work marked twice produces the same result. */
const SCORING_SEED = 42;

const MAX_FEEDBACK_LENGTH = 800;

export interface ScoringInput {
  questionText: string;
  maximumMarks: number;
  subject: string;
  expectedAnswer: string | null;
  markingCheckpoints: RubricMarkingCheckpoint[];
  partialCreditGuidance: string | null;
  reading: ReconciledMathReading;
}

export interface QuestionScore {
  awardedMarks: number;
  maximumMarks: number;
  feedback: string;
}

interface RawScore {
  awardedMarks?: unknown;
  feedback?: unknown;
}

function buildCheckpointList(checkpoints: RubricMarkingCheckpoint[]): string {
  if (checkpoints.length === 0) return "(no checkpoint breakdown available)";
  return checkpoints.map((c, i) => `${i + 1}. ${c.description} — ${c.marks} mark(s)`).join("\n");
}

export async function scoreQuestion(input: ScoringInput): Promise<QuestionScore> {
  // Nothing written is not a marking judgement, and asking a model to mark an
  // empty answer invites it to invent something to reward.
  if (!input.reading.attempted || !input.reading.transcription.trim()) {
    return {
      awardedMarks: 0,
      maximumMarks: input.maximumMarks,
      feedback: "This question was not attempted.",
    };
  }

  // Where the two reads disagreed, the transcription is likelier to contain
  // reading noise than genuine student error — so the benefit of the doubt
  // goes to the student rather than costing them marks for our uncertainty.
  const uncertainReadingNote =
    input.reading.agreementConfidence !== "high"
      ? "\nNote: this transcription was uncertain in places. Do not deduct marks for what may be transcription noise rather than a real mistake."
      : "";

  const systemPrompt = [
    `You are an experienced ${input.subject} examiner awarding marks for one question.`,
    "You are given the student's already-transcribed answer — mark only what is written there, and never assume anything beyond it.",
    "Respond with ONLY a single JSON object, no text before or after it, matching exactly:",
    `{"awardedMarks": number between 0 and ${input.maximumMarks}, "feedback": "1-3 sentences"}`,
    "",
    "Marking rules:",
    "1. Award marks against the checkpoints below, following the partial-credit guidance for this question.",
    "2. Give credit for a correct method even when the final simplification differs slightly, and for correct values in any equivalent form.",
    "3. Only withhold a checkpoint's marks when what it requires is genuinely absent from the answer.",
    "4. feedback: what earned marks and what, if anything, was missing. Address the student as \"you\". Plain text only, never LaTeX.",
  ].join("\n");

  const userPrompt = [
    `QUESTION (${input.maximumMarks} marks):`,
    input.questionText,
    "",
    `EXPECTED ANSWER: ${input.expectedAnswer ?? "(not recorded)"}`,
    "",
    "MARKING CHECKPOINTS:",
    buildCheckpointList(input.markingCheckpoints),
    "",
    `PARTIAL CREDIT GUIDANCE: ${input.partialCreditGuidance ?? "(not recorded)"}`,
    uncertainReadingNote,
    "",
    "STUDENT'S TRANSCRIBED ANSWER:",
    '"""',
    input.reading.transcription,
    '"""',
  ].join("\n");

  const raw = await callStructuredAi<RawScore>({
    model: JUDGE_MODEL,
    systemPrompt,
    userPrompt,
    temperature: 0,
    seed: SCORING_SEED,
    stage: "MATH_SCORING",
  });

  const reported = typeof raw.awardedMarks === "number" && Number.isFinite(raw.awardedMarks) ? raw.awardedMarks : 0;
  // Clamped rather than trusted: a model returning marks above the maximum
  // would otherwise inflate the whole submission's total.
  const awardedMarks = Math.min(Math.max(0, reported), input.maximumMarks);

  const feedback =
    typeof raw.feedback === "string" && raw.feedback.trim()
      ? raw.feedback.trim().slice(0, MAX_FEEDBACK_LENGTH)
      : "";

  return { awardedMarks, maximumMarks: input.maximumMarks, feedback };
}
