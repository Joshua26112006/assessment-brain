/**
 * Robust parser for extracting JSON out of an AI chat completion's text
 * content. AI-generated output cannot be trusted blindly — models
 * frequently wrap valid JSON in markdown code fences, or add a sentence of
 * commentary before/after it — so this tries progressively looser
 * extraction strategies rather than assuming the response is already a
 * clean `JSON.parse`-able string. Never uses eval.
 *
 * This only extracts *syntactically* valid JSON — it does not know or care
 * about any particular stage's contract shape. Every caller must still
 * validate the parsed value's shape before trusting it (see each stage's
 * own `ai.ts` validator).
 */
export class AiJsonParseError extends Error {
  readonly rawContent: string;

  constructor(message: string, rawContent: string) {
    super(message);
    this.name = "AiJsonParseError";
    this.rawContent = rawContent;
  }
}

export function parseAiJson<T>(content: string): T {
  for (const candidate of extractJsonCandidates(content)) {
    const parsed = tryParse(candidate);
    if (parsed !== undefined) {
      return parsed as T;
    }
  }
  throw new AiJsonParseError(
    "Could not extract valid JSON from the AI response.",
    content,
  );
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function extractJsonCandidates(content: string): string[] {
  const trimmed = content.trim();
  const candidates: string[] = [trimmed];

  // Markdown code fence, e.g. ```json\n{...}\n``` or ```\n{...}\n```
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    candidates.push(fenceMatch[1].trim());
  }

  // Leading/trailing prose around an otherwise valid JSON object or array —
  // take the first balanced {...} or [...] span found.
  const balanced = extractBalancedJson(trimmed);
  if (balanced) {
    candidates.push(balanced);
  }

  return candidates;
}

function extractBalancedJson(text: string): string | null {
  const start = text.search(/[{[]/);
  if (start === -1) return null;

  const openChar = text[start];
  const closeChar = openChar === "{" ? "}" : "]";

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (char === "\\") {
      escapeNext = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === openChar) depth++;
    else if (char === closeChar) {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}
