/**
 * OpenClaw-style model failover (thin port) + provider cooldowns.
 */
import type { ModelRef } from "./providers.js";

export type FailoverReason =
  | "server_error"
  | "rate_limit"
  | "auth"
  | "billing"
  | "timeout"
  | "model_not_found"
  | "context"
  | "aborted"
  | "unknown";

export interface FailoverAttempt {
  provider: string;
  model: string;
  reason: FailoverReason;
  message: string;
}

export class FallbackSummaryError extends Error {
  attempts: FailoverAttempt[];
  constructor(attempts: FailoverAttempt[]) {
    const last = attempts[attempts.length - 1];
    super(
      `All models failed (${attempts.length} attempt(s)). Last: ${last?.provider}/${last?.model}: ${last?.message ?? "unknown"}`,
    );
    this.name = "FallbackSummaryError";
    this.attempts = attempts;
  }
}

/** In-memory cooldowns: provider/model → resumeAt ms */
const cooldowns = new Map<string, number>();

const COOLDOWN_MS: Partial<Record<FailoverReason, number>> = {
  rate_limit: 60_000,
  server_error: 45_000,
  timeout: 30_000,
  auth: 120_000,
  billing: 300_000,
  model_not_found: 180_000,
};

export function clearFailoverCooldowns(): void {
  cooldowns.clear();
}

export function isModelCoolingDown(ref: ModelRef, now = Date.now()): boolean {
  const until = cooldowns.get(keyOf(ref)) ?? 0;
  return until > now;
}

export function markModelCooldown(ref: ModelRef, reason: FailoverReason, now = Date.now()): void {
  const ms = COOLDOWN_MS[reason];
  if (!ms) return;
  const prev = cooldowns.get(keyOf(ref)) ?? 0;
  cooldowns.set(keyOf(ref), Math.max(prev, now + ms));
}

export function classifyFailoverError(err: unknown): {
  reason: FailoverReason;
  retrySame: boolean;
  tryNext: boolean;
  retryAfterMs: number;
} {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  const statusMatch = msg.match(/Model API error \((\d{3})\)/);
  const status = statusMatch ? Number(statusMatch[1]) : 0;

  if (/abort|cancel|user.?denied/i.test(lower)) {
    return { reason: "aborted", retrySame: false, tryNext: false, retryAfterMs: 0 };
  }
  if (/context.?length|maximum context|too many tokens|token.?limit/i.test(lower)) {
    return { reason: "context", retrySame: false, tryNext: false, retryAfterMs: 0 };
  }
  if (status === 401 || status === 403 || /invalid.?api.?key|unauthorized|authentication/i.test(lower)) {
    return { reason: "auth", retrySame: false, tryNext: true, retryAfterMs: 0 };
  }
  if (status === 402 || /billing|quota|insufficient.?credits|payment/i.test(lower)) {
    return { reason: "billing", retrySame: false, tryNext: true, retryAfterMs: 0 };
  }
  if (status === 404 || /model.?not.?found|does not exist|unknown model/i.test(lower)) {
    return { reason: "model_not_found", retrySame: false, tryNext: true, retryAfterMs: 0 };
  }
  if (status === 429 || /rate.?limit|too many requests/i.test(lower)) {
    return { reason: "rate_limit", retrySame: true, tryNext: true, retryAfterMs: 2500 };
  }
  if (
    status === 503 ||
    /overloaded|upstream connect|connection termination|econnreset|etimedout|fetch failed/i.test(
      lower,
    )
  ) {
    return { reason: "timeout", retrySame: true, tryNext: true, retryAfterMs: 1200 };
  }
  if (status >= 500 || /server_error|internal server error/i.test(lower)) {
    return { reason: "server_error", retrySame: true, tryNext: true, retryAfterMs: 800 };
  }
  return { reason: "unknown", retrySame: false, tryNext: true, retryAfterMs: 0 };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function keyOf(r: ModelRef): string {
  return `${r.provider}/${r.model}`;
}

/** Deduped candidate chain: primary first, then fallbacks. Skips cooling-down models when possible. */
export function buildModelCandidateChain(
  primary: ModelRef,
  fallbacks: ModelRef[] = [],
): ModelRef[] {
  const out: ModelRef[] = [];
  const seen = new Set<string>();
  const cooled: ModelRef[] = [];
  for (const r of [primary, ...fallbacks]) {
    if (!r?.provider || !r?.model) continue;
    const k = keyOf(r);
    if (seen.has(k)) continue;
    seen.add(k);
    if (isModelCoolingDown(r)) cooled.push({ provider: r.provider, model: r.model });
    else out.push({ provider: r.provider, model: r.model });
  }
  // If everything is cooling down, still try (better than failing immediately)
  if (!out.length) return cooled;
  return out;
}

/**
 * Try primary, same-model retry on rate/5xx, then next candidates.
 * Marks failed models with a cooldown so the next request skips them briefly.
 */
export async function runWithModelFallback<T>(
  primary: ModelRef,
  fallbacks: ModelRef[],
  call: (ref: ModelRef) => Promise<T>,
  opts?: {
    sameModelRetries?: number;
    onFallback?: (from: ModelRef, to: ModelRef, reason: string) => void;
  },
): Promise<T> {
  const chain = buildModelCandidateChain(primary, fallbacks);
  const sameRetries = opts?.sameModelRetries ?? 1;
  const attempts: FailoverAttempt[] = [];

  for (let i = 0; i < chain.length; i++) {
    const ref = chain[i]!;
    let localTries = 0;
    while (localTries <= sameRetries) {
      localTries++;
      try {
        return await call(ref);
      } catch (err) {
        const c = classifyFailoverError(err);
        const message = err instanceof Error ? err.message : String(err);
        attempts.push({
          provider: ref.provider,
          model: ref.model,
          reason: c.reason,
          message: message.slice(0, 240),
        });
        markModelCooldown(ref, c.reason);

        if (!c.tryNext && !c.retrySame) throw err;

        if (c.retrySame && localTries <= sameRetries) {
          await sleep(c.retryAfterMs || 800);
          continue;
        }

        const next = chain[i + 1];
        if (c.tryNext && next) {
          opts?.onFallback?.(ref, next, c.reason);
          break;
        }
        throw new FallbackSummaryError(attempts);
      }
    }
  }

  throw new FallbackSummaryError(attempts);
}

/** Sensible OpenAI/Groq fallbacks when config omits them. */
export function defaultFallbackChain(primary: ModelRef): ModelRef[] {
  const p = primary.provider;
  if (p === "openai") {
    return [
      { provider: "openai", model: "gpt-4.1-mini" },
      { provider: "openai", model: "gpt-4o-mini" },
      { provider: "openai", model: "gpt-4.1" },
    ].filter((r) => keyOf(r) !== keyOf(primary));
  }
  if (p === "groq") {
    return [
      { provider: "groq", model: "llama-3.3-70b-versatile" },
      { provider: "groq", model: "llama-3.1-8b-instant" },
    ].filter((r) => keyOf(r) !== keyOf(primary));
  }
  if (p === "anthropic") {
    return [{ provider: "anthropic", model: "claude-3-5-haiku-20241022" }].filter(
      (r) => keyOf(r) !== keyOf(primary),
    );
  }
  if (p === "bedrock") {
    return [
      { provider: "bedrock", model: "anthropic.claude-haiku-4-5" },
      { provider: "bedrock", model: "deepseek.v3.1" },
      { provider: "bedrock", model: "openai.gpt-oss-20b" },
    ].filter((r) => keyOf(r) !== keyOf(primary));
  }
  return [];
}
