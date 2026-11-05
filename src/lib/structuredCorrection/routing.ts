import { nonEnglishLanguages } from "@/lib/structuredCorrection/pageSegments";
import type { AnswerType } from "@/lib/questions/answerType";
import type { ReconciledReading } from "@/types/structuredCorrection";

/**
 * Where one answer goes once it has been read (decisions D3 and D7, and the routing table of
 * 06-correction-hardening-plan.md): by the question's own answer type, never by the paper as a whole.
 *
 *   DIAGRAM          no AI mark; the teacher marks it
 *   not English      no AI mark; the teacher marks it
 *   everything else  marked by criteria, with reasons for the teacher to check where something about
 *                    the answer needs a person (two attempts, a diagram, an essay, a lone crossed-out answer)
 *
 * Pure: no model, no database.
 */

export type AnswerRoute =
  | { kind: "TEACHER_ONLY_DIAGRAM" }
  | { kind: "CANNOT_READ_LANGUAGE"; languages: string[] }
  | { kind: "MARK"; extraReasons: string[] };

export function routeAnswer(input: { answerType: AnswerType; reading: ReconciledReading | null }): AnswerRoute {
  if (input.answerType === "DIAGRAM") return { kind: "TEACHER_ONLY_DIAGRAM" };

  const reading = input.reading;
  const languages = reading && reading.attempted ? nonEnglishLanguages(reading.languages ?? []) : [];
  if (languages.length > 0) return { kind: "CANNOT_READ_LANGUAGE", languages };

  const reasons: string[] = [];
  if (reading?.conflictingAttempts) {
    reasons.push("Two different answers were left standing. Check which one should count.");
  }
  if (reading?.containsDiagram) {
    reasons.push("The answer includes a diagram or drawing. Any marks that depend on it need your check.");
  }
  if (input.answerType === "ESSAY") {
    reasons.push("Long answers are always checked by you.");
  }
  const segments = reading?.segments ?? [];
  const markedAreAllStruck = segments.length > 0 && segments.every((s) => !s.marked || s.status === "struck") && segments.some((s) => s.marked);
  if (markedAreAllStruck) {
    reasons.push("The only answer written was crossed out, with no replacement. It was marked as the student's answer; check that it should count.");
  }
  return { kind: "MARK", extraReasons: reasons };
}
