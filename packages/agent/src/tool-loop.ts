/**
 * Detect stuck tool loops (same tool + args repeating).
 * OpenClaw tool-loop-detection, thin port.
 */

import { createHash } from "node:crypto";

export class ToolLoopGuard {
  private counts = new Map<string, number>();
  private readonly limit: number;

  constructor(limit = 8) {
    this.limit = Math.max(3, limit);
  }

  /** Returns block message if over limit, else null. */
  check(toolName: string, args: Record<string, unknown>): string | null {
    const hash = createHash("sha1")
      .update(toolName)
      .update("\0")
      .update(stableStringify(args))
      .digest("hex")
      .slice(0, 16);
    const n = (this.counts.get(hash) ?? 0) + 1;
    this.counts.set(hash, n);
    if (n >= this.limit) {
      return `LOOP_BREAK: tool «${toolName}» repeated ${n}× with the same args. Stop. Change approach or report the blocker.`;
    }
    if (n === Math.max(3, Math.floor(this.limit / 2))) {
      return `LOOP_WARN: «${toolName}» repeating (${n}×). Vary args or verify differently.`;
    }
    return null;
  }
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
}
