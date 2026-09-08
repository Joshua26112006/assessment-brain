import { JUDGE_MODEL } from "@/lib/ai/models";
import { callStructuredAi } from "@/lib/ai/callStructured";
import type {
  ComparisonError,
  ComparisonResult,
  ErrorExplanation,
  ExplanationResult,
  ExplanationType,
  VerificationResult,
} from "@/types/mathCorrection";

/**
 * Stage 4 of the Mathematics correction flow: turn confirmed, structured
 * findings into something a student can actually read.
 *
 * The only stage that writes natural language, and deliberately the last one:
 * by the time anything reaches here it has already been derived
 * deterministically and independently confirmed, so the model's whole job is
 * phrasing. It is given the findings and told to introduce no facts of its
 * own — every value it may mention is already in front of it.
 *
 * Hard-gated on verification having passed. That gate is enforced here rather
 * than left to the caller, because this is the stage whose output a student
 * sees: an unverified claim must not be able to reach a child through a
 * caller's mistake.
 *
 * Ordering and classification are decided by our code, never taken from the
 * model's response order, so the same findings always read the same way.
 */

const MAX_EXPLANATION_LENGTH = 600;

interface RawExplanationClaim {
  errorId?: unknown;
  explanation?: unknown;
}

interface RawExplanationResponse {
  explanations?: unknown;
}

function isRootError(error: ComparisonError): boolean {
  return error.dependsOn.length === 0;
}

/** Derived from the error itself, never asked of the model — a label is not a judgement call. */
function deriveExplanationType(error: ComparisonError): ExplanationType {
  if (!isRootError(error)) return "consequence_final_answer_error";

  switch (error.type) {
    case "WRONG_SUBSTITUTION":
      return "root_wrong_substitution";
    case "SIGN_ERROR":
      return "root_sign_error";
    case "ARITHMETIC_ERROR":
      return "root_arithmetic_error";
    case "MISSING_STEP":
      return "root_missing_step";
    case "FINAL_ANSWER_ERROR":
      return "consequence_final_answer_error";
  }
}

function describeError(
  error: ComparisonError,
  index: number,
  confidenceByErrorId: Map<string, string>,
): string {
  const parts = [
    `ERROR ${index + 1} [errorId: ${error.id}]`,
    `Type: ${error.type}`,
    `Confidence: ${confidenceByErrorId.get(error.id) ?? "medium"}`,
  ];
  if (error.variable) parts.push(`Quantity: ${error.variable}`);
  if (error.expected) parts.push(`Correct value: ${error.expected.raw}`);
  if (error.actual) parts.push(`Student wrote: ${error.actual.raw}`);
  if (error.dependsOn.length > 0) parts.push(`Follows on from: ${error.dependsOn.join(", ")}`);
  return parts.join("\n  ");
}

function buildPrompt(
  questionText: string,
  maximumMarks: number,
  subject: string,
  errors: ComparisonError[],
  confidenceByErrorId: Map<string, string>,
): string {
  return [
    `You are a ${subject} teacher writing short feedback for a student on specific errors already identified in their answer.`,
    "",
    "RULES, all mandatory:",
    "1. Use ONLY the information listed under ERRORS below. Never introduce a fact, value, or conclusion that is not written there.",
    "2. Do not re-solve the question, do not re-teach the topic, and do not comment on anything not listed.",
    "3. An error marked as following on from another must say plainly that it follows from that earlier mistake.",
    "4. For high confidence, write directly (\"you substituted 7 instead of 9\"). For medium or low, soften it (\"it looks like\").",
    "5. Write plain text only — never LaTeX or backslash math. Write f0 or f₀, x² or x^2, a/b. Never \\(...\\) or \\frac{}{}.",
    "6. Address the student as \"you\", warmly and without discouraging them. Do not add praise you have no evidence for.",
    "",
    `QUESTION (${maximumMarks} marks):`,
    questionText,
    "",
    "ERRORS:",
    "",
    errors.map((error, index) => describeError(error, index, confidenceByErrorId)).join("\n\n"),
    "",
    "Respond with ONLY a single JSON object, no text before or after it, matching exactly:",
    '{"explanations": [{"errorId": string, "explanation": string}]}',
    "explanation: 1-3 sentences. One entry per error above, using the exact errorId given.",
  ].join("\n");
}

