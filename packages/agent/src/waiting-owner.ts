/**
 * Pause mission until the Telegram control-chat owner replies.
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getHeyAgentHome, ensureDir } from "@heyagent/shared";

export interface WaitingOwnerState {
  chatId: number;
  resumePrefix: string;
  planSummary?: string;
  parkedAt: string;
}

function pathFor(): string {
  return join(getHeyAgentHome(), "waiting-owner.json");
}

async function loadAll(): Promise<WaitingOwnerState[]> {
  if (!existsSync(pathFor())) return [];
  try {
    return JSON.parse(await readFile(pathFor(), "utf-8")) as WaitingOwnerState[];
  } catch {
    return [];
  }
}

async function saveAll(items: WaitingOwnerState[]): Promise<void> {
  const fs = await import("node:fs/promises");
  await ensureDir(getHeyAgentHome(), fs);
  await writeFile(pathFor(), JSON.stringify(items, null, 2), "utf-8");
}

export async function parkWaitingOwner(
  chatId: number,
  resumePrefix: string,
  planSummary?: string,
): Promise<void> {
  const items = await loadAll();
  const next = items.filter((x) => x.chatId !== chatId);
  next.push({
    chatId,
    resumePrefix,
    planSummary,
    parkedAt: new Date().toISOString(),
  });
  await saveAll(next);
}

export async function clearWaitingOwner(chatId: number): Promise<void> {
  const items = await loadAll();
  await saveAll(items.filter((x) => x.chatId !== chatId));
}

export async function getWaitingOwner(chatId: number): Promise<WaitingOwnerState | null> {
  const items = await loadAll();
  return items.find((x) => x.chatId === chatId) ?? null;
}

/** If parked, return resume user message for agent.run; else null. */
export async function tryResumeWaitingOwner(
  chatId: number,
  userText: string,
  notify: (msg: string) => Promise<void>,
): Promise<string | null> {
  const parked = await getWaitingOwner(chatId);
  if (!parked) return null;
  await clearWaitingOwner(chatId);
  await notify("▶️ Продолжаю с твоего ответа…");
  return [
    parked.resumePrefix || "[RESUME after owner pause]",
    parked.planSummary ? `План был: ${parked.planSummary}` : "",
    `Ответ владельца: ${userText}`,
  ]
    .filter(Boolean)
    .join("\n");
}
