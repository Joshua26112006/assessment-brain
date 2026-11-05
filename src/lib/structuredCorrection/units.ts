/**
 * Physical units for the comparison engine (decision D11 of
 * 06-correction-hardening-plan.md).
 *
 * Until now a unit written after a number was thrown away, and a value that
 * differed from the key by a power of ten was simply not judged ("2000 mg" for
 * "2 g" could not be told from a slip). With real conversion the engine can say
 * 2000 mg = 2 g (correct) and 2000 g ≠ 2 g (wrong), and a UNIT criterion can
 * pass only when the student's unit is equivalent to the key's.
 *
 * Everything here is deterministic and conservative: a unit this module does
 * not recognise is "unknown", never "wrong" (decision D15, precision over
 * recall) — callers treat unknown as "make no claim".
 */

/** Exponents of the SI base quantities: length, mass, time, current, temperature, amount. */
export type Dimension = readonly [number, number, number, number, number, number];

export interface ParsedUnit {
  dims: Dimension;
  /** Multiply a value in this unit by `factor` (then add `offset`) to get the SI value. */
  factor: number;
  /** Non-zero only for a bare temperature scale (°C, °F). */
  offset: number;
}

const D = (l = 0, m = 0, t = 0, i = 0, k = 0, n = 0): Dimension => [l, m, t, i, k, n];

interface BaseUnit {
  dims: Dimension;
  factor: number;
  offset?: number;
  /** True when an SI prefix may be attached ("kg", "mL", "µF"). */
  prefixable: boolean;
}

// SI base for mass is the kilogram, so the gram is 1e-3 and "kg" is just k + g.
const BASE_UNITS: Record<string, BaseUnit> = {
  m: { dims: D(1), factor: 1, prefixable: true },
  g: { dims: D(0, 1), factor: 1e-3, prefixable: true },
  s: { dims: D(0, 0, 1), factor: 1, prefixable: true },
  A: { dims: D(0, 0, 0, 1), factor: 1, prefixable: true },
  K: { dims: D(0, 0, 0, 0, 1), factor: 1, prefixable: true },
  mol: { dims: D(0, 0, 0, 0, 0, 1), factor: 1, prefixable: true },
  Hz: { dims: D(0, 0, -1), factor: 1, prefixable: true },
  N: { dims: D(1, 1, -2), factor: 1, prefixable: true },
  J: { dims: D(2, 1, -2), factor: 1, prefixable: true },
  W: { dims: D(2, 1, -3), factor: 1, prefixable: true },
  Pa: { dims: D(-1, 1, -2), factor: 1, prefixable: true },
  C: { dims: D(0, 0, 1, 1), factor: 1, prefixable: true },
  V: { dims: D(2, 1, -3, -1), factor: 1, prefixable: true },
  "Ω": { dims: D(2, 1, -3, -2), factor: 1, prefixable: true },
  F: { dims: D(-2, -1, 4, 2), factor: 1, prefixable: true },
  H: { dims: D(2, 1, -2, -2), factor: 1, prefixable: true },
  T: { dims: D(0, 1, -2, -1), factor: 1, prefixable: true },
  L: { dims: D(3), factor: 1e-3, prefixable: true },
  l: { dims: D(3), factor: 1e-3, prefixable: true },
  eV: { dims: D(2, 1, -2), factor: 1.602176634e-19, prefixable: true },
  cal: { dims: D(2, 1, -2), factor: 4.184, prefixable: true },
  // Units that take no prefix.
  min: { dims: D(0, 0, 1), factor: 60, prefixable: false },
  h: { dims: D(0, 0, 1), factor: 3600, prefixable: false },
  hr: { dims: D(0, 0, 1), factor: 3600, prefixable: false },
  ohm: { dims: D(2, 1, -3, -2), factor: 1, prefixable: false },
  ohms: { dims: D(2, 1, -3, -2), factor: 1, prefixable: false },
  bar: { dims: D(-1, 1, -2), factor: 1e5, prefixable: false },
  atm: { dims: D(-1, 1, -2), factor: 101325, prefixable: false },
  "°C": { dims: D(0, 0, 0, 0, 1), factor: 1, offset: 273.15, prefixable: false },
  "°F": { dims: D(0, 0, 0, 0, 1), factor: 5 / 9, offset: 255.3722222222222, prefixable: false },
};

