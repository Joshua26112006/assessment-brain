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

/**
 * Forms that change what a written value MEANS, so they are read only when asked for. A percentage is a
 * fraction of a hundred (50% is 0.5), but a question that does not accept one would read "50%" as 50 or as
 * an error either way; a comma is a decimal point in some countries and a thousands separator in others.
 * Neither is guessed: left off, such a value is "cannot be read" and a person decides.
 */
export interface ParseOptions {
  /** Read "50%" as 0.5. */
  acceptPercent?: boolean;
  /** Read "2,5" as 2.5 (and so a comma is never a thousands separator). */
  decimalComma?: boolean;
}

/** Characters a value may contain once it has been normalised: digits, operators, brackets, space, π and √. */
const ARITHMETIC_GATE = /^[\d+\-*/^().\sπ√]+$/;

export function parseNumericExpression(raw: string, options: ParseOptions = {}): number | null {
  if (!raw) return null;

  let normalized = foldSuperscripts(raw)
    // A typeset minus sign (U+2212) means exactly "-".
    .replace(/−/g, "-")
    .trim();

  // A decimal comma is read only when the question says to; otherwise it may be a list or a thousands
  // separator, and the value stays unparseable unless it is a well-formed thousands group.
  normalized = options.decimalComma
    ? normalized.replace(/(?<=\d),(?=\d)/g, ".")
    : // Thousands separators, Western ("1,000") and Indian ("1,00,000") grouping only. A comma not followed
      // by such a group ("2,5", "2, 5") is left alone and the value stays unparseable.
      normalized.replace(/(?<=\d),(?=(?:\d{2},)*\d{3}(?!\d))/g, "");

  // Written-out forms of two symbols: "sqrt(2)" and "pi". Only whole words, so a sentence is not rewritten.
  normalized = normalized.replace(/\bsqrt\b/gi, "√").replace(/\bpi\b/gi, "π");
  // A recurring decimal written with a bar or dots over the repeating digits (0.3̄, 0.1̄2̄, 0.3̇, 0.1̇2̇).
  normalized = expandRecurring(normalized);
  // A trailing ellipsis on a decimal ("0.333...", "0.33…") says "and so on"; the digits written are the value.
  normalized = normalized.replace(/(?<=\d)\s*(?:\.{3}|…)$/, "");
  // A percentage, only when the question accepts one.
  if (options.acceptPercent) {
    const percent = normalized.match(/^(.*[\d)])\s*%$/);
    if (percent) {
      const inner = parseNumericExpression(percent[1], { ...options, acceptPercent: false });
      return inner === null ? null : inner / 100;
    }
  }

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
    const value = last ? parseNumericExpression(last, options) : null;
    if (value === null) return null;
    for (const middle of segments.slice(1, -1)) {
      if (!middle) return null;
      const middleValue = parseNumericExpression(middle, options);
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
  //
  // What may be stripped is limited, because stripping used to turn "4x" into 4 and "2e" into 2 — an
  // algebraic term read as a number. A qualifier written AFTER A SPACE may be a unit ("2 m", "5 g") or a
  // word of two or more letters ("7 days", "36.67 marks"); letters GLUED to the number are stripped only
  // when they are a recognised unit ("120J", "5g"). A lone letter that is not a unit ("4x") is left, and the
  // value is then not a number.
  const trailingQualifier = normalized.match(/^(.*?)(\s*)([a-zA-Z][a-zA-Z()\s.]*)$/);
  if (trailingQualifier?.[1]) {
    const [, coreText, gap, tail] = trailingQualifier;
    const core = coreText.trim();
    const tailText = tail.trim();
    const isUnit = UNIT_PATTERN.test(tailText);
    const isWord = gap.length > 0 && tailText.replace(/[^a-zA-Z]/g, "").length >= 2;
    if (core && ARITHMETIC_GATE.test(core) && (isUnit || isWord)) normalized = core;
  }

  // Compound units ("4 m/s^2", "10 Ω", "9.8 m/s²", "37 °C") — see stripCompoundUnit.
  // Tried only when the value is still not clean arithmetic, so everything that
  // already parsed above parses exactly as before.
  if (normalized && !ARITHMETIC_GATE.test(normalized)) {
    const withoutUnit = stripCompoundUnit(normalized);
    if (withoutUnit) normalized = withoutUnit;
  }

  // A mixed number ("2 1/2" is two and a half; "10 1/4 m" with its unit already removed). Only when the WHOLE
  // value is that form, so "2 1/2 + 1" is not read as one.
  const mixed = normalized.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed && Number(mixed[3]) !== 0) normalized = `(${mixed[1]}+${mixed[2]}/${mixed[3]})`;

  if (!normalized || !ARITHMETIC_GATE.test(normalized)) return null;

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
const NUMBER_THEN_UNIT = /^([\d+\-*/^().\sπ√]*[\d)π])\s*([^\d+\-*/^().\sπ√(].*)$/;
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
  if (!ARITHMETIC_GATE.test(core)) return null;

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

  // "2π" and "4√3" mean 2 × π and 4 × √3: a symbol straight after a value multiplies it.
  while (source[i] === "*" || source[i] === "/" || source[i] === "π" || source[i] === "√") {
    const implicit = source[i] === "π" || source[i] === "√";
    const operator = implicit ? "*" : source[i];
    const right = parseFactor(source, implicit ? i : i + 1);
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

  // π, and √ of a number or of a bracketed expression ("√2", "√(2+3)").
  if (source[i] === "π") return { value: Math.PI, end: i + 1 };
  if (source[i] === "√") {
    const operand = parsePrimary(source, i + 1);
    if (operand.value < 0) throw new Error("Square root of a negative number.");
    return { value: Math.sqrt(operand.value), end: operand.end };
  }

  let end = i;
  while (end < source.length && /[\d.]/.test(source[end])) end++;
  if (end === i) throw new Error("Expected a number.");
  return { value: parseFloat(source.slice(i, end)), end };
}

/**
 * A recurring decimal marked with a bar over each repeating digit (0.3̄ = 1/3, 0.1̄2̄ = 0.121212...) or dots over the first
 * and last repeating digit (0.1̇2̇ = 0.121212..., 0.3̇ = 0.333...), replaced by its value. Digits without a mark are the
 * part that does not repeat (0.16̄ = 0.1666...). Text without such a mark is returned unchanged.
 */
export function expandRecurring(text: string): string {
  // The same, written the way a model often transcribes a bar: 0.\overline{3}, 0.1\overline{6}, 0.\dot{3}.
  text = text.replace(/(\d*)\.(\d*)\\(?:overline|bar|dot)\{(\d+)\}/g, (_whole, whole: string, fixed: string, repeating: string) => {
    if (repeating.length > 10 || fixed.length > 10) return _whole;
    const nonRepeating = Number(fixed === "" ? "0" : fixed) / 10 ** fixed.length;
    const repeatingValue = Number(repeating) / (10 ** repeating.length - 1) / 10 ** fixed.length;
    return String(Number(whole === "" ? "0" : whole) + nonRepeating + repeatingValue);
  });
  return text.replace(/(\d*)\.(\d*)((?:\d[\u0304\u0305])+|\d\u0307(?:\d*\d\u0307)?)/g, (_whole, whole: string, fixed: string, marked: string) => {
    const dotted = marked.includes("\u0307");
    const repeating = dotted ? marked.replace(/\u0307/g, "") : marked.replace(/[\u0304\u0305]/g, "");
    if (repeating.length === 0 || repeating.length > 10 || fixed.length > 10) return _whole;
    const nonRepeating = Number(fixed === "" ? "0" : fixed) / 10 ** fixed.length;
    const repeatingValue = Number(repeating) / (10 ** repeating.length - 1) / 10 ** fixed.length;
    return String(Number(whole === "" ? "0" : whole) + nonRepeating + repeatingValue);
  });
}

/**
 * An ordered pair or triple, "(2, 3)" or "P(2,3)": the values in the order written. A comma inside brackets is
 * a separator here (it could not be a decimal comma or a thousands separator), and order matters: (2, 3) is not (3, 2).
 */
export function parseCoordinate(raw: string, options: ParseOptions = {}): number[] | null {
  if (!raw) return null;
  const text = raw.replace(/−/g, "-").trim().replace(/^(?:[A-Za-z][A-Za-z0-9']*\s*=?\s*)?(?=\()/, "");
  const match = text.match(/^\(\s*([^,;()]+?)\s*[,;]\s*([^,;()]+?)(?:\s*[,;]\s*([^,;()]+?))?\s*\)$/);
  if (!match) return null;
  const values = match.slice(1).filter((part) => part !== undefined).map((part) => parseNumericExpression(part, options));
  return values.every((value): value is number => value !== null) ? values : null;
}

export interface NumericInterval {
  lo: number;
  hi: number;
  loOpen: boolean;
  hiOpen: boolean;
}

const INFINITY_TEXT = /^([+-]?)\s*(?:∞|inf(?:inity)?)$/i;

function endpoint(text: string, options: ParseOptions): number | null {
  const infinite = text.trim().match(INFINITY_TEXT);
  if (infinite) return infinite[1] === "-" ? -Infinity : Infinity;
  return parseNumericExpression(text.trim(), options);
}

/**
 * An interval in bracket notation: "[1, 5)", "(-∞, 3]", "(2, ∞)". Round brackets leave an end out, square brackets
 * keep it, and an infinite end is always open. Inequalities ("1 < x ≤ 5") are deliberately not read as intervals.
 */
export function parseInterval(raw: string, options: ParseOptions = {}): NumericInterval | null {
  if (!raw) return null;
  const text = raw.replace(/−/g, "-").trim().replace(/^(?:[A-Za-z][A-Za-z0-9']*\s*(?:=|∈)\s*)/, "");
  const match = text.match(/^([\[(])\s*([^,;\])]+?)\s*[,;]\s*([^,;\[\])]+?)\s*([\])])$/);
  if (!match) return null;
  const lo = endpoint(match[2], options);
  const hi = endpoint(match[3], options);
  if (lo === null || hi === null || lo > hi) return null;
  return {
    lo,
    hi,
    loOpen: match[1] === "(" || lo === -Infinity,
    hiOpen: match[4] === ")" || hi === Infinity,
  };
}

/** The form of a written value that is not one number: a set, an interval or an ordered pair. At most one is present. */
export interface StructuredValue {
  parsed: number | null;
  parsedSet?: number[];
  parsedInterval?: NumericInterval;
  parsedTuple?: number[];
}

/** Reads a written value in every shape the system can compare: one number, a set, an interval or an ordered pair. */
export function parseStructuredValue(raw: string, options: ParseOptions = {}): StructuredValue {
  const parsed = raw ? parseNumericExpression(raw, options) : null;
  if (parsed !== null || !raw) return { parsed };
  const parsedSet = parseNumericSet(raw, options);
  if (parsedSet) return { parsed: null, parsedSet };
  const parsedInterval = parseInterval(raw, options);
  const parsedTuple = parseCoordinate(raw, options);
  return {
    parsed: null,
    ...(parsedInterval ? { parsedInterval } : {}),
    ...(parsedTuple ? { parsedTuple } : {}),
  };
}

/**
 * An answer with more than one value: "x = 2 or x = -3", "2 or -3", "x = ±2". Returns the values, ascending
 * and without repeats, or null when the text is not such an answer (a single value is not a set). A comma is
 * deliberately not a separator: "2,5" may be a decimal and "1,000" a thousand.
 */
export function parseNumericSet(raw: string, options: ParseOptions = {}): number[] | null {
  if (!raw) return null;
  let text = raw.replace(/−/g, "-").trim();
  let previous;
  do {
    previous = text;
    text = text.replace(ANSWER_PREFIX, "");
  } while (text !== previous);

  let values: number[] | null = null;

  const plusMinus = text.match(/^(?:[A-Za-zα-ωΑ-Ω][A-Za-z0-9_₀-₉']*\s*=\s*)?±\s*(.+)$/);
  if (plusMinus) {
    const value = parseNumericExpression(plusMinus[1], options);
    if (value !== null) values = value === 0 ? [0] : [value, -value];
  } else {
    const parts = text.split(/\s*(?:\bor\b|\band\b|&|;)\s*/i).filter((part) => part.length > 0);
    if (parts.length >= 2) {
      const parsed = parts.map((part) => parseNumericExpression(part, options));
      if (parsed.every((value): value is number => value !== null)) values = parsed;
    }
  }

  if (!values) return null;
  // "±0" and "x = 2 or x = 2" are one value, not a set.
  const unique = [...new Set(values)].sort((a, b) => a - b);
  return unique.length >= 2 ? unique : null;
}
