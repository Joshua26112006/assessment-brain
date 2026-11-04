/**
 * Deterministic arithmetic evaluator for values that appear in rubrics and in
 * students' written working — plain numbers, fractions, and parenthesized
 * +-*\/ expressions (e.g. "5/12", "(15-9)/(30-10-8)", "20 x 10"), powers and
 * scientific notation ("3 x 10^8", "10⁸", "1.6e-19"), a trailing unit
 * ("4 m/s²", "10 Ω"), thousands separators ("1,000", "1,00,000"), and a
 * final line written as "x = 4", "a = 20/5 = 4" or "Ans: 4".
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

const SUPERSCRIPT_CHARS = "⁰¹²³⁴⁵⁶⁷⁸⁹";

/** Unicode superscript runs ("10⁸", "m/s²", "s⁻¹") rewritten as "^n" so one exponent syntax is handled. */
function foldSuperscripts(value: string): string {
  return value.replace(/[⁻]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (run) => {
    let digits = "";
    for (const char of run) digits += char === "⁻" ? "-" : String(SUPERSCRIPT_CHARS.indexOf(char));
    return `^${digits}`;
  });
}

/**
 * Leading words that introduce a final answer rather than being part of it
 * ("Ans: 4", "∴ x = 4", "Therefore 12"). Only ever removed from the START.
 */
const ANSWER_PREFIX = /^\s*(?:ans(?:wer)?|therefore|hence|thus|so|∴|⇒|=>)\s*[:.\-–]?\s*/i;

/**
 * The left-hand side of a final line such as "x = 4", "R_eq = 2.4" or
 * "P(prime) = 1/2": a single name, optionally followed by one parenthesised
 * label. Anything richer ("2x + 3 = 11") is an equation, not an answer, and
 * is deliberately not accepted.
 */
const ANSWER_NAME = /^[A-Za-zα-ωΑ-Ω][A-Za-z0-9_₀-₉']*\s*(?:\([^()=]*\))?$/;

function closeEnough(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.01, Math.abs(b) * 0.005);
}

