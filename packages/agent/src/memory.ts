import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getHeyAgentHome, ensureDir, generateId } from "@heyagent/shared";

export interface MemoryFact {
  key: string;
  value: string;
  updatedAt: string;
}

export interface RecentAction {
  tool: string;
  summary: string;
  at: string;
}

export interface ChatMission {
  id: string;
  type: "chat_until";
  contact: string;
  endPhrase: string;
  status: "active" | "done" | "cancelled";
  turns: { role: "agent" | "them"; text: string; at: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentMemory {
  facts: MemoryFact[];
  recentActions: RecentAction[];
  artifacts: {
    lastNotepadPath?: string;
    lastNotepadContent?: string;
    lastFilePath?: string;
    lastUrl?: string;
    lastSearchQuery?: string;
  };
  activeMission: ChatMission | null;
  channelSessions: Record<string, string>;
}

const DEFAULT_MEMORY: AgentMemory = {
  facts: [],
  recentActions: [],
  artifacts: {},
  activeMission: null,
  channelSessions: {},
};

function memoryFilePath(): string {
  return join(getHeyAgentHome(), "memory.json");
}

export async function loadMemory(): Promise<AgentMemory> {
  const path = memoryFilePath();
  if (!existsSync(path)) return structuredClone(DEFAULT_MEMORY);
  try {
    const raw = await readFile(path, "utf-8");
    return { ...structuredClone(DEFAULT_MEMORY), ...(JSON.parse(raw) as AgentMemory) };
  } catch {
    return structuredClone(DEFAULT_MEMORY);
  }
}

export async function saveMemory(mem: AgentMemory): Promise<void> {
  await ensureDir(getHeyAgentHome(), { mkdir } as typeof import("node:fs/promises"));
  await writeFile(memoryFilePath(), JSON.stringify(mem, null, 2), "utf-8");
}

export async function rememberFact(key: string, value: string): Promise<void> {
  const mem = await loadMemory();
  const existing = mem.facts.find((f) => f.key === key);
  if (existing) {
    existing.value = value;
    existing.updatedAt = new Date().toISOString();
  } else {
    mem.facts.push({ key, value, updatedAt: new Date().toISOString() });
  }
  mem.facts = mem.facts.slice(-50);
  await saveMemory(mem);
}

export async function rememberAction(tool: string, summary: string): Promise<void> {
  const mem = await loadMemory();
  mem.recentActions.push({ tool, summary, at: new Date().toISOString() });
  mem.recentActions = mem.recentActions.slice(-30);

  if (tool === "file.write") {
    const m = summary.match(/to (.+)$/);
    if (m) mem.artifacts.lastFilePath = m[1].trim();
  }
  if (tool === "browser.open") {
    const m = summary.match(/Opened (.+)$/);
    if (m) mem.artifacts.lastUrl = m[1].trim();
  }
  if (tool === "web.search") {
    mem.artifacts.lastSearchQuery = summary.slice(0, 200);
  }
  if (tool === "notepad.write" || tool === "notepad.type") {
    const pathMatch = summary.match(/(?:file:|path:)\s*(.+)$/i);
    if (pathMatch) mem.artifacts.lastNotepadPath = pathMatch[1].trim();
  }

  await saveMemory(mem);
}

export async function setLastNotepad(path: string, content: string): Promise<void> {
  const mem = await loadMemory();
  mem.artifacts.lastNotepadPath = path;
  mem.artifacts.lastNotepadContent = content;
  await saveMemory(mem);
}

export async function setLastFile(path: string, content?: string): Promise<void> {
  const mem = await loadMemory();
  mem.artifacts.lastFilePath = path;
  if (content !== undefined) mem.artifacts.lastNotepadContent = content;
  await saveMemory(mem);
}

export async function getOrCreateChannelSession(
  channelKey: string,
  create: () => Promise<string>,
): Promise<string> {
  const mem = await loadMemory();
  const existing = mem.channelSessions[channelKey];
  if (existing) {
    const { loadSession } = await import("./session.js");
    const session = await loadSession(existing);
    if (session) return existing;
  }
  const id = await create();
  mem.channelSessions[channelKey] = id;
  await saveMemory(mem);
  return id;
}

export async function startChatMission(
  contact: string,
  endPhrase = "до свидания",
): Promise<ChatMission> {
  const mem = await loadMemory();
  const mission: ChatMission = {
    id: generateId("mission"),
    type: "chat_until",
    contact: contact.trim(),
    endPhrase: endPhrase.trim().toLowerCase() || "до свидания",
    status: "active",
    turns: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  mem.activeMission = mission;
  await saveMemory(mem);
  return mission;
}

export async function appendMissionTurn(
  role: "agent" | "them",
  text: string,
): Promise<ChatMission | null> {
  const mem = await loadMemory();
  if (!mem.activeMission || mem.activeMission.status !== "active") return null;
  mem.activeMission.turns.push({ role, text, at: new Date().toISOString() });
  mem.activeMission.updatedAt = new Date().toISOString();

  const lower = text.toLowerCase();
  if (lower.includes(mem.activeMission.endPhrase)) {
    mem.activeMission.status = "done";
  }
  await saveMemory(mem);
  return mem.activeMission;
}

export async function completeMission(): Promise<void> {
  const mem = await loadMemory();
  if (mem.activeMission && mem.activeMission.status === "active") {
    mem.activeMission.status = "done";
    mem.activeMission.updatedAt = new Date().toISOString();
    await saveMemory(mem);
  }
}

export async function cancelMission(): Promise<void> {
  const mem = await loadMemory();
  if (mem.activeMission && mem.activeMission.status === "active") {
    mem.activeMission.status = "cancelled";
    mem.activeMission.updatedAt = new Date().toISOString();
    await saveMemory(mem);
  }
}

export function buildMemoryPromptBlock(mem: AgentMemory): string {
  const lines: string[] = [
    "## Memory (you ARE a continuous person — NEVER forget recent actions)",
  ];

  if (mem.activeMission?.status === "active") {
    const m = mem.activeMission;
    lines.push(
      `ACTIVE MISSION: chat with "${m.contact}" until someone says "${m.endPhrase}".`,
      `Run this AUTONOMOUSLY: telegram_message → telegram_wait_reply → read their reply → telegram_message → … loop.`,
      `WAIT for ${m.contact}'s answer yourself (patiently, even for a long time) using telegram_wait_reply.`,
      `NEVER ask the owner to forward ${m.contact}'s messages — you read them from the screen.`,
      `Do not stop early. Finish only when "${m.endPhrase}" appears, then send a warm closing line.`,
      `(If the owner sends стоп / отмена / cancel / хватит, stop the mission.)`,
      `Dialogue so far (${m.turns.length} turns):`,
    );
    for (const t of m.turns.slice(-16)) {
      lines.push(`  [${t.role}] ${t.text}`);
    }
  }

  if (Object.keys(mem.artifacts).length) {
    lines.push("Recent artifacts (use these when user says «тот файл» / «который создал»):");
    if (mem.artifacts.lastNotepadPath) {
      lines.push(`  - lastNotepadPath: ${mem.artifacts.lastNotepadPath}`);
    }
    if (mem.artifacts.lastNotepadContent) {
      lines.push(
        `  - lastNotepadContent: ${mem.artifacts.lastNotepadContent.slice(0, 600)}`,
      );
    }
    if (mem.artifacts.lastFilePath) {
      lines.push(`  - lastFilePath: ${mem.artifacts.lastFilePath}`);
    }
    if (mem.artifacts.lastUrl) {
      lines.push(`  - lastUrl: ${mem.artifacts.lastUrl}`);
    }
  }

  if (mem.recentActions.length) {
    lines.push("Recent actions:");
    for (const a of mem.recentActions.slice(-10)) {
      lines.push(`  - [${a.tool}] ${a.summary.slice(0, 220)}`);
    }
  }

  if (mem.facts.length) {
    lines.push("Facts:");
    for (const f of mem.facts.slice(-20)) {
      lines.push(`  - ${f.key}: ${f.value}`);
    }
  }

  lines.push(
    "If you just created something and the user says «сохрани» / «закрой» / «тот» — act on the artifact above.",
    "Never ask «какой файл?» if lastNotepadPath or lastFilePath is known.",
  );

  return lines.join("\n");
}