const PREFIXES: Record<string, number> = {
  p: 1e-12,
  n: 1e-9,
  "µ": 1e-6,
  "μ": 1e-6,
  u: 1e-6,
  m: 1e-3,
  c: 1e-2,
  d: 1e-1,
  k: 1e3,
  M: 1e6,
  G: 1e9,
};

const SUPERSCRIPT: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-",
};

function foldSuperscripts(text: string): string {
  return text.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, (run) => `^${[...run].map((c) => SUPERSCRIPT[c]).join("")}`);
}

function multiply(a: Dimension, b: Dimension, power: number): Dimension {
  return a.map((x, i) => x + b[i] * power) as unknown as Dimension;
}

/** One factor such as "kg", "mL", "s^-2", "m^2": returns its dimension and SI factor, or null if unrecognised. */
function parseFactor(text: string): { dims: Dimension; factor: number; offset: number } | null {
  const match = text.match(/^(.*?)(?:\^\s*([-−+]?\d+))?$/);
  if (!match) return null;
  const symbolPart = match[1].trim();
  const exponent = match[2] === undefined ? 1 : Number(match[2].replace("−", "-"));
  if (!symbolPart || !Number.isFinite(exponent) || exponent === 0 || Math.abs(exponent) > 6) return null;

  let base: BaseUnit | undefined = BASE_UNITS[symbolPart];
  let prefixFactor = 1;
  if (!base) {
    for (const prefix of Object.keys(PREFIXES)) {
      if (!symbolPart.startsWith(prefix)) continue;
      const rest = symbolPart.slice(prefix.length);
      const candidate = BASE_UNITS[rest];
      if (candidate?.prefixable) {
        base = candidate;
        prefixFactor = PREFIXES[prefix];
        break;
      }
    }
  }
  if (!base) return null;

  // A temperature scale with an offset is only meaningful on its own, to the first power.
  if (base.offset && exponent !== 1) return null;
  if (base.offset && prefixFactor !== 1) return null;

  return {
    dims: multiply(D(), base.dims, exponent),
    factor: Math.pow(base.factor * prefixFactor, exponent),
    offset: base.offset ?? 0,
  };
}

/**
 * Parses a unit expression: "m/s^2", "m/s²", "kg m/s", "kg·m/s", "J/(kg K)",
 * "N/m^2", "mL", "°C". Returns null for anything not made entirely of
 * recognised unit symbols.
 */