export function parseNumericExpression(raw: string): number | null {
  if (!raw) return null;

  let normalized = foldSuperscripts(raw)
    // A typeset minus sign (U+2212) means exactly "-".
    .replace(/−/g, "-")
    // Thousands separators, Western ("1,000") and Indian ("1,00,000") grouping
    // only. A comma not followed by such a group ("2,5", "2, 5") is left alone
    // and the value stays unparseable — it may be a decimal comma or a list.
    .replace(/(?<=\d),(?=(?:\d{2},)*\d{3}(?!\d))/g, "")
    .trim();

  // "Ans: 4", "∴ x = 4" — strip any answer-introducing words first.
  let previous;
  do {
    previous = normalized;
    normalized = normalized.replace(ANSWER_PREFIX, "");
  } while (normalized !== previous);

  // "x = 4", "a = (20-0)/5 = 4 m/s^2": the value is the last segment. Every
  // other segment must agree with it where it can be evaluated, so a line the
  // student got wrong part-way ("x = 3 + 4 = 8") stays unparseable rather than
  // being read as whichever half happens to come last.
  if (normalized.includes("=")) {
    if (/[<>≤≥≠!]/.test(normalized)) return null;
    const segments = normalized.split("=").map((segment) => segment.trim());
    const first = segments[0];
    if (first && !ANSWER_NAME.test(first)) return null;
    const last = segments[segments.length - 1];
    const value = last ? parseNumericExpression(last) : null;
    if (value === null) return null;
    for (const middle of segments.slice(1, -1)) {
      if (!middle) return null;
      const middleValue = parseNumericExpression(middle);
      if (middleValue !== null && !closeEnough(middleValue, value)) return null;
    }
    return value;
  }

  normalized = normalized
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    // "x" as multiplication only between numeric/paren tokens ("20 x 10") — a
    // bare leading/trailing x is left alone, since there it's a variable name.
    .replace(/(?<=[\d)])\s*[xX]\s*(?=[\d(])/g, "*")
    // Scientific E-notation ("3e8", "1.6E-19") as an explicit power of ten.
    .replace(/(?<=\d)[eE]([+-]?\d+)(?![\d.a-zA-Z])/g, "*10^($1)")
    .trim();

  // Models routinely phrase a final answer as "34.17 approximately" or
  // "36.67 marks (approximately)". Strip one trailing worded qualifier, but
  // only when a clean arithmetic core is left behind — a value that is
  // non-numeric throughout still falls through to the gate below and returns
  // null.
  const trailingQualifier = normalized.match(/^(.*?)\s*[a-zA-Z][a-zA-Z()\s.]*$/);
  if (trailingQualifier?.[1]) {
    const core = trailingQualifier[1].trim();
    if (core && /^[\d+\-*/^().\s]+$/.test(core)) normalized = core;
  }

  // Compound units ("4 m/s^2", "10 Ω", "9.8 m/s²", "37 °C") — see stripCompoundUnit.
  // Tried only when the value is still not clean arithmetic, so everything that
  // already parsed above parses exactly as before.
  if (normalized && !/^[\d+\-*/^().\s]+$/.test(normalized)) {
    const withoutUnit = stripCompoundUnit(normalized);
    if (withoutUnit) normalized = withoutUnit;
  }

  if (!normalized || !/^[\d+\-*/^().\s]+$/.test(normalized)) return null;

  try {
    const { value, end } = parseExpr(normalized, 0);
    // Trailing content means this wasn't one self-contained expression.
    if (normalized.slice(end).trim().length > 0) return null;
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Units a student or rubric may write after a number: an optional SI prefix on
 * a base unit, plus a few common standalone units. A WHITELIST rather than
 * "anything after the number" on purpose — "3x^2" must stay unparseable, and
 * only recognised unit symbols may be discarded.
 */
const UNIT_TOKEN =
  "(?:min|hr|ohms?|°C|°F|°|[µμunmcdkMG]?(?:mol|cal|eV|Hz|Pa|m|s|g|N|J|W|V|A|Ω|F|H|T|L|l|K|C)|h)";
const UNIT_EXPONENT = "(?:\\^\\s*[-−+]?\\d+|[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+)";
const UNIT_FACTOR = `${UNIT_TOKEN}${UNIT_EXPONENT}?`;
const UNIT_PATTERN = new RegExp(`^${UNIT_FACTOR}(?:(?:\\s*[/·⋅*.]\\s*|\\s+)${UNIT_FACTOR})*$`);
/** A number followed by something that starts like a unit. The core must end in a digit or ")". */
const NUMBER_THEN_UNIT = /^([\d+\-*/^().\s]*[\d)])\s*([^\d+\-*/^().\s(].*)$/;
/** Only units containing one of these need this path; plain words ("J", "ohm", "g") are handled by the qualifier strip. */
const COMPOUND_UNIT_MARKER = /[/^·⋅⁰¹²³⁴⁵⁶⁷⁸⁹⁻ΩµμK°]/;

/**
 * Strips a trailing unit such as "m/s^2", "m/s²", "Ω", "N/m²", "kg m/s" or
 * "°C" from a numeric value, returning the bare arithmetic core — or null when
 * the tail is not made entirely of recognised unit symbols. The unit is
 * discarded, not converted: "4 m/s" and "4 m/s^2" both evaluate to 4, exactly
 * as "4 J" and "4 g" already did.
 */
function stripCompoundUnit(value: string): string | null {
  const match = value.match(NUMBER_THEN_UNIT);
  if (!match) return null;

  const core = match[1].trim();
  // Unit parentheses ("J/(kg K)") are grouping only; drop them before validating.
  const unit = match[2].replace(/[()]/g, "").trim();
  if (!core || !unit || !COMPOUND_UNIT_MARKER.test(unit)) return null;
  if (!/^[\d+\-*/^().\s]+$/.test(core)) return null;

  return UNIT_PATTERN.test(unit) ? core : null;
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
  return parsePower(source, i);
}

/** "10^8", "2^-3", "10^(-19)". Right-associative and tighter than unary minus, so "-2^2" is -4. */
function parsePower(source: string, index: number): { value: number; end: number } {
  const base = parsePrimary(source, index);
  const next = skipWhitespace(source, base.end);
  if (source[next] !== "^") return base;
  const exponent = parseFactor(source, next + 1);
  const value = Math.pow(base.value, exponent.value);
  if (!Number.isFinite(value)) throw new Error("Exponent out of range.");
  return { value, end: exponent.end };
}

function parsePrimary(source: string, index: number): { value: number; end: number } {
  const i = skipWhitespace(source, index);

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
