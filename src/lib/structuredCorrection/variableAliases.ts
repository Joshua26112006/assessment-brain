/**
 * Other names a student commonly gives a quantity, so that "initial velocity = 5" is found when the rubric calls it "u".
 * The scheme can list aliases itself (the drafter is asked to); this is the fixed list of the standard school symbols,
 * added to whatever the scheme lists, so a drafter that forgets does not turn a student's own notation into a missed value.
 *
 * Kept short and unambiguous on purpose (decision D15, precision over recall). A name that means different things in
 * different questions ("d" for distance or diameter, "Q" for charge or heat, "r") is not here. An alias only ever helps
 * find the student's value for a quantity the rubric already names; it never creates a quantity.
 *
 * Pure: no model, no database.
 */

interface Quantity {
  symbol: string;
  names: string[];
}

const QUANTITIES: Quantity[] = [
  { symbol: "u", names: ["v0", "v_0", "v₀", "vi", "v_i", "initial velocity", "initial speed"] },
  { symbol: "v", names: ["vf", "v_f", "final velocity", "final speed"] },
  { symbol: "a", names: ["acceleration"] },
  { symbol: "t", names: ["time"] },
  { symbol: "s", names: ["displacement", "distance"] },
  { symbol: "m", names: ["mass"] },
  { symbol: "h", names: ["height"] },
  { symbol: "F", names: ["force"] },
  { symbol: "W", names: ["work", "work done"] },
  { symbol: "P", names: ["power"] },
  { symbol: "R", names: ["resistance"] },
  { symbol: "I", names: ["current"] },
  { symbol: "V", names: ["voltage", "potential difference"] },
];

const normalise = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

/** The standard other names for a quantity the rubric calls `name`, in either direction (symbol to words, words to symbol). */
export function standardAliases(name: string): string[] {
  const wanted = normalise(name);
  for (const quantity of QUANTITIES) {
    if (name.trim() === quantity.symbol) return [...quantity.names];
    if (quantity.names.some((other) => normalise(other) === wanted)) {
      return [quantity.symbol, ...quantity.names.filter((other) => normalise(other) !== wanted)];
    }
  }
  return [];
}

/** The scheme's own aliases first, then the standard ones, without repeats. */
export function mergeAliases(name: string, listed: string[] | undefined): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const alias of [...(listed ?? []), ...standardAliases(name)]) {
    const key = alias.trim().toLowerCase();
    if (key === name.trim().toLowerCase() || seen.has(key)) continue;
    seen.add(key);
    merged.push(alias);
  }
  return merged;
}
