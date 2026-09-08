/**
 * Deterministic arithmetic evaluator for values that appear in rubrics and in
 * students' written working — plain numbers, fractions, and parenthesized
 * +-*\/ expressions (e.g. "5/12", "(15-9)/(30-10-8)", "20 x 10").
 *
 * Exists so that no numeric value the correction pipeline compares is ever
 * computed by a model: the AI supplies the raw text it read or wrote, and this
 * code decides what that text is worth. A recursive-descent parser rather than
 * eval()/Function(), which would execute arbitrary model-supplied text.
 *
 * Returns null rather than guessing whenever the input isn't cleanly reducible
 * to arithmetic — "not parseable" is a normal outcome (a modal class label, a
 * sentence), not an error, and the comparison engine treats a null as "cannot
 * verify numerically" rather than as a mismatch.
 *
 * KNOWN LIMITATION: a hyphenated range label such as "30-40" is
 * indistinguishable at the string level from the subtraction "30 - 40" and
 * evaluates to -10. Accepted because the comparison engine only reads `parsed`
 * for values it expects to be genuinely numeric (named variables, final
 * answers), never for range-shaped labels.
 */

export function parseNumericExpression(raw: string): number | null {
  if (!raw) return null;

  let normalized = raw
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    // "x" as multiplication only between numeric/paren tokens ("20 x 10") — a
    // bare leading/trailing x is left alone, since there it's a variable name.
    .replace(/(?<=[\d)])\s*[xX]\s*(?=[\d(])/g, "*")
    .trim();

  // Models routinely phrase a final answer as "34.17 approximately" or
  // "36.67 marks (approximately)". Strip one trailing worded qualifier, but
  // only when a clean arithmetic core is left behind — a value that is
  // non-numeric throughout still falls through to the gate below and returns
  // null.
  const trailingQualifier = normalized.match(/^(.*?)\s*[a-zA-Z][a-zA-Z()\s.]*$/);
  if (trailingQualifier?.[1]) {
    const core = trailingQualifier[1].trim();
    if (core && /^[\d+\-*/().\s]+$/.test(core)) normalized = core;
  }

  if (!normalized || !/^[\d+\-*/().\s]+$/.test(normalized)) return null;

  try {
    const { value, end } = parseExpr(normalized, 0);
    // Trailing content means this wasn't one self-contained expression.
    if (normalized.slice(end).trim().length > 0) return null;
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function skipWhitespace(source: string, index: number): number {
  let i = index;
  while (i < source.length && source[i] === " ") i++;
  return i;
}

function parseExpr(source: string, index: number): { value: number; end: number } {
  let i = skipWhitespace(source, index);
  const first = parseTerm(source, i);
  let value = first.value;
  i = skipWhitespace(source, first.end);

  while (source[i] === "+" || source[i] === "-") {
    const operator = source[i];
    const right = parseTerm(source, i + 1);
    value = operator === "+" ? value + right.value : value - right.value;
    i = skipWhitespace(source, right.end);
  }

  return { value, end: i };
}

function parseTerm(source: string, index: number): { value: number; end: number } {
  let i = skipWhitespace(source, index);
  const first = parseFactor(source, i);
  let value = first.value;
  i = skipWhitespace(source, first.end);

  while (source[i] === "*" || source[i] === "/") {
    const operator = source[i];
    const right = parseFactor(source, i + 1);
    if (operator === "/") {
      if (right.value === 0) throw new Error("Division by zero.");
      value = value / right.value;
    } else {
      value = value * right.value;
    }
    i = skipWhitespace(source, right.end);
  }

  return { value, end: i };
}

function parseFactor(source: string, index: number): { value: number; end: number } {
  const i = skipWhitespace(source, index);

  if (source[i] === "-") {
    const operand = parseFactor(source, i + 1);
    return { value: -operand.value, end: operand.end };
  }
  if (source[i] === "+") {
    return parseFactor(source, i + 1);
  }
  if (source[i] === "(") {
    const inner = parseExpr(source, i + 1);
    const closing = skipWhitespace(source, inner.end);
    if (source[closing] !== ")") throw new Error("Unbalanced parenthesis.");
    return { value: inner.value, end: closing + 1 };
  }

  let end = i;
  while (end < source.length && /[\d.]/.test(source[end])) end++;
  if (end === i) throw new Error("Expected a number.");
  return { value: parseFloat(source.slice(i, end)), end };
}
