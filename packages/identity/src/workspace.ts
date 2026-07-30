/**
 * OpenClaw-style workspace bootstrap: SOUL / AGENTS / MEMORY / daily notes.
 * Lives in ~/.heyagent/workspace — editable by the owner.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import {
  getWorkspaceDir,
  ensureDir,
  type SupportedLocale,
} from "@heyagent/shared";
import type { AgentIdentity } from "./types.js";

const SOUL_TEMPLATE = `# SOUL.md — who you are

You are an autonomous **execution** agent on the owner's PC. Complete tasks. Do not only discuss them.

## Cognitive style (mandatory)
1. **PLAN** — for anything >2 steps, write a brief numbered plan first (internally or in tools).
2. **EXECUTE** — call tools; never invent tool results.
3. **VERIFY** — after each meaningful step, confirm state (file exists, URL correct, UI shows expected).
4. **ESCALATE** — after 3 failed recoveries on the same step, stop and report the blocker clearly.

## Constraints
- Never claim DONE without tool evidence or a named human blocker (CAPTCHA, login, payment).
- Prefer deterministic APIs/files/shell over fragile UI when both work.
- Destructive / send / money / auth: pause only when policy requires; otherwise act and report.
- Genre/topic fidelity: if asked for a story, write a story — never swap for a poem.

## Memory
- Persist important prefs with memory tools / MEMORY.md.
- Before repeating a hard task, recall recent failures and avoid the same dead end.
`;

const AGENTS_TEMPLATE = `# AGENTS.md — operating rules

## Safety
- Safe freely: read, list, explore, screenshots, non-destructive queries.
- Ask / careful: delete, send messages, payments, system shutdown, credential changes.
- Safety and honesty beat fake progress.

## Execution bias
- Actionable request → act now with tools.
- Weak/empty tool result → vary query/path/command, then conclude.
- Final claim needs evidence (path, URL, tool output) or a named blocker.

## Multitask
- One session = one focused run at a time (gateway serializes).
- Long waits (Telegram reply) belong in background mission workers — do not busy-spin the LLM.

## Computer control
- Browser: verify URL/title; skip ads; quiz = answer then Next.
- YouTube «открой …»: open first matching organic video (quick mode).
- Telegram Desktop chat-until: send → wait_reply → reply → loop until goodbye.
- Notepad: genre must match (рассказ ≠ стишок).
`;

const MEMORY_TEMPLATE = `# MEMORY.md — durable facts

(Write short bullets the agent should remember across sessions.)

- Owner language: Russian preferred
`;

const HEARTBEAT_TEMPLATE = `# HEARTBEAT.md — periodic autonomy checklist

On each heartbeat turn, briefly check and act only if useful (do not spam the owner):

1. Any due cron / standing orders?
2. Urgent mail / Telegram Desktop waits?
3. If the owner asked for regular news digests — run research.digest → PDF when due.
4. Otherwise reply HEARTBEAT_OK (no user-facing noise).

Keep actions short. Prefer tools over chatter.
`;

const RU_TEMPLATES: Record<"SOUL.md" | "AGENTS.md" | "MEMORY.md" | "HEARTBEAT.md", string> = {
  "SOUL.md": `# SOUL.md — кто ты

Ты автономный агент-исполнитель на компьютере владельца. Выполняй задачи, а не только обсуждай их.

## Рабочий цикл
1. ПЛАНИРУЙ — для задач длиннее двух шагов составь короткий внутренний план.
2. ВЫПОЛНЯЙ — используй инструменты и не выдумывай их результаты.
3. ПРОВЕРЯЙ — подтверждай результат файлами, URL или состоянием интерфейса.
4. ЭСКАЛИРУЙ — после трёх разных неудачных попыток сообщи конкретное препятствие.

Никогда не переводи и не переписывай исходный запрос пользователя перед выполнением.
`,
  "AGENTS.md": `# AGENTS.md — правила работы

## Безопасность
- Свободно: чтение, поиск, снимки экрана и недеструктивные проверки.
- Осторожно: удаление, отправка сообщений, платежи, выключение системы и изменение учётных данных.
- Не заявляй об успехе без подтверждения инструментом.

## Управление компьютером
- Проверяй URL и заголовок страницы после действий в браузере.
- Длительные ожидания выполняй фоновыми задачами без активного LLM-цикла.
- Сохраняй жанр и тему запрошенного материала.
`,
  "MEMORY.md": `# MEMORY.md — долговременные факты

(Записывай короткие факты, которые агент должен помнить между сессиями.)

- Предпочитаемый язык владельца: русский
`,
  "HEARTBEAT.md": `# HEARTBEAT.md — периодическая проверка

При каждом запуске проверь только полезные события и не отправляй лишних сообщений:

1. Есть ли задачи cron или постоянные поручения?
2. Есть ли срочная почта или ожидаемые ответы Telegram?
3. Нужен ли запланированный дайджест?
4. Если действий нет, ответь HEARTBEAT_OK.
`,
};

export async function ensureWorkspace(locale: SupportedLocale = "en"): Promise<string> {
  const dir = getWorkspaceDir();
  await ensureDir(dir, { mkdir } as typeof import("node:fs/promises"));
  await ensureDir(join(dir, "memory"), { mkdir } as typeof import("node:fs/promises"));
  const files: [string, string][] =
    locale === "ru"
      ? Object.entries(RU_TEMPLATES)
      : [
          ["SOUL.md", SOUL_TEMPLATE],
          ["AGENTS.md", AGENTS_TEMPLATE],
          ["MEMORY.md", MEMORY_TEMPLATE],
          ["HEARTBEAT.md", HEARTBEAT_TEMPLATE],
        ];
  for (const [name, content] of files) {
    const p = join(dir, name);
    if (!existsSync(p)) {
      await writeFile(p, content, "utf-8");
    }
  }
  return dir;
}

async function readIfExists(path: string, max = 8000): Promise<string> {
  if (!existsSync(path)) return "";
  try {
    const t = await readFile(path, "utf-8");
    return t.slice(0, max).trim();
  } catch {
    return "";
  }
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Append a line to today's daily note (episodic scratch). */
export async function appendDailyNote(line: string): Promise<void> {
  await ensureWorkspace();
  const p = join(getWorkspaceDir(), "memory", `${todayStamp()}.md`);
  const stamp = new Date().toISOString().slice(11, 19);
  await appendFile(p, `- [${stamp}] ${line.trim()}\n`, "utf-8");
}

