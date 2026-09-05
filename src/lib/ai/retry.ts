/**
 * Small, deliberately simple retry helper for transient AI request
 * failures (network errors, rate limits, momentary provider errors) — not
 * a queue system. Bounded by `maxAttempts`; never retries indefinitely.
 */
export interface RetryOptions {
  /** Total attempts including the first — not additional retries. Default 2. */
  maxAttempts?: number;
  /** Base delay for exponential backoff (doubles each attempt). Default 300ms. */
  baseDelayMs?: number;
  /** Return false to stop retrying a particular error immediately. Defaults to always retry. */
  shouldRetry?: (error: unknown) => boolean;
}

export class RetryExhaustedError extends Error {
  readonly attempts: number;

  constructor(message: string, attempts: number, cause: unknown) {
    super(message, { cause });
    this.name = "RetryExhaustedError";
    this.attempts = attempts;
  }
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 300;
  const shouldRetry = options.shouldRetry ?? (() => true);

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt >= maxAttempts;
      if (isLastAttempt || !shouldRetry(error)) {
        break;
      }
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }

  throw new RetryExhaustedError(
    `Operation failed after ${maxAttempts} attempt(s).`,
    maxAttempts,
    lastError,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
