import { JUDGE_MODEL } from "@/lib/ai/models";
import { callStructuredAi } from "@/lib/ai/callStructured";
import type { SchemeCriterion } from "@/lib/scheme/criteria";

/**
 * Is a student's different method valid? (Owner's decision, Nov 5: "the AI checks whether it is valid, then it goes
 * to the teacher for review before the mark is published".)
 *
 * It is asked only where a different method is the likely reason for lost marks: the final answer is right but full
 * marks were not given, and there was working to look at. The check is an OPINION for the teacher. It never changes
 * the mark and never decides anything: the answer is flagged for the teacher whatever it says, and if the check
 * fails, the mark and its other flags stand untouched.
 */

export type MethodVerdict = "valid" | "invalid" | "unclear";

export interface AlternativeMethodCheck {
  verdict: MethodVerdict;
  /** One or two plain sentences for the teacher. */
  reason: string;
}

export function needsMethodCheck(input: {
  flags: string[] | undefined;
  hasWorking: boolean;
  awardedMarks: number;
  maximumMarks: number;
}): boolean {
  const flags = input.flags ?? [];
  return (
    flags.includes("FINAL_ANSWER_CORRECT_NOT_FULL") &&
    !flags.includes("NO_WORKING") &&
    input.hasWorking &&
    input.awardedMarks < input.maximumMarks
  );
}

const VERDICTS: readonly string[] = ["valid", "invalid", "unclear"];

export function parseMethodCheck(raw: unknown): AlternativeMethodCheck | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { verdict, reason } = raw as { verdict?: unknown; reason?: unknown };
  if (typeof verdict !== "string" || !VERDICTS.includes(verdict.trim().toLowerCase())) return null;
  if (typeof reason !== "string" || reason.trim().length === 0) return null;
  return { verdict: verdict.trim().toLowerCase() as MethodVerdict, reason: reason.trim().slice(0, 400) };
}

const SYSTEM_PROMPT = `You check one thing: whether a student's METHOD is a valid way to solve the question. You do not mark it and you do not decide anything; a teacher reads your opinion.
The marking scheme describes one expected method, but a different method can be just as correct.
Judge only what is written. Be strict about validity and do not be generous:
- "valid": the working is a correct way to reach the answer, even though it differs from the scheme, and nothing important depends on a step that is missing.
- "invalid": the working contains a wrong step, a wrong formula, or reaches the right answer by luck or by an unjustified jump.
- "unclear": the working is too short, too hard to follow, or relies on something not written, so you cannot tell.
Reply with JSON only: {"verdict":"valid"|"invalid"|"unclear","reason":"one or two plain sentences for the teacher"}`;

export async function checkAlternativeMethod(input: {
  questionText: string;
  subject: string;
  expectedAnswer: string | null;
  criteria: Array<Pick<SchemeCriterion, "description" | "marks">>;
  transcription: string;
}): Promise<AlternativeMethodCheck | null> {
  const userPrompt = [
    `SUBJECT: ${input.subject}`,
    `QUESTION:\n${input.questionText}`,
    input.expectedAnswer ? `EXPECTED ANSWER:\n${input.expectedAnswer}` : "",
    `THE SCHEME'S EXPECTED METHOD (what earns marks):\n${input.criteria.map((c) => `- ${c.description} (${c.marks})`).join("\n")}`,
    `STUDENT'S WORKING, copied exactly (may contain mistakes; do not correct it):\n${input.transcription}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await callStructuredAi<unknown>({
        model: JUDGE_MODEL,
        systemPrompt: SYSTEM_PROMPT,
        userPrompt,
        temperature: 0,
        maxAttempts: 2,
        maxTokens: 500,
        stage: "STRUCTURED_SCORING",
      });
      const parsed = parseMethodCheck(raw);
      if (parsed) return parsed;
    } catch {
      // Fall through: a failed opinion is not worth losing the mark over.
    }
  }
  return null;
}

/** The sentence the teacher is shown beside the mark. */
export function methodCheckReason(check: AlternativeMethodCheck): string {
  const lead =
    check.verdict === "valid"
      ? "The final answer is right but the working differs from the scheme. The AI thinks the method is valid."
      : check.verdict === "invalid"
        ? "The final answer is right but the working differs from the scheme. The AI thinks the method is not valid."
        : "The final answer is right but the working differs from the scheme. The AI could not tell whether the method is valid.";
  return `${lead} Please check it before the mark is released.`;
}
