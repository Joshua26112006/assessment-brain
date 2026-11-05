import { parseStructuredValue } from "@/lib/structuredCorrection/numericExpression";
import { splitQuantity } from "@/lib/structuredCorrection/units";
import {
  PROBLEM_TYPES,
  UNSOLVABLE_REASONS,
  type ExtractedValue,
  type ProblemType,
  type StructuredApproachExpectation,
  type StructuredExpectation,
  type UnsolvableReason,
} from "@/types/structuredCorrection";

/**
 * The machine-comparable half of rubric generation.
 *
 * Produced for every subject, not a chosen list of them: the question itself
 * decides whether it has one definite checkable answer, and it reports
 * solvable: false when it does not. Selecting subjects by name was tried and
 * failed — a Statistics paper is mathematics, and no subject-name test
 * recognised it, so those papers silently never got a checkable rubric.
 *
 * Kept out of ai.ts deliberately: the prose rubric a teacher reads is the
 * primary product and its generation/validation is unchanged by this file.
 * Everything here is additive, and every failure path returns null rather
 * than throwing — a question whose structured expectation can't be produced
 * still gets a perfectly good prose rubric, and simply isn't eligible for the
 * deterministic comparison flow.
 */

const MAX_LABEL_LENGTH = 200;
const MAX_FORMULA_LENGTH = 500;
const MAX_VALUE_LENGTH = 200;
/** Guards against a model returning an unbounded variable map for a malformed question. */
const MAX_VARIABLES_PER_APPROACH = 40;

/**
 * Appended to the rubric-generation system prompt for every question. The
 * numbering continues from the existing prompt's rules so the model reads one
 * coherent list rather than two competing instruction blocks.
 */
export function buildStructuredExpectationInstructions(): string {
  return [
    "",
    "ADDITIONALLY, include one more top-level field, \"structuredExpectation\", so a program can later compare a student's written working against this rubric numerically:",
    '"structuredExpectation": {"solvable": boolean, "unsolvableReason": string, "problemType": string, "correctAnswer": string, "approaches": [{"label": string, "formulaName": string, "formulaExpression": string, "variables": {"<name>": "<value>"}, "aliases": {"<name>": ["<other name>"]}}]}',
    "",
    "7. solvable: true ONLY if this question reduces to one definite, checkable final value (e.g. \"find the mode\", \"calculate the probability\"). Set it to false for a proof, a construction, an explanation, or any question with more than one legitimately different final answer — that is a normal and expected outcome, not a failure.",
    "8. unsolvableReason: required when solvable is false, and must be exactly one of: \"conceptual_question\", \"proof_based\", \"multiple_valid_answers\", \"diagram_required\", \"insufficient_information\", \"other\". Omit it entirely when solvable is true.",
    "9. problemType: exactly one of \"mean\", \"median\", \"mode\", \"range\", \"probability\", \"algebra\", \"coordinate_geometry\". If the question genuinely fits none of these, or you are not confident, use \"unknown\" — never force a guess.",
    "10. correctAnswer: the single correct final value, written plainly (e.g. \"34.17\", \"5/12\", \"20\"). If the quantity has a unit, write the unit after the number using standard symbols (e.g. \"4 m/s^2\", \"120 J\", \"2 g\"); a unit is part of the answer. Use an empty string when solvable is false. Add no other words or commentary.",
    "11. approaches: ONE entry for each entry in solutionApproaches above, in the SAME ORDER, with the SAME label. For each, give the specific named quantities that approach actually uses, with the correct value for each, taken from the data in the question (e.g. {\"L\": \"30\", \"f1\": \"15\", \"f0\": \"9\", \"f2\": \"8\", \"h\": \"10\"}). Write each value as plain text exactly as it should be — never as a worded sentence. Use {} only if the approach genuinely has no named quantities. Use [] for approaches when solvable is false.",
    "12. Never invent a variable the question does not support, and never round a value differently from how the question states it.",
    "13. Per approach, add \"aliases\": {\"<name>\": [\"other name\", ...]} for EVERY quantity a student is likely to write under a different name: the word for a symbol, a subscripted form, a symbol the textbook varies (e.g. {\"u\": [\"v0\", \"initial velocity\"], \"R_eq\": [\"R\", \"total resistance\"]}). Only real synonyms of the same quantity, never a different quantity; omit a quantity that has no other common name.",
  ].join("\n");
}

