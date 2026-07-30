import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getHeyAgentHome, ensureDir, generateId } from "@heyagent/shared";

export interface MissionHistoryEntry {
  id: string;
  goal: string;
  harness?: string;
  tools?: string[];
  summary: string;
  at: string;
}

function histPath(): string {
  return join(getHeyAgentHome(), "mission-history.json");
}

async function load(): Promise<MissionHistoryEntry[]> {
  if (!existsSync(histPath())) return [];
  try {
    return JSON.parse(await readFile(histPath(), "utf-8")) as MissionHistoryEntry[];
  } catch {
    return [];
  }
}

async function save(items: MissionHistoryEntry[]): Promise<void> {
  const fs = await import("node:fs/promises");
  await ensureDir(getHeyAgentHome(), fs);
  await writeFile(histPath(), JSON.stringify(items.slice(0, 80), null, 2), "utf-8");
}

export async function recordMissionSuccess(entry: {
  goal: string;
  harness?: string;
  tools?: string[];
  summary: string;
}): Promise<void> {
  const items = await load();
  items.unshift({
    id: generateId("hist"),
    goal: entry.goal.slice(0, 400),
    harness: entry.harness,
    tools: entry.tools?.slice(0, 20),
    summary: entry.summary.slice(0, 800),
    at: new Date().toISOString(),
  });
  await save(items);
}

export async function listMissionHistory(limit = 10): Promise<MissionHistoryEntry[]> {
  const items = await load();
  return items.slice(0, limit);
}

export async function pickReplayGoal(preferYesterday = true): Promise<MissionHistoryEntry | null> {
  const items = await load();
  if (!items.length) return null;
  if (!preferYesterday) return items[0] ?? null;
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yKey = y.toISOString().slice(0, 10);
  const yesterday = items.find((i) => i.at.startsWith(yKey));
  return yesterday || items[0] || null;
}

export function formatMissionHistory(items: MissionHistoryEntry[]): string {
  if (!items.length) return "История миссий пуста.";
  return items
    .map(
      (i, n) =>
        `${n + 1}. [${i.at.slice(0, 16)}] ${i.harness || "?"} — ${i.goal.slice(0, 100)}`,
    )
    .join("\n");
}
