/**
 * Self-consistency reconciliation for two independent reads of the same
 * handwriting.
 *
 * A single vision-model read of a handwritten page is not reliably repeatable:
 * the same upload read twice can differ on whether a question was even
 * attempted. Reading twice and comparing turns that into a measurable signal —
 * where the two passes agree the result is trustworthy, and where they don't
 * the disagreement is recorded rather than hidden behind one arbitrary read.
 *
 * Confidence here describes AGREEMENT BETWEEN PASSES only. It is not a claim
 * about whether the student's answer is correct.
 */

import type { ReconcileConfidence } from "@/types/mathCorrection";

const HIGH_SIMILARITY_THRESHOLD = 0.85;
const MEDIUM_SIMILARITY_THRESHOLD = 0.5;

const CONFIDENCE_RANK: Record<ReconcileConfidence, number> = { high: 2, medium: 1, low: 0 };

/** Keeps the worse of two independent signals — either one being low is reason enough to distrust the item. */
export function worseConfidence(a: ReconcileConfidence, b: ReconcileConfidence): ReconcileConfidence {
  return CONFIDENCE_RANK[a] <= CONFIDENCE_RANK[b] ? a : b;
}

function normalizeForCompare(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[.,;:!?()"'`]/g, "")
    .replace(/\s+/g, " ");
}

function tokenize(value: string): Set<string> {
  return new Set(normalizeForCompare(value).split(" ").filter(Boolean));
}

/**
 * Jaccard token overlap, 0 (nothing shared) to 1 (identical token sets).
 * Token-set rather than character-level: two honest reads of the same
 * handwriting differ in punctuation and spacing far more often than in the
 * words themselves, and character-level distance would punish that noise.
 */
export function similarityRatio(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const token of tokensA) if (tokensB.has(token)) intersection++;

  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

export interface ReconciledEntry<T> {
  confidence: ReconcileConfidence;
  value: T;
  agreed: boolean;
}

/**
 * Reconciles two passes over the same keyed items. `textOf` supplies the
 * comparable text; `pickPreferred` decides which read to keep when they
 * disagree.
 *
 * An item only one pass produced is kept but marked low confidence: it could
 * not be cross-checked, and silently trusting a read the other pass didn't
 * reproduce is exactly the failure this reconciliation exists to prevent.
 */
export function reconcileByKey<K extends string | number, T>(
  passA: Map<K, T>,
  passB: Map<K, T>,
  textOf: (value: T) => string,
  pickPreferred: (a: T, b: T) => T,
): Map<K, ReconciledEntry<T>> {
  const keys = new Set<K>([...passA.keys(), ...passB.keys()]);
  const result = new Map<K, ReconciledEntry<T>>();

  for (const key of keys) {
    const a = passA.get(key);
    const b = passB.get(key);

    if (a && !b) {
      result.set(key, { confidence: "low", value: a, agreed: false });
      continue;
    }
    if (b && !a) {
      result.set(key, { confidence: "low", value: b, agreed: false });
      continue;
    }
    if (!a || !b) continue;

    const similarity = similarityRatio(textOf(a), textOf(b));
    if (similarity >= HIGH_SIMILARITY_THRESHOLD) {
      result.set(key, { confidence: "high", value: a, agreed: true });
    } else if (similarity >= MEDIUM_SIMILARITY_THRESHOLD) {
      result.set(key, { confidence: "medium", value: pickPreferred(a, b), agreed: false });
    } else {
      result.set(key, { confidence: "low", value: pickPreferred(a, b), agreed: false });
    }
  }

  return result;
}