export function parseUnit(raw: string): ParsedUnit | null {
  const text = foldSuperscripts(raw.trim().replace(/[−–]/g, "-"));
  if (!text || text.length > 40) return null;

  // Split on "/" at the top level (outside parentheses). Left to right, so "m/s/s" is m·s⁻².
  const segments: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (depth < 0) return null;
    if (char === "/" && depth === 0) {
      segments.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (depth !== 0) return null;
  segments.push(current);

  let dims = D();
  let factor = 1;
  let offset = 0;
  let factorCount = 0;

  for (const [index, segment] of segments.entries()) {
    const power = index === 0 ? 1 : -1;
    // Parentheses are grouping only. The tokens inside are separated by space, "·", "⋅", "*" or ".".
    const tokens = segment
      .replace(/[()]/g, " ")
      .split(/[\s·⋅*.]+/)
      .filter(Boolean);
    if (tokens.length === 0) return null;
    for (const token of tokens) {
      const parsed = parseFactor(token);
      if (!parsed) return null;
      dims = multiply(dims, parsed.dims, power);
      factor *= Math.pow(parsed.factor, power);
      factorCount++;
      offset = parsed.offset;
    }
  }

  // An offset scale (°C) is only valid as the whole unit.
  if (offset !== 0 && factorCount !== 1) return null;
  return { dims, factor, offset: factorCount === 1 ? offset : 0 };
}

export function sameDimension(a: ParsedUnit, b: ParsedUnit): boolean {
  return a.dims.every((exponent, index) => exponent === b.dims[index]);
}

/** The value in SI base units. */
export function toBase(value: number, unit: ParsedUnit): number {
  return value * unit.factor + unit.offset;
}

/** True when two unit strings mean the same unit: "N" and "kg m/s^2", "J" and "N m". "mg" and "g" are not. */
export function unitsEquivalent(a: string, b: string): boolean {
  const left = parseUnit(a);
  const right = parseUnit(b);
  if (!left || !right) return false;
  if (!sameDimension(left, right)) return false;
  const scale = Math.max(Math.abs(left.factor), Math.abs(right.factor));
  return Math.abs(left.factor - right.factor) <= scale * 1e-9 && Math.abs(left.offset - right.offset) <= 1e-9;
}

export interface Quantity {
  /** The bare number, evaluated by our own parser; null when the text is not cleanly numeric. */
  valueText: string;
  /** The unit text written after the number, when it is a recognised unit. */
  unitText: string | null;
  unit: ParsedUnit | null;
}

/**
 * Splits "x = 4 m/s²" or "2000 mg" into its number and its unit, accepting a
 * suffix only when the whole suffix is a recognised unit. "34.17 approximately",
 * "7 days" and "4x" have no unit, so they come back with unitText null.
 */
export function splitQuantity(raw: string): Quantity {
  // Only the part after the last "=" can carry the answer's unit ("a = F/m = 20/5 = 4 m/s²").
  const tail = raw.includes("=") ? raw.slice(raw.lastIndexOf("=") + 1) : raw;
  const text = tail.trim();

  for (let index = 1; index < text.length; index++) {
    const before = text[index - 1];
    // A unit follows a digit, a closing bracket, or a space.
    if (!/[\d)\s]/.test(before)) continue;
    const suffix = text.slice(index).trim();
    if (!suffix || !/^[A-Za-zµμΩ°]/.test(suffix)) continue;
    const head = text.slice(0, index).trim();
    if (!/[\d)]$/.test(head)) continue;
    const unit = parseUnit(suffix);
    if (unit) return { valueText: head, unitText: suffix, unit };
  }
  return { valueText: text, unitText: null, unit: null };
}

export type UnitCheck = "match" | "mismatch" | "absent" | "unknown";

/**
 * How the student's written unit compares with the key's, for a UNIT criterion.
 *
 *   match    — written, and equivalent (a different prefix of the same unit is NOT a match)
 *   mismatch — written, recognised, and not equivalent
 *   absent   — no unit written after the number
 *   unknown  — the key's unit, or the student's, is not one this module recognises: no claim
 */
export function checkUnit(expectedUnit: string | null | undefined, studentAnswerRaw: string): UnitCheck {
  if (!expectedUnit) return "unknown";
  const expected = parseUnit(expectedUnit);
  if (!expected) return "unknown";

  const written = splitQuantity(studentAnswerRaw);
  if (written.unitText === null) {
    // A word left after the number that is not a recognised unit may still be a unit
    // we do not know ("5 furlongs"): that is "unknown", not "absent" — except a plain
    // qualifier such as "approximately", which says nothing about units.
    const trailingWord = written.valueText.match(/[\d)]\s*([A-Za-zµμΩ°][^\d]*)$/)?.[1]?.trim();
    if (trailingWord && !/^(approx|approximately|about|nearly|roughly|marks?)\b/i.test(trailingWord)) return "unknown";
    return "absent";
  }
  return unitsEquivalent(expectedUnit, written.unitText) ? "match" : "mismatch";
}

/**
 * The student's number expressed in the key's unit, when both units are known
 * and measure the same kind of quantity; otherwise null (no conversion made).
 */
export function convertToUnit(value: number, from: ParsedUnit, to: ParsedUnit): number | null {
  if (!sameDimension(from, to)) return null;
  return (toBase(value, from) - to.offset) / to.factor;
}
