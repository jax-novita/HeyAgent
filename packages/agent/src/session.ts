import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  generateId,
  getSessionsDir,
  ensureDir,
  type AgentSession,
  type Message,
} from "@heyagent/shared";

export async function createSession(channel: AgentSession["channel"]): Promise<AgentSession> {
  const session: AgentSession = {
    id: generateId("session"),
    channel,
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveSession(session);
  return session;
}

export async function loadSession(id: string): Promise<AgentSession | null> {
  const path = join(getSessionsDir(), `${id}.json`);
  if (!existsSync(path)) return null;
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw) as AgentSession;
}

export async function saveSession(session: AgentSession): Promise<void> {
  const dir = getSessionsDir();
  await ensureDir(dir, { mkdir } as typeof import("node:fs/promises"));
  session.updatedAt = new Date().toISOString();
  await writeFile(join(dir, `${session.id}.json`), JSON.stringify(session, null, 2), "utf-8");
}

export async function addMessage(session: AgentSession, message: Message): Promise<AgentSession> {
  session.messages.push(message);
  await saveSession(session);
  return session;
}

export function getRecentMessages(session: AgentSession, limit = 24): Message[] {
  // Compaction archives older turns; keep a short raw window in the prompt.
  return session.messages.slice(-limit);
}
