import type {
  ComparisonError,
  ComparisonErrorType,
  ComparisonResult,
  ExtractedValue,
  ReconciledMathReading,
  StructuredApproachExpectation,
  StructuredExpectation,
} from "@/types/mathCorrection";

/**
 * Stage 2 of the Mathematics correction flow: decide, deterministically, where
 * a student's working diverges from what the rubric expects.
 *
 * No model, no network, no natural language — pure comparison of numbers our
 * own evaluator parsed. This is the stage that makes the whole flow auditable:
 * every error it emits can be re-derived from its inputs, and a rerun on the
 * same inputs always produces the same errors. Turning these into something a
 * student reads is a later stage's job, not this one's.
 *
 * The rubric may describe several legitimate approaches to the same answer, so
 * the comparison runs against EVERY approach and keeps the best-matching
 * result. A student who correctly used the second-listed method must not have
 * their working reported as a pile of missing steps just because the rubric
 * happened to list a different method first.
 *
 * Precision over recall throughout: where a value cannot be checked
 * numerically, nothing is emitted. A silent miss is a far cheaper mistake than
 * telling a student something correct is wrong.
 */

/** Absolute floor, so near-zero expected values don't demand absurd precision. */
const TOLERANCE_FLOOR = 0.01;
/** Relative component, so large values aren't failed by harmless rounding. */
const TOLERANCE_RELATIVE = 0.005;

export function numericTolerance(expected: number): number {
  return Math.max(TOLERANCE_FLOOR, Math.abs(expected) * TOLERANCE_RELATIVE);
}

const SUBSCRIPT_DIGITS = "₀₁₂₃₄₅₆₇₈₉";
const SUPERSCRIPT_DIGITS = "⁰¹²³⁴⁵⁶⁷⁸⁹";

/**
 * Variable names are matched loosely, because the rubric and the student are
 * two different authors naming the same quantity: "F₁", "f1" and "f 1" all
 * mean the same thing.
 *
 * Unicode sub/superscript digits are folded to ASCII rather than stripped —
 * subscripts are ordinary notation in this subject, and dropping them would
 * collapse f₀, f₁ and f₂ into a single name "f", silently matching a
 * student's value for one quantity against the rubric's value for another.
 */
function normalizeVariableName(name: string): string {
  let folded = "";
  for (const char of name) {
    const subscriptIndex = SUBSCRIPT_DIGITS.indexOf(char);
    const superscriptIndex = SUPERSCRIPT_DIGITS.indexOf(char);
    if (subscriptIndex >= 0) folded += String(subscriptIndex);
    else if (superscriptIndex >= 0) folded += String(superscriptIndex);
    else folded += char;
  }
  return folded.toLowerCase().replace(/[^a-z0-9]/g, "");
}

type PendingError = Omit<ComparisonError, "id" | "variable" | "dependsOn">;

/**
 * Compares one expected/actual pair.
 *
 * Returns null both when the values match AND when they cannot be compared
 * numerically at all. Those are deliberately not distinguished: an
 * unparseable value means "no evidence of an error", never "an error". Only a
 * genuine numeric disagreement produces one.
 */
function compareValue(
  expected: ExtractedValue,
  actual: ExtractedValue,
  mismatchType: ComparisonErrorType,
): PendingError | null {
  if (expected.parsed === null || actual.parsed === null) return null;

  const tolerance = numericTolerance(expected.parsed);
  if (Math.abs(actual.parsed - expected.parsed) <= tolerance) return null;

  // Right magnitude, wrong sign is a specific, recognisable slip worth naming
  // rather than reporting as an arbitrary wrong value.
  if (Math.abs(actual.parsed + expected.parsed) <= tolerance) {
    return { type: "SIGN_ERROR", expected, actual, comparisonMethod: "sign_check" };
  }

  return { type: mismatchType, expected, actual, comparisonMethod: "numeric", tolerance };
}

/**
 * True only when both values are genuinely numeric AND agree. Deliberately
 * distinct from compareValue returning null, which also covers "could not be
 * compared at all" — an unparseable answer is not evidence the student got it
 * right, and must not be treated as such.
 */
function valuesMatchNumerically(expected: ExtractedValue | null, actual: ExtractedValue | null): boolean {
  if (!expected || !actual) return false;
  if (expected.parsed === null || actual.parsed === null) return false;
  return Math.abs(actual.parsed - expected.parsed) <= numericTolerance(expected.parsed);
}

interface ApproachComparison {
  approachLabel: string;
  errors: ComparisonError[];
  matchedVariableCount: number;
  totalExpectedVariableCount: number;
}

