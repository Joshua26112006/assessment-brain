import { normalizeLabel } from "@/lib/questions/labels";
import type { DraftTreeNode, ExtractedQuestionDraft, QuestionAnswerTypeName } from "@/types/questionPaper";

/**
 * Turns the nested items a model read off a question paper into what the rest of
 * the system stores: a flat list of answerable questions (each with a label and a
 * suggested answer type) plus, when the paper has any structure, a tree saying how
 * they combine (decision D4 of 06-correction-hardening-plan.md):
 *
 *   parts        1(a), 1(b): all count
 *   alternatives "(a) OR (b)": the student answers one
 *   optional     "attempt any 5 of 7": the best N count
 *
 * A paper with none of these comes out exactly as the flat list it always was.
 *
 * Pure: no model, no database.
 */

export const ANSWER_TYPES: readonly QuestionAnswerTypeName[] = [
  "NUMERIC",
  "SHORT_TEXT",
  "DESCRIPTIVE",
  "ESSAY",
  "EXACT_KEY",
  "DIAGRAM",
];

const MAX_TEXT = 4000;
const MAX_DEPTH = 5;
const MAX_LEAVES = 500;

export interface FlattenResult {
  questions: ExtractedQuestionDraft[];
  /** Null when the paper is a plain list of questions. */
  tree: DraftTreeNode[] | null;
  warnings: string[];
}

function marksOf(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value < 0 || value > 1000 ? null : value;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_TEXT) : "";
}

function answerTypeOf(value: unknown): QuestionAnswerTypeName | undefined {
  return typeof value === "string" && (ANSWER_TYPES as readonly string[]).includes(value)
    ? (value as QuestionAnswerTypeName)
    : undefined;
}

/** A child's label in full: "(a)" under "3" is "3(a)"; a label that already carries the number is kept. */
function childLabel(parentLabel: string, written: unknown, index: number, fallbackStyle: "part" | "alternative"): string {
  const raw = typeof written === "string" ? written.trim() : "";
  if (raw) {
    const normalized = normalizeLabel(raw);
    if (normalized) {
      // "3(b)" stays; "(b)" under "3" becomes "3(b)".
      return normalized.startsWith("(") ? `${parentLabel}${normalized}` : normalized;
    }
    return `${parentLabel}${raw}`;
  }
  const letter = String.fromCharCode(97 + (index % 26));
  return fallbackStyle === "part" ? `${parentLabel}(${letter})` : `${parentLabel}(${letter})`;
}

/**
 * Plain-language lines describing how a paper's questions combine, for the teacher's review
 * screen: only the parts of the paper that are not simply "answer everything".
 */
export function describeTree(
  nodes: DraftTreeNode[],
  labelByNumber: Map<number, string>,
): string[] {
  const nameOf = (node: DraftTreeNode): string => {
    if (node.kind === "LEAF") return labelByNumber.get(node.number) ?? String(node.number);
    if (node.label) return node.label;
    return node.children.map(nameOf).join(", ");
  };
  const lines: string[] = [];
  const walk = (node: DraftTreeNode) => {
    if (node.kind === "LEAF") return;
    if (node.kind === "CHOICE") {
      lines.push(`Answer ONE of: ${node.children.map(nameOf).join("  or  ")}. If a student answers both, the higher mark counts.`);
    } else if (node.kind === "OPTIONAL") {
      lines.push(
        `Answer any ${node.pick} of ${node.children.length}: ${node.children.map(nameOf).join(", ")}. The best ${node.pick} count.`,
      );
    }
    node.children.forEach(walk);
  };
  nodes.forEach(walk);
  return lines;
}