/**
 * Used when the model returned nothing usable for an error. States only what
 * the structured finding already contains, so a missing explanation degrades
 * into plainer wording rather than into silence about a confirmed mistake.
 */
function fallbackExplanation(error: ComparisonError): string {
  if (!isRootError(error)) {
    return "This final answer follows from the earlier mistake above — correcting that should correct this too.";
  }
  if (error.type === "MISSING_STEP") {
    return `This working doesn't show ${error.variable ?? "a required value"}, which is needed here.`;
  }
  const expected = error.expected?.raw;
  const actual = error.actual?.raw;
  if (expected && actual) {
    return `Here the value should be ${expected}, but you wrote ${actual}.`;
  }
  return "There is a mismatch here between your working and the expected value.";
}

function parseClaims(raw: RawExplanationResponse): Map<string, string> {
  const list = Array.isArray(raw.explanations) ? raw.explanations : [];
  const byErrorId = new Map<string, string>();

  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const claim = item as RawExplanationClaim;
    if (typeof claim.errorId !== "string" || !claim.errorId) continue;
    if (typeof claim.explanation !== "string") continue;

    const explanation = claim.explanation.trim().slice(0, MAX_EXPLANATION_LENGTH);
    if (explanation) byErrorId.set(claim.errorId, explanation);
  }

  return byErrorId;
}

export interface ExplanationQuestion {
  questionText: string;
  maximumMarks: number;
  subject: string;
}

export async function generateExplanations(
  question: ExplanationQuestion,
  comparison: ComparisonResult,
  verification: VerificationResult,
): Promise<ExplanationResult> {
  if (verification.status !== "PASS") return { status: "blocked", explanations: [] };
  if (comparison.errors.length === 0) return { status: "generated", explanations: [] };

  const confidenceByErrorId = new Map(
    verification.perError.map((entry) => [entry.errorId, entry.confidence] as const),
  );

  let claims = new Map<string, string>();
  try {
    const raw = await callStructuredAi<RawExplanationResponse>({
      model: JUDGE_MODEL,
      systemPrompt:
        "You write brief, plain-language feedback explaining errors that have already been identified and confirmed. You never introduce facts of your own.",
      userPrompt: buildPrompt(
        question.questionText,
        question.maximumMarks,
        question.subject,
        comparison.errors,
        confidenceByErrorId,
      ),
      temperature: 0,
      stage: "MATH_EXPLANATION",
    });
    claims = parseClaims(raw);
  } catch {
    // Deliberately not fatal: the findings are already confirmed, so the
    // student still gets them in the deterministic wording below rather than
    // losing confirmed feedback to a phrasing call that happened to fail.
    claims = new Map();
  }

  // Roots before the consequences that reference them, decided here rather
  // than by the model. The comparison engine only ever produces a two-level
  // graph (a final-answer error resting on substitution errors), so ordering
  // by root-ness is the full dependency order.
  const ordered = [
    ...comparison.errors.filter(isRootError),
    ...comparison.errors.filter((error) => !isRootError(error)),
  ];

  const explanations: ErrorExplanation[] = ordered.map((error) => ({
    errorId: error.id,
    explanationType: deriveExplanationType(error),
    explanation: claims.get(error.id) ?? fallbackExplanation(error),
    // Copied verbatim, never rephrased: the annotation stage matches this
    // string against the page's own OCR to circle the exact spot, so any
    // rewording here would stop the mistake being found on the page.
    wrongText: error.actual?.raw,
    correctVersion: error.expected?.raw,
  }));

  return { status: "generated", explanations };
}
