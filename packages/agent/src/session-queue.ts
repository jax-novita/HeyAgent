/**
 * Serialize agent runs per session/channel key (OpenClaw lane pattern, minimal).
 * Prevents two Telegram messages from racing the same desktop UI.
 */

const tails = new Map<string, Promise<unknown>>();

export function enqueueByKey<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const k = key.trim() || "default";
  const prev = tails.get(k) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  tails.set(
    k,
    next.finally(() => {
      if (tails.get(k) === next) tails.delete(k);
    }),
  );
  return next as Promise<T>;
}

export function sessionQueueKey(opts: {
  sessionId?: string;
  channelKey?: string;
  channel?: string;
}): string {
  if (opts.channelKey) return `ch:${opts.channelKey}`;
  if (opts.sessionId) return `sess:${opts.sessionId}`;
  return `ch:${opts.channel ?? "cli"}`;
}
