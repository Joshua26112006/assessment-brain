import type { ChatCompletionContentPart } from "openai/resources/chat/completions";
import { READ_MODEL } from "@/lib/ai/models";
import { callStructuredAiWithContent } from "@/lib/ai/callStructured";
import type { ConfidenceScore } from "@/types/assessmentBrain";
import type {
  AnswerIndexEntry,
  AnswerSheetValidationDecision,
  AnswerSheetValidationResult,
  HandwrittenPageInput,
  PageObservation,
  RawAnswerIndexEntry,
  RawAnswerSheetValidation,
  RawHandwrittenProcessingResponse,
  StructuredAnswerIndex,
  UnansweredQuestion,
} from "./types";

/** The real question this submission is being read against — just enough context to map by content, never marks (irrelevant to reading). */
export interface AssessmentQuestionForReading {
  id: string;
  questionNumber: number;
  questionText: string;
}

export interface HandwrittenReadingResult {
  validation: AnswerSheetValidationResult;
  answerIndex: StructuredAnswerIndex;
}

const VALID_DECISIONS = new Set<string>(["VALID", "INVALID", "UNCERTAIN"]);
const MAX_TEXT_LENGTH = 4000;
const MAX_NOTE_LENGTH = 300;

/**
 * ONE combined system prompt for BOTH the validation gate and the global
 * answer reading — deliberately not two separate AI calls. The dominant
 * cost of this request is the image tokens (every page, sent once); asking
 * the same already-loaded pages for a validation verdict in addition to a
 * transcription adds negligible output-token cost, whereas a second call
 * would re-send every page's image tokens a second time for no accuracy
 * benefit. This mirrors the pattern already used for question-paper
 * extraction (src/lib/questionPaperExtraction/ai.ts), which likewise
 * returns structured content plus warnings from a single pass.
 */
const SYSTEM_PROMPT = [
  "You are reading a student's handwritten exam answer sheet (multiple photographed/scanned pages, in order) for a teacher review and future evaluation system.",
  "You are NOT grading anything. You must not judge whether an answer is correct, award marks, or comment on quality.",
  "Respond with ONLY a single JSON object, no text before or after it, matching exactly:",
  '{"validation": {"decision": "VALID" | "INVALID" | "UNCERTAIN", "confidence": number 0-1, "reasonCodes": string[], "pageObservations": [{"pageNumber": number, "looksLikeAnswerSheet": boolean, "isBlank": boolean, "note": string | null}], "warnings": string[]}, "answers": [{"detectedQuestionNumber": number | null, "mappedQuestionNumber": number | null, "text": string, "sourcePages": number[], "mappingConfidence": number | null, "readingConfidence": number, "uncertain": boolean, "warnings": string[]}]}',
  "",
  "VALIDATION rules:",
  '1. decision "INVALID" means the pages are clearly not a genuine handwritten answer sheet for this assessment — e.g. an unrelated document, a photo of something else entirely, or every page is blank with no writing at all.',
  '2. decision "UNCERTAIN" means you cannot confidently tell either way — e.g. very faint handwriting, unusual structure, or partial legibility. Do not use INVALID for a paper that is merely hard to read; use UNCERTAIN for that.',
  '3. decision "VALID" means the pages look like a genuine attempt at this answer sheet, even if some individual answers are hard to read.',
  "4. reasonCodes: short machine-usable codes only (e.g. NOT_AN_ANSWER_SHEET, ALL_PAGES_BLANK, DUPLICATE_PAGES, LOW_LEGIBILITY). Empty array if nothing notable.",
  "5. pageObservations must include exactly one entry per page provided, in the same order.",
  "6. note: only a short, specific observation (e.g. \"identical to page 1\"); null if nothing notable. Never a generic disclaimer.",
  "",
  "READING rules (skip populating meaningful answers only if decision is INVALID — otherwise always attempt this):",
  "7. Transcribe what the student actually wrote as accurately as possible. Never invent, paraphrase away, or correct their wording.",
  "8. Preserve mathematical working and reasoning steps as plain text description of what was written, in order.",
  "9. If an answer's writing genuinely continues from one page onto another, report it as ONE entry with sourcePages listing every page it spans, in the order the content appears — never split one continuous answer into multiple entries.",
  "10. Students may answer questions out of order, or without writing the question number at all. Use the provided real question numbers and question text to infer the best match by content and context. Set mappedQuestionNumber to one of the real question numbers ONLY when you are reasonably confident; otherwise leave it null.",
  "11. detectedQuestionNumber is whatever number/label the student actually appears to have written near that answer (which may be illegible, missing, or wrong) — record it even if it doesn't match mappedQuestionNumber. Null if nothing was written.",
  "12. If content cannot be confidently associated with any real question, still include it as an entry with mappedQuestionNumber null — never discard it and never force it onto the nearest question just to avoid leaving it unmapped.",
  "13. uncertain must be true whenever either the transcription or the mapping is genuinely in doubt. Do not mark everything uncertain by default — only genuine cases.",
  "14. Never fabricate an answer for a question you found no evidence for at all — simply do not include an entry for it.",
  "15. warnings (per entry and overall): only genuine, specific caveats about what could not be read or matched. Empty array if none.",
].join("\n");

