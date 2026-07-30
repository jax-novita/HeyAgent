import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getHeyAgentHome, ensureDir } from "@heyagent/shared";

export interface HarnessStat {
  name: string;
  calls: number;
  successes: number;
  failures: number;
  totalMs: number;
  lastAt?: string;
  lastError?: string;
}

interface Store {
  byName: Record<string, HarnessStat>;
}

function path(): string {
  return join(getHeyAgentHome(), "harness-metrics.json");
}

async function load(): Promise<Store> {
  if (!existsSync(path())) return { byName: {} };
  try {
    return JSON.parse(await readFile(path(), "utf-8")) as Store;
  } catch {
    return { byName: {} };
  }
}

async function save(s: Store): Promise<void> {
  await ensureDir(getHeyAgentHome(), { mkdir } as typeof import("node:fs/promises"));
  await writeFile(path(), JSON.stringify(s, null, 2), "utf-8");
}

export async function recordHarnessRun(
  name: string,
  ok: boolean,
  durationMs: number,
  error?: string,
): Promise<void> {
  const store = await load();
  const cur = store.byName[name] ?? {
    name,
    calls: 0,
    successes: 0,
    failures: 0,
    totalMs: 0,
  };
  cur.calls += 1;
  if (ok) cur.successes += 1;
  else {
    cur.failures += 1;
    cur.lastError = (error || "").slice(0, 240);
  }
  cur.totalMs += Math.max(0, durationMs);
  cur.lastAt = new Date().toISOString();
  store.byName[name] = cur;
  await save(store);
}

export async function harnessMetricsReport(): Promise<string> {
  const store = await load();
  const rows = Object.values(store.byName).sort((a, b) => b.calls - a.calls);
  if (!rows.length) return "No harness metrics yet.";
  return rows
    .map((r) => {
      const rate = r.calls ? ((r.successes / r.calls) * 100).toFixed(0) : "0";
      const avg = r.calls ? Math.round(r.totalMs / r.calls) : 0;
      return `- ${r.name}: calls=${r.calls} ok=${rate}% avg=${avg}ms`;
    })
    .join("\n");
}