/** Append durable bullets to MEMORY.md (dedupe exact lines). */
export async function appendMemoryFacts(facts: string[]): Promise<void> {
  await ensureWorkspace();
  const p = join(getWorkspaceDir(), "MEMORY.md");
  let cur = "";
  try {
    cur = await readFile(p, "utf-8");
  } catch {
    cur = MEMORY_TEMPLATE;
  }
  const existing = new Set(
    cur
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*-\s*/, "").trim().toLowerCase())
      .filter(Boolean),
  );
  const add: string[] = [];
  for (const f of facts) {
    const t = f.replace(/^\s*-\s*/, "").trim();
    if (t.length < 3 || t.length > 240) continue;
    if (existing.has(t.toLowerCase())) continue;
    existing.add(t.toLowerCase());
    add.push(`- ${t}`);
  }
  if (!add.length) return;
  const sep = cur.endsWith("\n") ? "" : "\n";
  await writeFile(p, `${cur}${sep}${add.join("\n")}\n`, "utf-8");
}

/** Simple keyword search over MEMORY.md + recent daily notes. */
export async function searchWorkspaceMemory(query: string, limit = 8): Promise<string> {
  await ensureWorkspace();
  const dir = getWorkspaceDir();
  const q = query
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[^a-zа-я0-9]+/i)
    .filter((t) => t.length >= 3);
  if (!q.length) return "MEMORY search: empty query";

  const blobs: { src: string; text: string }[] = [];
  for (const name of ["MEMORY.md", "HEARTBEAT.md"]) {
    const t = await readIfExists(join(dir, name), 20_000);
    if (t) blobs.push({ src: name, text: t });
  }
  try {
    const { readdir } = await import("node:fs/promises");
    const memDir = join(dir, "memory");
    const files = (await readdir(memDir)).filter((f) => f.endsWith(".md")).sort().reverse().slice(0, 14);
    for (const f of files) {
      const t = await readIfExists(join(memDir, f), 8000);
      if (t) blobs.push({ src: `memory/${f}`, text: t });
    }
  } catch {
    /* ignore */
  }

  const hits: { score: number; line: string; src: string }[] = [];
  for (const b of blobs) {
    for (const line of b.text.split(/\r?\n/)) {
      const lower = line.toLowerCase().replace(/ё/g, "е");
      if (lower.length < 4) continue;
      let score = 0;
      for (const t of q) if (lower.includes(t)) score += 1;
      if (score) hits.push({ score, line: line.trim().slice(0, 220), src: b.src });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  const top = hits.slice(0, Math.max(1, Math.min(limit, 20)));
  if (!top.length) return `MEMORY search: no hits for «${query}»`;
  return ["MEMORY search hits:", ...top.map((h) => `- (${h.src}) ${h.line}`)].join("\n");
}

export async function readHeartbeatChecklist(): Promise<string> {
  await ensureWorkspace();
  return (await readIfExists(join(getWorkspaceDir(), "HEARTBEAT.md"), 4000)) || HEARTBEAT_TEMPLATE;
}

/**
 * Build workspace prompt block (SOUL + AGENTS + MEMORY + today).
 * Hard runtime rules still win over SOUL when they conflict.
 */
export async function buildWorkspacePromptBlock(
  identity: AgentIdentity,
  locale: SupportedLocale = "en",
): Promise<string> {
  await ensureWorkspace(locale);
  const dir = getWorkspaceDir();
  const soul = await readIfExists(join(dir, "SOUL.md"), 6000);
  const agents = await readIfExists(join(dir, "AGENTS.md"), 5000);
  const memory = await readIfExists(join(dir, "MEMORY.md"), 4000);
  const daily = await readIfExists(join(dir, "memory", `${todayStamp()}.md`), 3000);

  const parts = [
    `## Identity`,
    `You are **${identity.name}** (avatar ${identity.avatarId}). Local HeyAgent on the owner's computer.`,
    "",
    soul ? `## SOUL.md\n${soul}` : "",
    agents ? `## AGENTS.md\n${agents}` : "",
    memory ? `## MEMORY.md\n${memory}` : "",
    daily ? `## Today's notes (${todayStamp()})\n${daily}` : "",
  ];
  return parts.filter(Boolean).join("\n\n");
}
