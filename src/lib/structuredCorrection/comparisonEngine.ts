import { parseNumericExpression } from "@/lib/structuredCorrection/numericExpression";
import { checkUnit, convertToUnit, parseUnit, splitQuantity } from "@/lib/structuredCorrection/units";
import type {
  ComparisonError,
  ComparisonErrorType,
  ComparisonResult,
  ExtractedValue,
  ReconciledReading,
  StructuredApproachExpectation,
  StructuredExpectation,
} from "@/types/structuredCorrection";

/**
 * Stage 2 of the structured correction flow: decide, deterministically, where
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

/**
 * For small values the absolute floor shrinks to this fraction of the value.
 * A flat 0.01 floor made 0.002 and 0.008 "equal" — concentrations, charges and
 * wavelengths routinely live below it. Values of 0.2 and above are unaffected.
 */
const SMALL_VALUE_RELATIVE_FLOOR = 0.05;

export function numericTolerance(expected: number): number {
  const magnitude = Math.abs(expected);
  const floor = Math.max(Math.min(TOLERANCE_FLOOR, magnitude * SMALL_VALUE_RELATIVE_FLOOR), 1e-12);
  return Math.max(floor, magnitude * TOLERANCE_RELATIVE);
}

/**
 * True when two values differ by an exact power of ten AND the student wrote a
 * unit. That is the signature of the same quantity in another unit — 2000 mg
 * for 2 g, 250 mL for 0.25 L — which a rubric stored without units cannot tell
 * apart from a genuine slip, so no claim is made either way.
 */
function possibleUnitConversion(expected: number, actual: ExtractedValue): boolean {
  if (actual.parsed === null || expected === 0 || actual.parsed === 0) return false;
  if (!/[A-Za-zΩµμ°]/.test(actual.raw.replace(/^[^=]*=/, "").replace(/[eE][+-]?\d/g, ""))) return false;
  const exponent = Math.log10(Math.abs(actual.parsed / expected));
  const nearest = Math.round(exponent);
  return nearest !== 0 && Math.abs(nearest) <= 9 && Math.abs(exponent - nearest) < 1e-6;
}

/**
 * How a student's value relates to the key's, once units are taken into account
 * (decision D11).
 *
 *   legacy       — the key carries no unit (a rubric written before units were kept):
 *                  the older, cautious handling applies (see possibleUnitConversion).
 *   same         — the key has a unit and the student wrote none: the bare numbers are compared.
 *   converted    — both units are known and measure the same quantity: the student's number,
 *                  expressed in the key's unit.
 *   incomparable — the student's unit is a different quantity, or one we do not recognise:
 *                  no claim about the VALUE is made (a UNIT criterion is judged separately).
 */
type UnitResolution =
  | { mode: "legacy" }
  | { mode: "same" }
  | { mode: "converted"; value: number }
  | { mode: "incomparable" };

function resolveUnits(expected: ExtractedValue, actual: ExtractedValue): UnitResolution {
  const keyUnit = expected.unit ? parseUnit(expected.unit) : null;
  if (!keyUnit || actual.parsed === null) return { mode: "legacy" };

  const written = checkUnit(expected.unit, actual.raw);
  if (written === "absent") return { mode: "same" };
  if (written === "unknown") return { mode: "incomparable" };

  const studentUnitText = splitQuantity(actual.raw).unitText;
  const studentUnit = studentUnitText ? parseUnit(studentUnitText) : null;
  if (!studentUnit) return { mode: "incomparable" };
  const converted = convertToUnit(actual.parsed, studentUnit, keyUnit);
  return converted === null ? { mode: "incomparable" } : { mode: "converted", value: converted };
}

/** The student's value as it should be compared with the key, or null when no value claim can be made. */
function effectiveActual(expected: ExtractedValue, actual: ExtractedValue): ExtractedValue | null {
  const resolution = resolveUnits(expected, actual);
  if (resolution.mode === "incomparable") return null;
  if (resolution.mode === "converted") return { raw: String(resolution.value), parsed: resolution.value };
  return actual;
}

