import { VERIFY_MODEL } from "@/lib/ai/models";
import { callStructuredAi } from "@/lib/ai/callStructured";
import { numericTolerance } from "@/lib/mathCorrection/comparisonEngine";
import type {
  ComparisonError,
  ComparisonResult,
  ErrorVerification,
  ExtractedValue,
  ReconcileConfidence,
  VerificationResult,
} from "@/types/mathCorrection";
import { parseNumericExpression } from "@/lib/mathCorrection/numericExpression";

/**
 * Stage 3 of the Mathematics correction flow: independently re-check every
 * error the comparison stage claims to have found, before any of it reaches a
 * student.
 *
 * This stage exists because the comparison is only ever as right as the rubric
 * it compared against. The rubric is itself AI-generated, so a wrong value in
 * it would otherwise turn into confident, specific, and completely false
 * feedback — telling a student their correct working is wrong. Here a second
 * model re-derives the expected value from the QUESTION ALONE, never seeing
 * the rubric's figure, and a claim only survives if the two independently
 * agree. That makes this the one place a bad rubric gets caught.
 *
 * Errors are verified in dependency order: a root error is checked on its own,
 * and a downstream consequence is only checked once the errors it rests on
 * have been confirmed. A consequence whose root failed verification is
 * "blocked" rather than judged, because there is nothing sound left to judge
 * it against.
 *
 * Structured output only — no student-facing language is produced here.
 */

export interface VerificationQuestion {
  questionText: string;
  maximumMarks: number;
  subject: string;
}

interface RawVerificationClaim {
  errorId?: unknown;
  independentExpected?: unknown;
  confidence?: unknown;
}

interface RawVerificationResponse {
  verifications?: unknown;
}

const EMPTY_VALUE: ExtractedValue = { raw: "", parsed: null };

function isRootError(error: ComparisonError): boolean {
  return error.dependsOn.length === 0;
}

function toConfidence(value: unknown): ReconcileConfidence {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function toExtractedValue(value: unknown): ExtractedValue {
  const raw = typeof value === "string" ? value.trim().slice(0, 200) : "";
  return { raw, parsed: raw ? parseNumericExpression(raw) : null };
}

/**
 * Two independently-derived values agree if they are numerically within the
 * same tolerance the comparison itself used. When neither side is numeric,
 * falls back to exact text equality — deliberately strict, since a loose
 * textual match between two non-numeric claims is not evidence of anything.
 */
function valuesAgree(independent: ExtractedValue, claimed: ExtractedValue): boolean {
  if (independent.parsed !== null && claimed.parsed !== null) {
    return Math.abs(independent.parsed - claimed.parsed) <= numericTolerance(claimed.parsed);
  }
  if (independent.parsed === null && claimed.parsed === null) {
    const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
    return normalize(independent.raw) === normalize(claimed.raw) && independent.raw.length > 0;
  }
  return false;
}

function describeClaim(error: ComparisonError, index: number): string {
  const parts = [`CLAIM ${index + 1} [errorId: ${error.id}]`, `Type: ${error.type}`];
  if (error.variable) parts.push(`Quantity: ${error.variable}`);
  if (error.expected) {
    parts.push(
      `Value being claimed as correct: ${error.expected.raw}${
        error.expected.parsed !== null ? ` (reads as ${error.expected.parsed})` : ""
      }`,
    );
  }
  if (error.actual) parts.push(`What the student wrote: ${error.actual.raw}`);
  return parts.join("\n  ");
}

const RESPONSE_CONTRACT = [
  "Respond with ONLY a single JSON object, no text before or after it, matching exactly:",
  '{"verifications": [{"errorId": string, "independentExpected": string, "confidence": "high" | "medium" | "low"}]}',
  "independentExpected: the correct value AS YOU DERIVE IT, written plainly (e.g. \"33\", \"5/12\"). No words, units or commentary.",
  "Include exactly one entry per claim, using the exact errorId given.",
].join("\n");

function buildRootPrompt(question: VerificationQuestion, rootErrors: ComparisonError[]): string {
  return [
    `You are an expert ${question.subject} examiner independently checking claims about a student's answer.`,
    "",
    `QUESTION (${question.maximumMarks} marks):`,
    question.questionText,
    "",
    "For EACH claim below, work out the correct value YOURSELF from the question alone.",
    "Treat every claim as a separate task and solve the underlying problem from scratch each time.",
    "You are NOT being asked whether the student is right, and you must NOT assume the value quoted in a claim is correct — that quoted value is exactly what you are checking.",
    "",
    "CLAIMS:",
    "",
    rootErrors.map(describeClaim).join("\n\n"),
    "",
    RESPONSE_CONTRACT,
  ].join("\n");
}

function buildConsequencePrompt(
  question: VerificationQuestion,
  error: ComparisonError,
  verifiedDependencies: Map<string, ExtractedValue>,
): string {
  const dependencyList = [...verifiedDependencies.entries()]
    .map(([id, value]) => `  - ${id}: confirmed as ${value.raw}`)
    .join("\n");

  return [
    `You are an expert ${question.subject} examiner independently checking one claim that follows on from earlier confirmed findings.`,
    "",
    `QUESTION (${question.maximumMarks} marks):`,
    question.questionText,
    "",
    "ALREADY CONFIRMED:",
    dependencyList || "  (none)",
    "",
    "CLAIM TO CHECK:",
    "",
    describeClaim(error, 0),
    "",
    "Given the confirmed findings above, derive the correct value for this claim yourself.",
    "",
    RESPONSE_CONTRACT,
  ].join("\n");
}

function parseClaims(raw: RawVerificationResponse): Map<string, RawVerificationClaim> {
  const list = Array.isArray(raw.verifications) ? raw.verifications : [];
  const byErrorId = new Map<string, RawVerificationClaim>();

  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const claim = item as RawVerificationClaim;
    if (typeof claim.errorId === "string" && claim.errorId) byErrorId.set(claim.errorId, claim);
  }

  return byErrorId;
}

