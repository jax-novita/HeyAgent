/**
 * Retry with exponential backoff — used by harnesses and LLM tool loop.
 */
export interface RetryOptions {
  times?: number;
  baseMs?: number;
  maxMs?: number;
  /** Return true to retry this error/result. Default: any thrown Error. */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  onRetry?: (err: unknown, attempt: number) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const times = Math.max(1, opts.times ?? 3);
  const baseMs = opts.baseMs ?? 400;
  const maxMs = opts.maxMs ?? 4000;
  const shouldRetry =
    opts.shouldRetry ??
    ((err) => err instanceof Error || (typeof err === "string" && /error|fail|timeout/i.test(err)));

  let lastErr: unknown;
  for (let attempt = 1; attempt <= times; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt >= times || !shouldRetry(err, attempt)) throw err;
      opts.onRetry?.(err, attempt);
      const delay = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
      await sleep(delay);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Retry when a tool string result looks like a soft failure. */
export async function withToolResultRetry(
  fn: (attempt: number) => Promise<string>,
  opts: RetryOptions = {},
): Promise<string> {
  const times = Math.max(1, opts.times ?? 2);
  const baseMs = opts.baseMs ?? 500;
  let last = "";
  for (let attempt = 1; attempt <= times; attempt++) {
    last = await fn(attempt);
    const bad = /^(ERROR|FAIL|TIMEOUT|BLOCKED)\b/i.test(last.trim());
    if (!bad || attempt >= times) return last;
    opts.onRetry?.(last, attempt);
    await sleep(Math.min(opts.maxMs ?? 3000, baseMs * attempt));
  }
  return last;
}