function toTrimmed(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

/** Every numeric value is evaluated by our own parser — never taken from the model. */
function toExtractedValue(value: unknown): ExtractedValue {
  const raw = toTrimmed(value, MAX_VALUE_LENGTH);
  const unit = raw ? splitQuantity(raw).unitText : null;
  // One number, or an answer with several values (a set, an interval, an ordered pair), kept in that shape.
  return { raw, ...parseStructuredValue(raw), ...(unit ? { unit } : {}) };
}

function toProblemType(value: unknown): ProblemType {
  return typeof value === "string" && (PROBLEM_TYPES as readonly string[]).includes(value)
    ? (value as ProblemType)
    : "unknown";
}

function toUnsolvableReason(value: unknown): UnsolvableReason {
  return typeof value === "string" && (UNSOLVABLE_REASONS as readonly string[]).includes(value)
    ? (value as UnsolvableReason)
    : "other";
}

function parseApproaches(raw: unknown): StructuredApproachExpectation[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item): StructuredApproachExpectation => {
      const variables: Record<string, ExtractedValue> = {};
      if (item.variables && typeof item.variables === "object" && !Array.isArray(item.variables)) {
        for (const [name, value] of Object.entries(item.variables as Record<string, unknown>).slice(
          0,
          MAX_VARIABLES_PER_APPROACH,
        )) {
          const trimmedName = name.trim();
          if (!trimmedName) continue;
          const extracted = toExtractedValue(value);
          if (extracted.raw) variables[trimmedName] = extracted;
        }
      }

      // Other names a student may use for a quantity, kept only for quantities this approach actually has.
      const aliases: Record<string, string[]> = {};
      if (item.aliases && typeof item.aliases === "object" && !Array.isArray(item.aliases)) {
        for (const [name, list] of Object.entries(item.aliases as Record<string, unknown>)) {
          if (!(name in variables) || !Array.isArray(list)) continue;
          const names = list
            .filter((alias): alias is string => typeof alias === "string" && alias.trim().length > 0)
            .map((alias) => alias.trim().slice(0, 60))
            .slice(0, 8);
          if (names.length > 0) aliases[name] = names;
        }
      }

      return {
        label: toTrimmed(item.label, MAX_LABEL_LENGTH),
        formulaName: toTrimmed(item.formulaName, MAX_LABEL_LENGTH),
        formulaExpression: toTrimmed(item.formulaExpression, MAX_FORMULA_LENGTH),
        variables,
        ...(Object.keys(aliases).length > 0 ? { aliases } : {}),
      };
    })
    // An approach with no named variables contributes nothing the comparison
    // stage can check, so it is dropped rather than kept as an empty candidate
    // that would trivially "match" every student answer with zero errors.
    .filter((approach) => Object.keys(approach.variables).length > 0);
}

/**
 * Returns null when the model returned nothing usable — the caller treats that
 * as "this question simply isn't eligible for deterministic comparison", which
 * is materially different from a solvable question whose expectation we did
 * capture, and different again from `solvable: false`, which is a deliberate
 * verdict that the question has no single checkable answer.
 */
export function parseStructuredExpectation(raw: unknown): StructuredExpectation | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  const problemType = toProblemType(obj.problemType);

  if (obj.solvable !== true) {
    return {
      solvable: false,
      unsolvableReason: toUnsolvableReason(obj.unsolvableReason),
      problemType,
      correctAnswer: null,
      approaches: [],
    };
  }

  const correctAnswer = toExtractedValue(obj.correctAnswer);
  const approaches = parseApproaches(obj.approaches);

  // A question claimed solvable but carrying neither a final answer nor a
  // single checkable approach gives the comparison stage nothing to work
  // with. Recording it as solvable would misrepresent it, so it is downgraded
  // to an explicit verdict rather than stored as a hollow expectation.
  if (!correctAnswer.raw && approaches.length === 0) {
    return {
      solvable: false,
      unsolvableReason: "other",
      problemType,
      correctAnswer: null,
      approaches: [],
    };
  }

  return {
    solvable: true,
    problemType,
    correctAnswer: correctAnswer.raw ? correctAnswer : null,
    approaches,
  };
}
