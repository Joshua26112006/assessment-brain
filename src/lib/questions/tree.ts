/**
 * How a paper's questions nest, and how marks add up through that nesting
 * (decisions D4 and D14 of 06-correction-hardening-plan.md).
 *
 *   GROUP    parts that all count: 1(a) + 1(b).
 *   CHOICE   internal choice, "(a) OR (b)": the student answers one. If they answer both,
 *            both are marked, the HIGHER counts, and the other is kept and shown as an
 *            "over attempt" (marked *) but excluded from the total (CBSE 2026 rule).
 *   OPTIONAL "attempt any N of M": the best N attempted count; the rest are over attempts.
 *
 * Totals are decided here, in code, never by a model. Pure: no database.
 */

export type TreeNode =
  | { kind: "LEAF"; questionId: string }
  | { kind: "GROUP"; label?: string; children: TreeNode[] }
  | { kind: "CHOICE"; label?: string; children: TreeNode[] }
  | { kind: "OPTIONAL"; label?: string; pick: number; children: TreeNode[] };

/** The paper: a list of top-level nodes, every one of which counts. */
export interface QuestionTree {
  nodes: TreeNode[];
}

export interface LeafResult {
  maximumMarks: number;
  /** Null until the answer has a mark. */
  awardedMarks: number | null;
  /** The student wrote an answer for this question. */
  attempted: boolean;
}

export interface LeafOutcome {
  /** This answer's marks are in the total. */
  counted: boolean;
  /** Attempted, but a better alternative counts instead: shown with *, excluded from the total. */
  overAttempt: boolean;
}