/** An error the verifier said nothing usable about is failed, never assumed correct. */
function unverifiable(error: ComparisonError): ErrorVerification {
  return {
    errorId: error.id,
    state: "failed",
    confidence: "low",
    evidence: {
      independentExpected: EMPTY_VALUE,
      claimedExpected: error.expected ?? EMPTY_VALUE,
      claimedActual: error.actual,
      match: false,
    },
  };
}

function judge(error: ComparisonError, claim: RawVerificationClaim): ErrorVerification {
  const independentExpected = toExtractedValue(claim.independentExpected);
  const claimedExpected = error.expected ?? EMPTY_VALUE;
  const match = valuesAgree(independentExpected, claimedExpected);

  return {
    errorId: error.id,
    state: match ? "verified" : "failed",
    confidence: toConfidence(claim.confidence),
    evidence: { independentExpected, claimedExpected, claimedActual: error.actual, match },
  };
}

export async function verifyComparisonResult(
  question: VerificationQuestion,
  comparison: ComparisonResult,
): Promise<VerificationResult> {
  const pass = (): VerificationResult => ({
    status: "PASS",
    perError: [],
    failedErrorIds: [],
    blockedErrorIds: [],
  });

  if (comparison.status !== "compared" || comparison.errors.length === 0) return pass();

  // The student and the rubric disagree about what kind of problem this even
  // is, so the comparison was very likely made against the wrong expectation.
  // Every claim it produced is suspect, and none of it is safe to show.
  if (comparison.readingProblemType && comparison.expectationProblemType) {
    return { status: "FAIL", perError: [], failedErrorIds: [], blockedErrorIds: [] };
  }

  const perError: ErrorVerification[] = [];
  const byErrorId = new Map<string, ErrorVerification>();
  const verifiedValues = new Map<string, ExtractedValue>();

  const rootErrors = comparison.errors.filter(isRootError);
  if (rootErrors.length > 0) {
    let claims = new Map<string, RawVerificationClaim>();
    try {
      const raw = await callStructuredAi<RawVerificationResponse>({
        model: VERIFY_MODEL,
        systemPrompt:
          "You independently verify individual claims about a student's exam answer. You never accept a claimed value on trust — you derive each value yourself.",
        userPrompt: buildRootPrompt(question, rootErrors),
        temperature: 0,
        stage: "MATH_VERIFICATION",
      });
      claims = parseClaims(raw);
    } catch {
      // A failed verification call must never promote unverified claims: every
      // root error simply stays unverified, which fails the whole result below.
      claims = new Map();
    }

    for (const error of rootErrors) {
      const claim = claims.get(error.id);
      const verification = claim ? judge(error, claim) : unverifiable(error);
      perError.push(verification);
      byErrorId.set(error.id, verification);
      if (verification.state === "verified") {
        verifiedValues.set(error.id, verification.evidence.independentExpected);
      }
    }
  }

  // Consequence errors run after their roots, and sequentially: each one's
  // prompt quotes the confirmed upstream values, which only exist once the
  // roots above have actually been judged.
  for (const error of comparison.errors.filter((candidate) => !isRootError(candidate))) {
    const unresolved = error.dependsOn.filter((id) => byErrorId.get(id)?.state !== "verified");

    if (unresolved.length > 0) {
      const blocked: ErrorVerification = {
        errorId: error.id,
        state: "blocked",
        confidence: "low",
        evidence: {
          independentExpected: EMPTY_VALUE,
          claimedExpected: error.expected ?? EMPTY_VALUE,
          claimedActual: error.actual,
          match: false,
        },
        blockedBy: unresolved,
      };
      perError.push(blocked);
      byErrorId.set(error.id, blocked);
      continue;
    }

    const dependencies = new Map(
      error.dependsOn.map((id) => [id, verifiedValues.get(id) ?? EMPTY_VALUE] as const),
    );

    let verification: ErrorVerification;
    try {
      const raw = await callStructuredAi<RawVerificationResponse>({
        model: VERIFY_MODEL,
        systemPrompt:
          "You independently verify individual claims about a student's exam answer. You never accept a claimed value on trust — you derive each value yourself.",
        userPrompt: buildConsequencePrompt(question, error, dependencies),
        temperature: 0,
        stage: "MATH_VERIFICATION",
      });
      const claim = parseClaims(raw).get(error.id);
      verification = claim ? judge(error, claim) : unverifiable(error);
    } catch {
      verification = unverifiable(error);
    }

    perError.push(verification);
    byErrorId.set(error.id, verification);
  }

  const failedErrorIds = perError.filter((entry) => entry.state === "failed").map((entry) => entry.errorId);
  const blockedErrorIds = perError.filter((entry) => entry.state === "blocked").map((entry) => entry.errorId);

  // All-or-nothing on purpose: these errors describe one connected piece of
  // working, so showing the surviving half of a partially-discredited analysis
  // would present a misleading picture of where the student actually went wrong.
  return {
    status: failedErrorIds.length === 0 && blockedErrorIds.length === 0 ? "PASS" : "FAIL",
    perError,
    failedErrorIds,
    blockedErrorIds,
  };
}
