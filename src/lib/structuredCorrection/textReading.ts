import { READ_MODEL } from "@/lib/ai/models";
import { callStructuredAi } from "@/lib/ai/callStructured";
import { questionPromptLine } from "@/lib/questions/labels";
import { parsePageResponse, stitchPass } from "@/lib/structuredCorrection/pageSegments";
import type { ReconciledReading } from "@/types/structuredCorrection";

/**
 * Turns an answer the TEACHER typed (correcting what the handwriting reader got wrong) into the same structured
 * reading the page reader produces, so the answer can be marked again exactly as before.
 *
 * Nothing here is allowed to change what the teacher typed. The text is kept word for word; the model only splits it
 * into steps and named values, and anything it returns that is not literally in the teacher's text is thrown away
 * (an invented step or value would be marked as if the student had written it).
 */

export const MAX_CORRECTED_TEXT = 4000;

function squash(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function appearsIn(piece: string, haystack: string): boolean {
  const needle = squash(piece);
  return needle.length > 0 && squash(haystack).includes(needle);
}

/**
 * The reading for the corrected text. `reply` is what the model said about it (any shape; bad shapes are ignored).
 * Pure: the same text and reply always give the same reading.
 */
export function readingFromCorrectedText(input: { questionNumber: number; text: string; reply: unknown }): ReconciledReading {
  const text = input.text.trim().slice(0, MAX_CORRECTED_TEXT);
  const valid = new Set([input.questionNumber]);

  // The reply is parsed by the same rules as a page reading, but every piece is then checked against the typed text.
  const rawSegments = typeof input.reply === "object" && input.reply !== null && Array.isArray((input.reply as { segments?: unknown }).segments)
    ? (input.reply as { segments: unknown[] }).segments
    : [];
  const first = rawSegments.find((segment) => typeof segment === "object" && segment !== null) as Record<string, unknown> | undefined;
  const parsed = parsePageResponse(
    { segments: [{ ...(first ?? {}), questionNumber: input.questionNumber, status: "active", replaced: false, transcription: text, twoAttempts: false }] },
    valid,
  )[0];

  if (!parsed) {
    // Nothing typed: not attempted.
    return {
      questionNumber: input.questionNumber,
      transcription: "",
      attempted: false,
      agreementConfidence: "high",
      problemType: "unknown",
      steps: [],
      variables: {},
      studentAnswer: null,
      structureConfidence: "high",
      secondPass: null,
      segments: [],
      containsDiagram: false,
      languages: [],
      conflictingAttempts: false,
    };
  }

  const variables = Object.fromEntries(Object.entries(parsed.variables).filter(([, value]) => appearsIn(value.raw, text)));
  const segment = {
    ...parsed,
    steps: parsed.steps.filter((step) => appearsIn(step, text)),
    variables,
    studentAnswer: parsed.studentAnswer && appearsIn(parsed.studentAnswer.raw, text) ? parsed.studentAnswer : null,
    // The teacher typed this, so the words are what they are; what the model could be wrong about is only the split.
    containsDiagram: /\[diagram\]/i.test(text),
  };

  const stitched = stitchPass([[segment]], valid).get(input.questionNumber);
  if (!stitched) throw new Error("The corrected text could not be turned into a reading.");

  return {
    questionNumber: input.questionNumber,
    transcription: stitched.transcription,
    attempted: stitched.attempted,
    // A person read the handwriting, so the two-pass agreement the page reader reports does not apply.
    agreementConfidence: "high",
    problemType: stitched.problemType,
    steps: stitched.steps,
    variables: stitched.variables,
    studentAnswer: stitched.studentAnswer,
    structureConfidence: stitched.structureConfidence,
    secondPass: null,
    segments: stitched.segments,
    containsDiagram: stitched.containsDiagram,
    languages: stitched.languages,
    conflictingAttempts: false,
  };
}

const SYSTEM_PROMPT = [
  "A teacher has typed what a student wrote for one question, correcting a machine reading of the handwriting.",
  "You are NOT grading. Never judge whether anything is correct, never award marks, never correct anything, never solve the question.",
  "Split the typed text into its parts. Respond with ONLY a single JSON object matching exactly:",
  '{"segments": [{"problemType": string, "steps": [string], "variables": {"<name>": "<value>"}, "studentAnswer": string, "language": string, "structureConfidence": "high" | "medium" | "low"}]}',
  "Rules, all mandatory:",
  "1. Exactly one segment.",
  "2. steps: the distinct steps as written, each copied exactly from the text. Never reword, never add a step.",
  "3. variables: each named quantity with a value that the text writes, name to value, the value copied exactly. Use {} if none.",
  "4. studentAnswer: the final concluding value, copied exactly. Empty string if the text reaches none.",
  '5. problemType: exactly one of "mean", "median", "mode", "range", "probability", "algebra", "coordinate_geometry", or "unknown" when not sure.',
  '6. language: the language the WORDS are in, for example "English"; "none" for numbers and symbols only.',
].join("\n");

export type StructureOutcome = { ok: true; reading: ReconciledReading } | { ok: false; message: string };

/** Structures the corrected text with one text-only model call. Never throws. */
export async function structureTranscription(input: {
  questionNumber: number;
  label: string | null;
  questionText: string;
  text: string;
}): Promise<StructureOutcome> {
  const text = input.text.trim();
  if (!text) return { ok: true, reading: readingFromCorrectedText({ questionNumber: input.questionNumber, text, reply: null }) };
  try {
    const reply = await callStructuredAi<unknown>({
      model: READ_MODEL,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: [
        "The question:",
        questionPromptLine({ questionNumber: input.questionNumber, label: input.label, questionText: input.questionText }),
        "",
        "What the student wrote, typed by the teacher:",
        text.slice(0, MAX_CORRECTED_TEXT),
      ].join("\n"),
      temperature: 0.1,
      maxAttempts: 2,
      maxTokens: 2000,
      stage: "STRUCTURED_READING",
    });
    return { ok: true, reading: readingFromCorrectedText({ questionNumber: input.questionNumber, text, reply }) };
  } catch (error) {
    console.error("Structuring the corrected answer failed:", error instanceof Error ? error.message : error);
    return { ok: false, message: "The corrected answer could not be prepared for marking. Nothing was changed; try again." };
  }
}