export function flattenExtraction(rawQuestions: unknown): FlattenResult {
  const warnings: string[] = [];
  if (!Array.isArray(rawQuestions)) return { questions: [], tree: null, warnings };

  interface Leaf extends ExtractedQuestionDraft {
    /** The printed top-level number, kept for a paper with no structure. */
    printedNumber: number;
  }
  const leaves: Leaf[] = [];
  let hasStructure = false;

  const walk = (
    item: unknown,
    label: string,
    printedNumber: number,
    stems: string[],
    depth: number,
  ): DraftTreeNode | null => {
    if (typeof item !== "object" || item === null || depth > MAX_DEPTH) return null;
    const entry = item as Record<string, unknown>;
    const own = textOf(entry.text);

    const optional = entry.optional as { pick?: unknown; of?: unknown } | undefined;
    const alternatives = Array.isArray(entry.alternatives) ? entry.alternatives : null;
    const parts = Array.isArray(entry.parts) ? entry.parts : null;
    const nextStems = own ? [...stems, own] : stems;

    if (optional && Array.isArray(optional.of) && optional.of.length >= 1) {
      hasStructure = true;
      const children = optional.of
        .map((child, index) => walk(child, childLabel(label, (child as { label?: unknown })?.label, index, "part"), printedNumber, nextStems, depth + 1))
        .filter((node): node is DraftTreeNode => node !== null);
      if (children.length === 0) return null;
      const pick = Math.max(1, Math.min(Math.floor(Number(optional.pick)) || children.length, children.length));
      return { kind: "OPTIONAL", label, pick, children };
    }

    if (alternatives && alternatives.length >= 2) {
      hasStructure = true;
      const children = alternatives
        .map((child, index) => walk(child, childLabel(label, (child as { label?: unknown })?.label, index, "alternative"), printedNumber, nextStems, depth + 1))
        .filter((node): node is DraftTreeNode => node !== null);
      if (children.length >= 2) return { kind: "CHOICE", label, children };
      if (children.length === 1) return children[0];
      return null;
    }

    if (parts && parts.length >= 1) {
      hasStructure = true;
      const children = parts
        .map((child, index) => walk(child, childLabel(label, (child as { label?: unknown })?.label, index, "part"), printedNumber, nextStems, depth + 1))
        .filter((node): node is DraftTreeNode => node !== null);
      if (children.length === 0) return null;
      return { kind: "GROUP", label, children };
    }

    // A leaf: something a student writes an answer to. It needs question text.
    const text = [...stems, own].filter(Boolean).join("\n");
    if (!own || leaves.length >= MAX_LEAVES) return null;
    leaves.push({
      number: 0,
      printedNumber,
      label,
      text: text.slice(0, MAX_TEXT),
      marks: marksOf(entry.marks),
      uncertain: entry.uncertain === true,
      ...(answerTypeOf(entry.answerType) ? { answerType: answerTypeOf(entry.answerType) } : {}),
    });
    return { kind: "LEAF", number: leaves.length };
  };

  const top: DraftTreeNode[] = [];
  for (const item of rawQuestions) {
    if (typeof item !== "object" || item === null) continue;
    const number = (item as { number?: unknown }).number;
    if (typeof number !== "number" || !Number.isInteger(number) || number <= 0 || number > 500) {
      warnings.push("An item on the paper had no usable question number and was left out.");
      continue;
    }
    const explicit = textOf((item as { label?: unknown }).label);
    const label = explicit ? normalizeLabel(explicit) ?? explicit : String(number);
    const node = walk(item, label, number, [], 0);
    if (node) top.push(node);
  }

  // A paper with no structure keeps the printed numbers, exactly as before. One with structure needs a
  // unique ordinal per answerable question, so they are numbered in paper order; the label is what shows.
  const flat = !hasStructure;
  leaves.forEach((leaf, index) => {
    leaf.number = flat ? leaf.printedNumber : index + 1;
  });

  const questions: ExtractedQuestionDraft[] = leaves.map((leaf) => ({
    number: leaf.number,
    label: leaf.label,
    text: leaf.text,
    marks: leaf.marks,
    uncertain: leaf.uncertain,
    ...(leaf.answerType ? { answerType: leaf.answerType } : {}),
  }));

  // The tree's leaves carry the ordinal assigned above.
  const renumber = (node: DraftTreeNode): DraftTreeNode => {
    if (node.kind === "LEAF") return { kind: "LEAF", number: leaves[node.number - 1].number };
    return { ...node, children: node.children.map(renumber) };
  };

  return { questions, tree: flat ? null : top.map(renumber), warnings };
}