function buildQuestionContext(questions: AssessmentQuestionForReading[]): string {
  return questions
    .map((q) => `- Question ${q.questionNumber}: ${q.questionText}`)
    .join("\n");
}

/**
 * Runs the combined validation-gate + global-answer-reading call over every
 * page of one submission in a single request. Throws on network/parse
 * failure or structural-validation failure (Step 8 discipline, mirroring
 * questionPaperExtraction/ai.ts exactly) — the caller (processing.ts)
 * persists FAILED with the message; this function never returns a value
 * that hasn't been checked against real, sane constraints.
 */
export async function readHandwrittenSubmission(
  pages: HandwrittenPageInput[],
  questions: AssessmentQuestionForReading[],
): Promise<HandwrittenReadingResult> {
  if (pages.length === 0) {
    throw new Error("No pages were provided for handwritten reading.");
  }

  const userContent: ChatCompletionContentPart[] = [
    {
      type: "text",
      text: [
        "Read the following handwritten answer-sheet pages, in order, for this assessment.",
        "",
        "The real questions on this assessment are:",
        buildQuestionContext(questions),
      ].join("\n"),
    },
    ...pages.map(
      (page): ChatCompletionContentPart => ({
        type: "image_url",
        image_url: { url: `data:${page.mimeType};base64,${page.buffer.toString("base64")}` },
      }),
    ),
  ];

  const raw = await callStructuredAiWithContent<RawHandwrittenProcessingResponse>({
    model: READ_MODEL,
    systemPrompt: SYSTEM_PROMPT,
    userContent,
    temperature: 0.1,
    maxAttempts: 2,
    stage: "HANDWRITTEN_ANSWER_READING",
  });

  const validPageNumbers = new Set(pages.map((p) => p.pageNumber));
  const validQuestionNumbers = new Set(questions.map((q) => q.questionNumber));
  const questionIdByNumber = new Map(questions.map((q) => [q.questionNumber, q.id]));

  const validation = validateValidation(raw.validation, pages.length);

  // Defense-in-depth: regardless of what the model put in `answers`, a
  // submission the gate itself classified INVALID never gets a populated
  // answer index — never let a technically-successful-but-contradictory
  // response leak spurious "answers" for content already judged not to be
  // a real answer sheet.
  const answerIndex =
    validation.decision === "INVALID"
      ? { entries: [], unansweredQuestions: computeUnanswered(questions, []), overallWarnings: [] }
      : buildAnswerIndex(raw.answers, validPageNumbers, validQuestionNumbers, questionIdByNumber, questions);

  return { validation, answerIndex };
}

function toConfidence(value: unknown): ConfidenceScore {
  const score = typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  const level = score >= 0.6 ? "high" : score > 0 ? "medium" : "low";
  return { value: score, level };
}

function toNullableConfidence(value: unknown): ConfidenceScore | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return toConfidence(value);
}

