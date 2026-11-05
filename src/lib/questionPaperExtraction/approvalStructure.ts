import { validateTree, type QuestionTree, type TreeNode } from "@/lib/questions/tree";
import { ANSWER_TYPES } from "@/lib/questionPaperExtraction/structure";
import type { DraftTreeNode, QuestionAnswerTypeName } from "@/types/questionPaper";

/**
 * When a teacher approves the questions read from a paper, the labels, suggested
 * answer types and the structure (parts, "(a) OR (b)", "any N of M") stored with
 * the draft are carried onto the real questions.
 *
 * The review screen lets a teacher fix the text and marks of each question. It
 * cannot yet restructure a paper: removing or renumbering a question that belongs
 * to a part, a choice or an optional group would silently change what the paper
 * is out of, so that is refused with a clear message instead.
 *
 * Pure: no database.
 */

export interface ReviewedQuestion {
  number: number;
}

export type StructureOutcome =
  | {
      ok: true;
      labels: Map<number, string>;
      answerTypes: Map<number, QuestionAnswerTypeName>;
      /** The structure with leaves still referring to question numbers; null for a plain list. */
      tree: DraftTreeNode[] | null;
    }
  | { ok: false; message: string };

function isDraftTree(raw: unknown): raw is DraftTreeNode[] {
  const valid = (node: unknown, depth: number): boolean => {
    if (typeof node !== "object" || node === null || depth > 6) return false;
    const n = node as { kind?: unknown; number?: unknown; children?: unknown };
    if (n.kind === "LEAF") return typeof n.number === "number";
    if (n.kind !== "GROUP" && n.kind !== "CHOICE" && n.kind !== "OPTIONAL") return false;
    return Array.isArray(n.children) && n.children.every((child) => valid(child, depth + 1));
  };
  return Array.isArray(raw) && raw.every((node) => valid(node, 0));
}

export function resolveStructure(reviewed: ReviewedQuestion[], storedDraft: unknown): StructureOutcome {
  const labels = new Map<number, string>();
  const answerTypes = new Map<number, QuestionAnswerTypeName>();

  const draft = typeof storedDraft === "object" && storedDraft !== null ? (storedDraft as { questions?: unknown; tree?: unknown }) : {};
  const stored = Array.isArray(draft.questions) ? draft.questions : [];
  const storedNumbers = new Set<number>();

  for (const item of stored) {
    if (typeof item !== "object" || item === null) continue;
    const q = item as { number?: unknown; label?: unknown; answerType?: unknown };
    if (typeof q.number !== "number") continue;
    storedNumbers.add(q.number);
    if (typeof q.label === "string" && q.label.trim()) labels.set(q.number, q.label.trim());
    if (typeof q.answerType === "string" && (ANSWER_TYPES as readonly string[]).includes(q.answerType)) {
      answerTypes.set(q.number, q.answerType as QuestionAnswerTypeName);
    }
  }

  const tree = isDraftTree(draft.tree) && draft.tree.length > 0 ? draft.tree : null;
  if (!tree) return { ok: true, labels, answerTypes, tree: null };

  const reviewedNumbers = reviewed.map((q) => q.number);
  const sameQuestions =
    reviewedNumbers.length === storedNumbers.size && reviewedNumbers.every((number) => storedNumbers.has(number));
  if (!sameQuestions) {
    return {
      ok: false,
      message:
        "This paper has parts, choices or optional questions, so questions can't be added, removed or renumbered here — only their text and marks can be edited. Put the list back as it was extracted.",
    };
  }
  return { ok: true, labels, answerTypes, tree };
}

/** The draft's structure with each leaf pointing at the real question it became. Null when it does not fit. */
export function treeForQuestions(tree: DraftTreeNode[], idByNumber: Map<number, string>): QuestionTree | null {
  const convert = (node: DraftTreeNode): TreeNode | null => {
    if (node.kind === "LEAF") {
      const questionId = idByNumber.get(node.number);
      return questionId ? { kind: "LEAF", questionId } : null;
    }
    const children = node.children.map(convert);
    if (children.some((child) => child === null)) return null;
    const kids = children as TreeNode[];
    if (node.kind === "OPTIONAL") return { kind: "OPTIONAL", ...(node.label ? { label: node.label } : {}), pick: node.pick, children: kids };
    return { kind: node.kind, ...(node.label ? { label: node.label } : {}), children: kids };
  };
  const nodes = tree.map(convert);
  if (nodes.some((node) => node === null)) return null;
  const result: QuestionTree = { nodes: nodes as TreeNode[] };
  return validateTree(result, [...idByNumber.values()]).ok ? result : null;
}
