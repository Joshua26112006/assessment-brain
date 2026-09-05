/**
 * Small deterministic text helpers shared by several pipeline stages.
 *
 * Deliberately simple (lowercase + split + stopword filter): this is a
 * placeholder for keyword-overlap heuristics, not an attempt at real NLP.
 * A future AI stage can replace how terms/overlap are computed without
 * changing any stage's input/output contract.
 */

const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "of", "in", "on", "at", "to", "for", "and", "or", "but", "with",
  "what", "which", "who", "whom", "this", "that", "these", "those",
  "do", "does", "did", "how", "why", "it", "its", "as", "by", "from",
]);

/** Lowercases, strips punctuation, and splits on whitespace. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

/** Deterministic "significant terms": tokenized, stopwords removed, deduped. */
export function extractKeyTerms(text: string, limit = 12): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const token of tokenize(text)) {
    if (token.length < 3 || STOPWORDS.has(token) || seen.has(token)) continue;
    seen.add(token);
    terms.push(token);
    if (terms.length >= limit) break;
  }
  return terms;
}

/**
 * Which of `terms` appear as whole words in `text` (already expected to be
 * lowercased/normalized). Used as the deterministic "evidence" for both
 * correction and novel-approach detection.
 */
export function findMatchingTerms(text: string, terms: string[]): string[] {
  return terms.filter((term) => new RegExp(`\\b${escapeRegExp(term)}\\b`).test(text));
}

export function overlapRatio(text: string, terms: string[]): number {
  if (terms.length === 0) return 0;
  return findMatchingTerms(text, terms).length / terms.length;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