/** Exported for focused unit testing of the parsing/validation logic without any AI call. */
export function validateValidation(
  raw: RawAnswerSheetValidation | undefined,
  pageCount: number,
): AnswerSheetValidationResult {
  if (!raw || typeof raw !== "object") {
    throw new Error("AI response did not include a validation object.");
  }
  if (typeof raw.decision !== "string" || !VALID_DECISIONS.has(raw.decision)) {
    throw new Error("AI validation response had a missing or invalid decision.");
  }

  const reasonCodes = Array.isArray(raw.reasonCodes)
    ? raw.reasonCodes.filter((c): c is string => typeof c === "string" && c.trim().length > 0)
    : [];

  const rawObservations = Array.isArray(raw.pageObservations) ? raw.pageObservations : [];
  const pageObservations: PageObservation[] = rawObservations
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      pageNumber: typeof item.pageNumber === "number" ? item.pageNumber : -1,
      looksLikeAnswerSheet: item.looksLikeAnswerSheet === true,
      isBlank: item.isBlank === true,
      note:
        typeof item.note === "string" && item.note.trim() ? item.note.trim().slice(0, MAX_NOTE_LENGTH) : null,
    }))
    .filter((obs) => obs.pageNumber > 0);

  if (pageObservations.length === 0 && pageCount > 0) {
    throw new Error("AI validation response did not include any page observations.");
  }

  const warnings = Array.isArray(raw.warnings)
    ? raw.warnings.filter((w): w is string => typeof w === "string" && w.trim().length > 0)
    : [];

  return {
    decision: raw.decision as AnswerSheetValidationDecision,
    confidence: toConfidence(raw.confidence),
    reasonCodes,
    pageObservations,
    warnings,
  };
}

/** Exported for focused unit testing of the parsing/validation logic without any AI call. */
export function buildAnswerIndex(
  rawAnswers: unknown,
  validPageNumbers: Set<number>,
  validQuestionNumbers: Set<number>,
  questionIdByNumber: Map<number, string>,
  questions: AssessmentQuestionForReading[],
): StructuredAnswerIndex {
  const rawList = Array.isArray(rawAnswers) ? rawAnswers : [];

  const entries: AnswerIndexEntry[] = rawList
    .filter((item): item is RawAnswerIndexEntry => typeof item === "object" && item !== null)
    .map((item, index): AnswerIndexEntry | null => {
      const text = typeof item.text === "string" ? item.text.trim() : "";
      if (!text) return null;

      const sourcePages = Array.isArray(item.sourcePages)
        ? item.sourcePages.filter((p): p is number => typeof p === "number" && validPageNumbers.has(p))
        : [];
      if (sourcePages.length === 0) return null;

      // Never trust an AI-claimed mapping to a question that doesn't
      // actually exist on this assessment — the same discipline already
      // applied to question-paper extraction's number validation.
      const claimedMappedNumber =
        typeof item.mappedQuestionNumber === "number" ? item.mappedQuestionNumber : null;
      const mappedQuestionNumber =
        claimedMappedNumber !== null && validQuestionNumbers.has(claimedMappedNumber)
          ? claimedMappedNumber
          : null;
      const questionId = mappedQuestionNumber !== null ? questionIdByNumber.get(mappedQuestionNumber)! : null;

      const detectedQuestionNumber =
        typeof item.detectedQuestionNumber === "number" ? item.detectedQuestionNumber : null;

      const warnings = Array.isArray(item.warnings)
        ? item.warnings.filter((w): w is string => typeof w === "string" && w.trim().length > 0)
        : [];

      return {
        localId: `entry-${index}`,
        detectedQuestionNumber,
        questionId,
        mappedQuestionNumber,
        text: text.slice(0, MAX_TEXT_LENGTH),
        sourcePages: [...sourcePages].sort((a, b) => a - b),
        mappingConfidence: mappedQuestionNumber !== null ? toNullableConfidence(item.mappingConfidence) : null,
        readingConfidence: toConfidence(item.readingConfidence),
        uncertain: item.uncertain === true,
        warnings,
      };
    })
    .filter((entry): entry is AnswerIndexEntry => entry !== null);

  return {
    entries,
    unansweredQuestions: computeUnanswered(questions, entries),
    overallWarnings: [],
  };
}

/**
 * Deterministic, not asked of the AI: any real question with zero mapped
 * entries has no detected answer. Computing this ourselves (rather than
 * trusting a model-reported list) means it can never disagree with the
 * entries actually present.
 */
/** Exported for focused unit testing of the parsing/validation logic without any AI call. */
export function computeUnanswered(
  questions: AssessmentQuestionForReading[],
  entries: AnswerIndexEntry[],
): UnansweredQuestion[] {
  const answeredQuestionIds = new Set(entries.map((e) => e.questionId).filter((id): id is string => id !== null));
  return questions
    .filter((q) => !answeredQuestionIds.has(q.id))
    .map((q) => ({ questionId: q.id, questionNumber: q.questionNumber }));
}
