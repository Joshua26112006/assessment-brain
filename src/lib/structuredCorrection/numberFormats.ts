import { parseNumericExpression, parseNumericSet, type ParseOptions } from "@/lib/structuredCorrection/numericExpression";
import type { ExtractedValue, ReconciledReading, StructuredExpectation } from "@/types/structuredCorrection";

/**
 * Reads values written in a form a question's scheme accepts (owner decision, Nov 5): a percentage ("40%" is 0.4)
 * and a decimal comma ("2,5" is 2.5). Both are off unless the teacher ticks them, because left off such a value is
 * "cannot be read" and a person decides rather than the system guessing what a comma or a % meant.
 *
 * Only a value that could not be read before is read again, so a value that already had a number is never changed.
 * Pure: no model, no database.
 */

function reread(value: ExtractedValue, options: ParseOptions): ExtractedValue {
  if (value.parsed !== null || value.parsedSet !== undefined || !value.raw) return value;
  const parsed = parseNumericExpression(value.raw, options);
  if (parsed !== null) return { ...value, parsed };
  const parsedSet = parseNumericSet(value.raw, options);
  return parsedSet ? { ...value, parsedSet } : value;
}

export function applyNumberFormats(
  reading: ReconciledReading,
  expectation: StructuredExpectation | null,
  formats: { acceptPercent: boolean; decimalComma: boolean } | undefined,
): { reading: ReconciledReading; expectation: StructuredExpectation | null } {
  if (!formats || (!formats.acceptPercent && !formats.decimalComma)) return { reading, expectation };
  const options: ParseOptions = { acceptPercent: formats.acceptPercent, decimalComma: formats.decimalComma };

  const variables = Object.fromEntries(Object.entries(reading.variables).map(([name, value]) => [name, reread(value, options)]));
  return {
    reading: {
      ...reading,
      studentAnswer: reading.studentAnswer ? reread(reading.studentAnswer, options) : reading.studentAnswer,
      variables,
    },
    expectation: expectation
      ? {
          ...expectation,
          correctAnswer: expectation.correctAnswer ? reread(expectation.correctAnswer, options) : expectation.correctAnswer,
          approaches: expectation.approaches.map((approach) => ({
            ...approach,
            variables: Object.fromEntries(Object.entries(approach.variables).map(([name, value]) => [name, reread(value, options)])),
          })),
        }
      : expectation,
  };
}
