/**
 * Centralized OpenRouter model slugs. Every AI-assisted pipeline stage
 * imports from here rather than hardcoding a model string, so the actual
 * model in use for a given role is always visible in exactly one place.
 */

/** Fast, cheap model used for lightweight reading/comprehension tasks. */
export const READ_MODEL = "google/gemini-3.6-flash";

/** Used for feedback/annotation generation and rubric-clarification tasks. */
export const JUDGE_MODEL = "openai/gpt-5.6-luna";

/** Used for independent evaluation and adjudication/verification tasks. */
export const VERIFY_MODEL = "openai/gpt-5.6-terra";
