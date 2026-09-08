import { JUDGE_MODEL } from "@/lib/ai/models";
import { callStructuredAi } from "@/lib/ai/callStructured";
import type {
  QuestionValidationIssueType,
  QuestionValidationResult,
  RawQuestionValidationResult,
} from "@/types/rubricGeneration";

/** Everything the validator needs to judge one question, plus light assessment context. */
export interface QuestionValidationInput {
  questionNumber: number;
  questionText: string;
  maximumMarks: number;
  subject: string;
  grade: string;
  curriculum: string;
  assessmentTitle: string;
}

const VALID_ISSUE_TYPES: readonly QuestionValidationIssueType[] = [
  "MISSING_INFORMATION",
  "AMBIGUOUS_QUESTION",
  "CONTRADICTORY_INFORMATION",
  "INVALID_DATA",
  "MISSING_REFERENCE",
  "INCOMPLETE_QUESTION",
];

const MAX_ISSUE_SUMMARY_LENGTH = 200;
const MAX_EXPLANATION_LENGTH = 1000;

const SYSTEM_PROMPT = [
  "You are a strict pre-check that runs BEFORE a marking rubric is generated for one exam question. Your only job is deciding whether this question, exactly as written, contains enough complete and unambiguous information to be assessed reliably. You never grade anything and you never design a rubric here.",
  "Respond with ONLY a single JSON object, no text before or after it, matching exactly one of:",
  '{"status": "VALID"}',
  "or:",
  '{"status": "REVIEW_REQUIRED", "issueType": string, "issueSummary": string, "explanation": string}',
  "",
  'issueType must be exactly one of: "MISSING_INFORMATION", "AMBIGUOUS_QUESTION", "CONTRADICTORY_INFORMATION", "INVALID_DATA", "MISSING_REFERENCE", "INCOMPLETE_QUESTION".',
  'IMPORTANT: when there is a problem, the "status" field must be the literal string "REVIEW_REQUIRED" — put the specific category ONLY in "issueType", never in "status".',
  "",
  "CRITICAL RULES — follow these exactly:",
  "1. NEVER invent, assume, guess, or complete anything missing from the question — not a missing number, missing table cell, missing formula, missing diagram, missing answer option, or unstated unit, and never resolve a contradiction on your own. If the question genuinely cannot be solved without inventing something, that is REVIEW_REQUIRED with issueType MISSING_INFORMATION — or MISSING_REFERENCE specifically when the question points at a diagram, graph, or table that isn't actually present in the text given to you.",
  '2. Only use AMBIGUOUS_QUESTION when multiple reasonable interpretations would produce a MATERIALLY DIFFERENT expected answer or different marking criteria. Do NOT flag a question merely because it can be solved by multiple valid methods (e.g. "calculate the mean using a suitable method" is VALID — direct/assumed-mean/step-deviation are all just different paths to the identical answer). Do NOT flag genuinely open-ended questions that expect varied answers (e.g. "explain three advantages of X") — that is VALID. Do NOT flag a question just because it says "any suitable example" or asks for an approximate/rounded answer — that is VALID.',
  "3. Use CONTRADICTORY_INFORMATION only when the question's own stated facts conflict with each other (e.g. it claims 10 observations but lists only 8; states three angles of a triangle that don't sum to 180°).",
  "4. Use INVALID_DATA only when the given data is mathematically or logically impossible (e.g. a probability above 1, a negative frequency) — not merely because a scenario seems unusual.",
  '5. Use INCOMPLETE_QUESTION when the question itself is visibly cut off or a sub-part is missing its content (e.g. a sub-part labelled "(c)" with nothing after it).',
  "6. issueSummary: a short (under 15 words) plain label for the problem, e.g. \"Missing value in the data set\". explanation: 1-3 plain sentences a teacher can immediately act on, stating exactly what is missing, ambiguous, or contradictory and why it prevents one single correct answer or marking scheme from being determined.",
  "7. If the question is genuinely fine — complete, unambiguous, and solvable exactly as written — respond VALID. Most well-formed questions are VALID; only flag a real, specific problem you can point to directly in the question's own text.",
].join("\n");

/**
 * Judges whether one question is reliably assessable as written, BEFORE any
 * rubric content is generated for it. Throws on network/parse failure or on
 * a response that fails structural validation (caller persists
 * generationStatus FAILED — a technical failure, retriable) — this never
 * returns a REVIEW_REQUIRED verdict without a usable issueType/summary/
 * explanation, and never silently defaults an unparseable response to VALID.
 */
export async function validateQuestionForRubricGeneration(
  input: QuestionValidationInput,
): Promise<QuestionValidationResult> {
  const userPrompt = [
    `Subject: ${input.subject}`,
    `Grade/Class: ${input.grade}`,
    `Curriculum: ${input.curriculum}`,
    `Assessment: ${input.assessmentTitle}`,
    "",
    `Question ${input.questionNumber} (worth ${input.maximumMarks} marks):`,
    input.questionText,
  ].join("\n");

  const raw = await callStructuredAi<RawQuestionValidationResult>({
    model: JUDGE_MODEL,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    temperature: 0.1,
    maxAttempts: 2,
    stage: "RUBRIC_GENERATION_VALIDATION",
  });

  return validate(raw);
}

function validate(raw: RawQuestionValidationResult): QuestionValidationResult {
  if (raw.status === "VALID") {
    return { status: "VALID" };
  }

  const issueType = raw.issueType;
  const hasRecognizedIssueType =
    typeof issueType === "string" && VALID_ISSUE_TYPES.includes(issueType as QuestionValidationIssueType);

  // The model is instructed to send status: "REVIEW_REQUIRED", but has been
  // observed to occasionally echo the issue type into `status` instead
  // (e.g. {"status": "INCOMPLETE_QUESTION", "issueType": "INCOMPLETE_QUESTION",
  // ...}). Every substantive field this validator actually depends on — a
  // real, recognized issueType plus non-empty summary/explanation — is
  // still present and correctly structured in that case; only a label
  // string landed in the "wrong" of two fields that happen to share the
  // same vocabulary. Accepting it here is a parsing-robustness allowance,
  // not a relaxation of what counts as a valid flag: `status` must still be
  // something other than "VALID", and every field below is still required
  // and still validated — a response this lenient parsing can't make sense
  // of continues to fall through to the throw at the bottom, becoming a
  // safe FAILED (retriable) rather than a silently wrong verdict.
  if (raw.status === "REVIEW_REQUIRED" || (raw.status !== undefined && hasRecognizedIssueType)) {
    if (!hasRecognizedIssueType) {
      throw new Error("AI validation response had an unrecognized issue type.");
    }

    const issueSummary =
      typeof raw.issueSummary === "string" ? raw.issueSummary.trim().slice(0, MAX_ISSUE_SUMMARY_LENGTH) : "";
    const explanation =
      typeof raw.explanation === "string" ? raw.explanation.trim().slice(0, MAX_EXPLANATION_LENGTH) : "";
    if (!issueSummary || !explanation) {
      throw new Error("AI validation response flagged a problem without a usable explanation.");
    }

    return {
      status: "REVIEW_REQUIRED",
      issueType: issueType as QuestionValidationIssueType,
      issueSummary,
      explanation,
    };
  }

  throw new Error("AI validation response had an unrecognized status.");
}