export interface Totals {
  awarded: number;
  /** What the paper is out of: the marks of what a student was REQUIRED to answer, not of everything printed. */
  maximum: number;
  perLeaf: Map<string, LeafOutcome>;
  /** Attempted answers still waiting for a mark. While this is above 0 the total is provisional. */
  unmarkedCount: number;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

interface NodeResult {
  awarded: number;
  maximum: number;
  attempted: boolean;
  unmarked: number;
  leaves: string[];
}

function sumMax(values: number[]): number {
  return round2(values.reduce((a, b) => a + b, 0));
}

function evaluate(node: TreeNode, leaves: Map<string, LeafResult>, perLeaf: Map<string, LeafOutcome>): NodeResult {
  if (node.kind === "LEAF") {
    const leaf = leaves.get(node.questionId);
    const maximum = leaf?.maximumMarks ?? 0;
    const attempted = leaf?.attempted ?? false;
    const marked = leaf?.awardedMarks !== null && leaf?.awardedMarks !== undefined;
    perLeaf.set(node.questionId, { counted: true, overAttempt: false });
    return {
      awarded: marked ? (leaf!.awardedMarks as number) : 0,
      maximum,
      attempted,
      unmarked: attempted && !marked ? 1 : 0,
      leaves: [node.questionId],
    };
  }

  const children = node.children.map((child) => evaluate(child, leaves, perLeaf));
  const leafIds = children.flatMap((child) => child.leaves);
  const attempted = children.some((child) => child.attempted);

  if (node.kind === "GROUP") {
    return {
      awarded: sumMax(children.map((c) => c.awarded)),
      maximum: sumMax(children.map((c) => c.maximum)),
      attempted,
      unmarked: children.reduce((a, c) => a + c.unmarked, 0),
      leaves: leafIds,
    };
  }

  const pick = node.kind === "CHOICE" ? 1 : Math.max(0, Math.min(node.pick, children.length));

  // Which alternatives count: the best `pick` among those attempted, highest mark first, earlier wins a tie.
  const ranked = children
    .map((child, index) => ({ child, index }))
    .filter(({ child }) => child.attempted)
    .sort((a, b) => b.child.awarded - a.child.awarded || a.index - b.index);
  const chosen = new Set(ranked.slice(0, pick).map(({ index }) => index));

  children.forEach((child, index) => {
    if (chosen.has(index)) return;
    for (const id of child.leaves) {
      const outcome = perLeaf.get(id);
      if (!outcome) continue;
      // An alternative the student did not attempt is simply not counted; one they did attempt is an over attempt.
      perLeaf.set(id, { counted: false, overAttempt: child.attempted });
    }
  });

  // The paper is out of the marks of what had to be answered: the best `pick` alternatives by size.
  const maxima = children.map((child) => child.maximum).sort((a, b) => b - a);
  return {
    awarded: sumMax([...chosen].map((index) => children[index].awarded)),
    maximum: sumMax(maxima.slice(0, pick)),
    attempted,
    unmarked: [...chosen].reduce((a, index) => a + children[index].unmarked, 0),
    leaves: leafIds,
  };
}

/** Every leaf under the tree, in paper order. */
export function leafIdsOf(tree: QuestionTree): string[] {
  const out: string[] = [];
  const walk = (node: TreeNode) => {
    if (node.kind === "LEAF") out.push(node.questionId);
    else node.children.forEach(walk);
  };
  tree.nodes.forEach(walk);
  return out;
}

/** A flat list of questions, which is every paper without a stored tree. */
export function flatTree(questionIds: string[]): QuestionTree {
  return { nodes: questionIds.map((questionId) => ({ kind: "LEAF" as const, questionId })) };
}

/** The total a student earned, and what the paper is out of, from each question's mark. */
export function computeTotals(tree: QuestionTree, leaves: Map<string, LeafResult>): Totals {
  const perLeaf = new Map<string, LeafOutcome>();
  const results = tree.nodes.map((node) => evaluate(node, leaves, perLeaf));
  return {
    awarded: sumMax(results.map((r) => r.awarded)),
    maximum: sumMax(results.map((r) => r.maximum)),
    perLeaf,
    unmarkedCount: results.reduce((a, r) => a + r.unmarked, 0),
  };
}

/** What the paper is out of, whatever a student attempted. */
export function paperMaximum(tree: QuestionTree, leafMaxima: Map<string, number>): number {
  const leaves = new Map<string, LeafResult>();
  for (const [id, maximumMarks] of leafMaxima) leaves.set(id, { maximumMarks, awardedMarks: null, attempted: false });
  return computeTotals(tree, leaves).maximum;
}

export type TreeValidation = { ok: true } | { ok: false; errors: string[] };

/** Structural checks: leaves exist and appear once, choices have alternatives, "any N" makes sense. */
export function validateTree(tree: QuestionTree, questionIds: string[]): TreeValidation {
  const errors: string[] = [];
  const known = new Set(questionIds);
  const seen = new Set<string>();

  const walk = (node: TreeNode, path: string) => {
    if (node.kind === "LEAF") {
      if (!known.has(node.questionId)) errors.push(`${path} refers to a question that does not exist.`);
      if (seen.has(node.questionId)) errors.push(`${path} appears more than once.`);
      seen.add(node.questionId);
      return;
    }
    if (node.children.length === 0) errors.push(`${path} has nothing in it.`);
    if (node.kind === "CHOICE" && node.children.length < 2) errors.push(`${path} is a choice but has fewer than two alternatives.`);
    if (node.kind === "OPTIONAL" && !(node.pick >= 1 && node.pick <= node.children.length)) {
      errors.push(`${path} asks for ${node.pick} but has ${node.children.length} questions.`);
    }
    node.children.forEach((child, index) => walk(child, `${path} > ${index + 1}`));
  };
  tree.nodes.forEach((node, index) => walk(node, `Item ${index + 1}`));

  for (const id of questionIds) if (!seen.has(id)) errors.push(`A question is missing from the paper's structure.`);
  return errors.length === 0 ? { ok: true } : { ok: false, errors: [...new Set(errors)] };
}

function parseNode(raw: unknown, depth: number): TreeNode | null {
  if (typeof raw !== "object" || raw === null || depth > 6) return null;
  const node = raw as Record<string, unknown>;
  if (node.kind === "LEAF") return typeof node.questionId === "string" ? { kind: "LEAF", questionId: node.questionId } : null;
  if (!Array.isArray(node.children)) return null;
  const children = node.children.map((child) => parseNode(child, depth + 1));
  if (children.some((child) => child === null)) return null;
  const label = typeof node.label === "string" ? node.label : undefined;
  const kids = children as TreeNode[];
  if (node.kind === "GROUP") return { kind: "GROUP", ...(label ? { label } : {}), children: kids };
  if (node.kind === "CHOICE") return { kind: "CHOICE", ...(label ? { label } : {}), children: kids };
  if (node.kind === "OPTIONAL") {
    const pick = Number(node.pick);
    return Number.isInteger(pick) ? { kind: "OPTIONAL", ...(label ? { label } : {}), pick, children: kids } : null;
  }
  return null;
}

/** The stored JSON as a tree, or null when it is absent or not a valid tree (callers then treat the paper as flat). */
export function parseTree(raw: unknown): QuestionTree | null {
  if (typeof raw !== "object" || raw === null || !Array.isArray((raw as { nodes?: unknown }).nodes)) return null;
  const nodes = ((raw as { nodes: unknown[] }).nodes).map((node) => parseNode(node, 0));
  if (nodes.some((node) => node === null)) return null;
  return { nodes: nodes as TreeNode[] };
}