function compareAgainstApproach(
  reading: ReconciledMathReading,
  approach: StructuredApproachExpectation,
  correctAnswer: ExtractedValue | null,
  nextErrorId: () => string,
): ApproachComparison {
  const errors: ComparisonError[] = [];

  const studentByName = new Map<string, ExtractedValue>();
  for (const [name, value] of Object.entries(reading.variables)) {
    studentByName.set(normalizeVariableName(name), value);
  }

  let matchedVariableCount = 0;
  const expectedEntries = Object.entries(approach.variables);

  // A student who arrived at the right final answer cannot have skipped a step
  // needed to reach it, so a quantity we failed to find is our reader missing
  // it, not the student omitting it. Suppressing that here matters: a missing
  // quantity is the one finding inferred from ABSENCE, so it is the only one
  // an imperfect read can invent out of nothing — and it did, telling a student
  // who scored full marks that they had left out a value they plainly wrote.
  const reachedCorrectAnswer = valuesMatchNumerically(correctAnswer, reading.studentAnswer);

  for (const [expectedName, expectedValue] of expectedEntries) {
    const studentValue = studentByName.get(normalizeVariableName(expectedName));

    if (!studentValue) {
      if (!reachedCorrectAnswer) {
        errors.push({
          id: nextErrorId(),
          type: "MISSING_STEP",
          variable: expectedName,
          expected: expectedValue,
          comparisonMethod: "presence_check",
          dependsOn: [],
        });
      }
      continue;
    }

    matchedVariableCount++;
    const mismatch = compareValue(expectedValue, studentValue, "WRONG_SUBSTITUTION");
    if (mismatch) {
      errors.push({ id: nextErrorId(), variable: expectedName, ...mismatch, dependsOn: [] });
    }
  }

  // The final answer is compared last so it can depend on the substitution
  // errors found above. A wrong final value that a wrong input already
  // explains is a consequence, not a second independent mistake — saying
  // otherwise would tell a student they made two errors when they made one.
  if (correctAnswer && reading.studentAnswer) {
    const substitutionErrorIds = errors.filter((error) => error.type === "WRONG_SUBSTITUTION").map((error) => error.id);
    const isConsequence = substitutionErrorIds.length > 0;
    const mismatch = compareValue(
      correctAnswer,
      reading.studentAnswer,
      isConsequence ? "FINAL_ANSWER_ERROR" : "ARITHMETIC_ERROR",
    );
    if (mismatch) {
      errors.push({ id: nextErrorId(), ...mismatch, dependsOn: substitutionErrorIds });
    }
  }

  return {
    approachLabel: approach.label,
    errors,
    matchedVariableCount,
    totalExpectedVariableCount: expectedEntries.length,
  };
}

/**
 * Fewest errors wins; ties go to whichever approach the student's own named
 * quantities overlap with most, since that is the method they were actually
 * working through.
 */
function pickBestApproach(candidates: ApproachComparison[]): ApproachComparison {
  return candidates.reduce((best, candidate) => {
    if (candidate.errors.length !== best.errors.length) {
      return candidate.errors.length < best.errors.length ? candidate : best;
    }
    return candidate.matchedVariableCount > best.matchedVariableCount ? candidate : best;
  });
}

export function compareReadingToRubric(
  reading: ReconciledMathReading,
  expectation: StructuredExpectation | null,
): ComparisonResult {
  const empty = (status: ComparisonResult["status"]): ComparisonResult => ({
    status,
    matchedApproachLabel: null,
    errors: [],
    matchedVariableCount: 0,
    totalExpectedVariableCount: 0,
  });

  if (!expectation) return empty("skipped_no_expectation");
  if (!expectation.solvable) return empty("skipped_unsolvable");
  // Nothing written is a scoring outcome, not a set of mistakes to point at.
  if (!reading.attempted) return empty("skipped_not_attempted");

  // Error ids are generated per call rather than from module state: questions
  // are compared concurrently, and a shared counter would hand two questions
  // overlapping ids that every later stage references.
  let errorCounter = 0;
  const nextErrorId = () => `err_${errorCounter++}`;

  const candidates = expectation.approaches.map((approach) =>
    compareAgainstApproach(reading, approach, expectation.correctAnswer, nextErrorId),
  );

  // A solvable expectation with no usable approach can still check the one
  // thing it does have: the final answer.
  const best =
    candidates.length > 0
      ? pickBestApproach(candidates)
      : compareAgainstApproach(
          reading,
          { label: "", formulaName: "", formulaExpression: "", variables: {} },
          expectation.correctAnswer,
          nextErrorId,
        );

  const result: ComparisonResult = {
    status: "compared",
    matchedApproachLabel: best.approachLabel || null,
    errors: best.errors,
    matchedVariableCount: best.matchedVariableCount,
    totalExpectedVariableCount: best.totalExpectedVariableCount,
  };

  // A disagreement about what KIND of problem this is says the student may have
  // misread the question entirely. Recorded as a confidence signal for later
  // stages rather than as a student-facing error, because it is a statement
  // about the pipeline's own footing, not about a specific thing they wrote.
  if (
    reading.problemType !== "unknown" &&
    expectation.problemType !== "unknown" &&
    reading.problemType !== expectation.problemType
  ) {
    result.readingProblemType = reading.problemType;
    result.expectationProblemType = expectation.problemType;
  }

  return result;
}