/** True when a difference between the two values may simply be a different unit, so no mistake can be claimed. */
function unitMayExplainDifference(expected: ExtractedValue, actual: ExtractedValue): boolean {
  const resolution = resolveUnits(expected, actual);
  if (resolution.mode === "incomparable") return true;
  if (resolution.mode === "legacy" && expected.parsed !== null) return possibleUnitConversion(expected.parsed, actual);
  return false;
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
function foldVariableName(name: string): string {
  let folded = "";
  for (const char of name) {
    const subscriptIndex = SUBSCRIPT_DIGITS.indexOf(char);
    const superscriptIndex = SUPERSCRIPT_DIGITS.indexOf(char);
    if (subscriptIndex >= 0) folded += String(subscriptIndex);
    else if (superscriptIndex >= 0) folded += String(superscriptIndex);
    else folded += char;
  }
  return folded.replace(/[^A-Za-z0-9]/g, "");
}

/**
 * Case is kept for the exact key because in science it carries meaning: M is
 * molar mass or molarity and m is mass, V is voltage or volume and v is
 * velocity, T is period or temperature and t is time. The case-insensitive key
 * is a fallback that only ever establishes PRESENCE, never a mismatch — see
 * lookupStudentValue.
 */
function exactVariableKey(name: string): string {
  return foldVariableName(name);
}

function looseVariableKey(name: string): string {
  return foldVariableName(name).toLowerCase();
}

interface StudentValueIndex {
  exact: Map<string, ExtractedValue>;
  /** Null marks a loose key two different student names collapse onto, which therefore identifies nothing. */
  loose: Map<string, ExtractedValue | null>;
}

function indexStudentValues(variables: Record<string, ExtractedValue>): StudentValueIndex {
  const exact = new Map<string, ExtractedValue>();
  const loose = new Map<string, ExtractedValue | null>();
  for (const [name, value] of Object.entries(variables)) {
    exact.set(exactVariableKey(name), value);
    const key = looseVariableKey(name);
    loose.set(key, loose.has(key) ? null : value);
  }
  return { exact, loose };
}

/**
 * Finds the student's value for a quantity by the rubric's name for it, or by any alias the scheme lists
 * for it ("u", "v0" and "initial velocity" are one quantity). An alias is an intended synonym, so a match
 * on it is as exact as a match on the name itself.
 */
function lookupStudentValue(
  index: StudentValueIndex,
  name: string,
  aliases: string[] = [],
): { value: ExtractedValue; exact: boolean } | null {
  for (const candidate of [name, ...aliases]) {
    const exact = index.exact.get(exactVariableKey(candidate));
    if (exact) return { value: exact, exact: true };
  }
  for (const candidate of [name, ...aliases]) {
    const loose = index.loose.get(looseVariableKey(candidate));
    if (loose) return { value: loose, exact: false };
  }
  return null;
}

/**
 * Decimal places the student stated for this value ("2.5" -> 1, "34" -> 0),
 * taken from the literal in their raw text that IS the value. Null when no
 * single literal equals it (an expression like "20/8"), so no rounding
 * allowance is inferred from text that doesn't state one.
 */
function statedDecimalPlaces(value: ExtractedValue): number | null {
  if (value.parsed === null) return null;
  const literals = value.raw.match(/\d+(?:\.\d+)?/g) ?? [];
  for (const literal of literals) {
    if (Math.abs(Number(literal) - Math.abs(value.parsed)) <= 1e-12 * Math.max(1, Math.abs(value.parsed))) {
      const dot = literal.indexOf(".");
      return dot === -1 ? 0 : literal.length - dot - 1;
    }
  }
  return null;
}

/**
 * Whether `actual` is `expected`, allowing for the student having rounded it.
 *
 * Beyond the fixed tolerance, a value given to d decimal places (d >= 1) is
 * accepted when it is the expected value correctly rounded to d places —
 * "2.4" for 2.449, "0.33" for 1/3 — because the fixed tolerance alone told a
 * student who rounded sensibly that their answer was wrong. Whole-number
 * answers get no such allowance: "2" is not a rounding of 2.45 that a marker
 * would accept without being told to round.
 */
function matchesExpected(expected: number, actual: ExtractedValue): boolean {
  if (actual.parsed === null) return false;
  if (Math.abs(actual.parsed - expected) <= numericTolerance(expected)) return true;
  const places = statedDecimalPlaces(actual);
  if (places === null || places < 1) return false;
  return Math.abs(actual.parsed - expected) <= 0.5 * 10 ** -places + 1e-12;
}

/**
 * Every number that appears anywhere in the student's written working for
 * this question — bare literals, simple fractions, and each "="-separated
 * segment evaluated whole. Used only to SUPPRESS a missing-value finding: a
 * student who wrote "W = 2 x 10 x 5" used m = 2, g = 10 and h = 5 without
 * naming them, and must not be told they left them out.
 */
function numbersInWorking(reading: ReconciledReading): number[] {
  const texts = [
    reading.transcription,
    ...reading.steps,
    ...Object.values(reading.variables).map((value) => value.raw),
    reading.studentAnswer?.raw ?? "",
  ];
  const numbers: number[] = [];
  for (const text of texts) {
    for (const literal of text.match(/\d+(?:\.\d+)?/g) ?? []) numbers.push(Number(literal));
    for (const fraction of text.matchAll(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/g)) {
      const denominator = Number(fraction[2]);
      if (denominator !== 0) numbers.push(Number(fraction[1]) / denominator);
    }
    for (const line of text.split(/\n/)) {
      for (const segment of line.split("=")) {
        const value = parseNumericExpression(segment);
        if (value !== null) numbers.push(value);
      }
    }
  }
  return numbers;
}

function appearsInWorking(expected: ExtractedValue, workingNumbers: number[]): boolean {
  if (expected.parsed === null) return false;
  const target = Math.abs(expected.parsed);
  return workingNumbers.some((number) => Math.abs(Math.abs(number) - target) <= numericTolerance(target));
}

/**
 * Whether the other reading pass read this same value. Undefined secondPass
 * means the caller recorded none, which keeps the previous behaviour.
 */
function confirmedBySecondPass(
  reading: ReconciledReading,
  value: ExtractedValue,
  other: ExtractedValue | null | undefined,
): boolean {
  if (reading.secondPass === undefined) return true;
  if (!other) return false;
  if (value.parsed !== null && other.parsed !== null) {
    return Math.abs(value.parsed - other.parsed) <= numericTolerance(value.parsed);
  }
  return value.raw.trim().toLowerCase() === other.raw.trim().toLowerCase();
}

function secondPassVariable(reading: ReconciledReading, name: string, aliases: string[] = []): ExtractedValue | null | undefined {
  if (reading.secondPass === undefined) return undefined;
  if (reading.secondPass === null) return null;
  const found = lookupStudentValue(indexStudentValues(reading.secondPass.variables), name, aliases);
  return found ? found.value : null;
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

  // Units first: a correct value in another unit is correct, and a different
  // quantity makes no claim about the value at all.
  const comparable = effectiveActual(expected, actual);
  if (comparable === null) return null;

  const tolerance = numericTolerance(expected.parsed);
  if (matchesExpected(expected.parsed, comparable)) return null;
  if (unitMayExplainDifference(expected, actual)) return null;

  // Right magnitude, wrong sign is a specific, recognisable slip worth naming
  // rather than reporting as an arbitrary wrong value.
  if (matchesExpected(-expected.parsed, comparable)) {
    return { type: "SIGN_ERROR", expected, actual, comparisonMethod: "sign_check" };
  }

  return { type: mismatchType, expected, actual, comparisonMethod: "numeric", tolerance };
}

/** Two sets of values are the same set: the same number of values, each matching its partner within tolerance. */
export function setsAgree(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort((x, y) => x - y);
  const right = [...b].sort((x, y) => x - y);
  return left.every((value, index) => Math.abs(value - right[index]) <= numericTolerance(value));
}

/**
 * Whether the student's final answer is the key's, decided by code and only when it can be decided
 * with confidence: `true` (it is), `false` (it is not), or `null` (it cannot be told — the key is not
 * numeric, the answer is missing or not a number, the reading was in doubt or the two reading passes
 * disagreed, or the student's unit makes the comparison meaningless). Null always means "ask a person
 * or a model", never "wrong".
 */
export function finalAnswerVerdict(
  reading: ReconciledReading,
  expectation: StructuredExpectation | null,
): boolean | null {
  const key = expectation?.solvable ? expectation.correctAnswer : null;

  // An answer with several values ("x = 2 or x = -3"): a student who wrote the whole set is judged against the
  // whole set. One value of two is neither right nor wrong here — a person (or the scheme) decides — and a set
  // is never judged value by value.
  if (key?.parsedSet) {
    const written = reading.studentAnswer?.parsedSet;
    if (!reading.attempted || !written) return null;
    if (reading.structureConfidence === "low" || reading.agreementConfidence === "low") return null;
    const otherPass = reading.secondPass === undefined ? undefined : (reading.secondPass?.studentAnswer ?? null);
    if (reading.secondPass !== undefined && !(otherPass?.parsedSet && setsAgree(written, otherPass.parsedSet))) return null;
    return setsAgree(key.parsedSet, written);
  }

  if (!key || key.parsed === null) return null;
  if (!reading.attempted || !reading.studentAnswer || reading.studentAnswer.parsed === null) return null;
  if (reading.structureConfidence === "low" || reading.agreementConfidence === "low") return null;

  const otherPass = reading.secondPass === undefined ? undefined : (reading.secondPass?.studentAnswer ?? null);
  if (!confirmedBySecondPass(reading, reading.studentAnswer, otherPass)) return null;

  const comparable = effectiveActual(key, reading.studentAnswer);
  if (comparable === null) return null;
  if (matchesExpected(key.parsed, comparable)) return true;
  if (unitMayExplainDifference(key, reading.studentAnswer)) return null;
  return false;
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
  const comparable = effectiveActual(expected, actual);
  return comparable !== null && matchesExpected(expected.parsed, comparable);
}

interface ApproachComparison {
  approachLabel: string;
  errors: ComparisonError[];
  matchedVariableCount: number;
  totalExpectedVariableCount: number;
}

function compareAgainstApproach(
  reading: ReconciledReading,
  approach: StructuredApproachExpectation,
  correctAnswer: ExtractedValue | null,
  nextErrorId: () => string,
): ApproachComparison {
  const errors: ComparisonError[] = [];

  const studentValues = indexStudentValues(reading.variables);
  const workingNumbers = numbersInWorking(reading);

  let matchedVariableCount = 0;
  // A quantity whose value IS the final answer (the rubric lists "R_eq = 2.4" and the answer is 2.4) is the
  // final answer again: the final-answer comparison already covers it, and checking it twice only produces a
  // second, redundant finding about the same number.
  const expectedEntries = Object.entries(approach.variables).filter(
    ([, value]) =>
      !(
        correctAnswer?.parsed != null &&
        value.parsed != null &&
        Math.abs(value.parsed - correctAnswer.parsed) <= numericTolerance(correctAnswer.parsed)
      ),
  );

  // A student who arrived at the right final answer cannot have skipped a step
  // needed to reach it, so a quantity we failed to find is our reader missing
  // it, not the student omitting it. Suppressing that here matters: a missing
  // quantity is the one finding inferred from ABSENCE, so it is the only one
  // an imperfect read can invent out of nothing — and it did, telling a student
  // who scored full marks that they had left out a value they plainly wrote.
  const reachedCorrectAnswer = valuesMatchNumerically(correctAnswer, reading.studentAnswer);

  const otherPassAnswer =
    reading.secondPass === undefined ? undefined : (reading.secondPass?.studentAnswer ?? null);
  const answerConfirmed =
    !!reading.studentAnswer && confirmedBySecondPass(reading, reading.studentAnswer, otherPassAnswer);

  // Absence of a value is only evidence of a skipped step when the student's
  // final answer is KNOWN to be wrong, or they gave none. If their answer
  // can't be evaluated ("50%", "x = 2 or 3"), or the two reads disagree about
  // it, they may well have reached the right answer — and then a "missing"
  // value is our reader missing it.
  const finalAnswerKnownWrong =
    !reading.studentAnswer ||
    (answerConfirmed && reading.studentAnswer.parsed !== null && !reachedCorrectAnswer &&
      !(correctAnswer?.parsed != null && unitMayExplainDifference(correctAnswer, reading.studentAnswer)));

  for (const [expectedName, expectedValue] of expectedEntries) {
    const aliases = approach.aliases?.[expectedName] ?? [];
    const found = lookupStudentValue(studentValues, expectedName, aliases);

    if (!found) {
      // Absence is only evidence when nothing else explains it. Each of these
      // does: the student reached the right answer; the other reading pass DID
      // find this value (so it is our reader that disagrees, not the student);
      // only one pass ran, so nothing could be cross-checked; or the value is
      // plainly in their working, just not given a name.
      const otherPassValue = secondPassVariable(reading, expectedName, aliases);
      const explainedAway =
        !finalAnswerKnownWrong ||
        (otherPassValue !== undefined && otherPassValue !== null) ||
        reading.secondPass === null ||
        appearsInWorking(expectedValue, workingNumbers);
      if (!explainedAway) {
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
    // A wrong value is only claimed when the names match exactly (case
    // included) and both reading passes saw the same value. A case-only match
    // (m vs M) may be a different quantity, and a value the two passes read
    // differently may be our misreading — either way, not a student's mistake.
    if (!found.exact) continue;
    if (!confirmedBySecondPass(reading, found.value, secondPassVariable(reading, expectedName, aliases))) continue;
    const mismatch = compareValue(expectedValue, found.value, "WRONG_SUBSTITUTION");
    if (mismatch) {
      errors.push({ id: nextErrorId(), variable: expectedName, ...mismatch, dependsOn: [] });
    }
  }

  // The final answer is compared last so it can depend on the substitution
  // errors found above. A wrong final value that a wrong input already
  // explains is a consequence, not a second independent mistake — saying
  // otherwise would tell a student they made two errors when they made one.
  if (correctAnswer && reading.studentAnswer && answerConfirmed) {
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
  reading: ReconciledReading,
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
  // Without a numeric final answer nothing can be compared numerically, and
  // the only finding left — a "missing" value — would be inferred against an
  // answer we cannot evaluate (a balanced equation, a name, a sentence). That
  // told a student who scored 4/4 that they had "missed step a".
  if (!expectation.correctAnswer || expectation.correctAnswer.parsed === null) {
    return empty("skipped_not_numeric");
  }
  // A reading the model itself was unsure of, or that the two passes largely
  // disagreed on, is too weak a footing for any claim about the student.
  if (reading.structureConfidence === "low" || reading.agreementConfidence === "low") {
    return empty("skipped_low_confidence");
  }

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
