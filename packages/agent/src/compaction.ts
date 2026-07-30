/**
 * Hierarchical session compaction (OpenClaw-inspired, thin).
 * Keeps last N raw turns; archives older ones as structured summary.
 */
import { chatCompletion, resolveFastModel, type ModelRef } from "@heyagent/models";
import {
  loadConfig,
  type AgentSession,
  type Message,
  type SessionSummary,
} from "@heyagent/shared";
import { saveSession } from "./session.js";

export type { SessionSummary };
export type CompactableSession = AgentSession;

const DEFAULT_KEEP = 6;
const DEFAULT_TRIGGER = 14; // user+assistant messages before compact

export function countDialogueTurns(messages: Message[]): number {
  return messages.filter((m) => m.role === "user" || m.role === "assistant").length;
}

/** Heuristic summary without LLM (always available). */
export function heuristicSummarize(messages: Message[], taskHint?: string): SessionSummary {
  const completed: string[] = [];
  const failed: string[] = [];
  const openQuestions: string[] = [];
  let currentState = "in progress";

  for (const m of messages) {
    const c = m.content || "";
    if (m.role === "assistant" && c.startsWith("[actions]")) {
      for (const line of c.split("\n").slice(1)) {
        const t = line.replace(/^\s*-\s*/, "").trim();
        if (!t) continue;
        if (/ERROR|FAIL|LOOP_BREAK|Stopped/i.test(t)) failed.push(t.slice(0, 160));
        else completed.push(t.slice(0, 160));
      }
    }
    if (m.role === "assistant") {
      if (/DONE|SAVED|открыл|написал/i.test(c) && !/ERROR/i.test(c)) {
        currentState = c.split("\n")[0]!.slice(0, 200);
      }
      if (/ERROR|Stopped|BLOCKED|CAPTCHA/i.test(c)) {
        failed.push(c.split("\n")[0]!.slice(0, 160));
        currentState = "blocked/failed";
      }
    }
    if (m.role === "user" && /\?/.test(c)) openQuestions.push(c.slice(0, 120));
  }

  const text = [
    taskHint ? `Task: ${taskHint}` : "",
    completed.length ? `Completed: ${completed.slice(-8).join("; ")}` : "",
    failed.length ? `Failed: ${failed.slice(-6).join("; ")}` : "",
    `Current: ${currentState}`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    at: new Date().toISOString(),
    completed: completed.slice(-12),
    failed: failed.slice(-8),
    currentState,
    openQuestions: openQuestions.slice(-4),
    text,
  };
}

async function llmSummarize(
  messages: Message[],
  taskHint: string | undefined,
  modelRef: ModelRef,
): Promise<SessionSummary | null> {
  try {
    const blob = messages
      .map((m) => `${m.role}: ${m.content.slice(0, 500)}`)
      .join("\n")
      .slice(0, 6000);
    const res = await chatCompletion(
      modelRef,
      [
        {
          role: "system",
          content: [
            "Summarize an agent session. Reply STRICT JSON:",
            '{"completed":["..."],"failed":["..."],"currentState":"...","openQuestions":["..."]}',
            "Keep tool names, paths, URLs, people. No fluff.",
          ].join("\n"),
        },
        {
          role: "user",
          content: `Task: ${taskHint || "?"}\n\nTranscript:\n${blob}`,
        },
      ],
      { maxTokens: 500, toolChoice: "none", useDefaultFallbacks: true },
    );
    const m = (res.content ?? "").match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]) as {
      completed?: string[];
      failed?: string[];
      currentState?: string;
      openQuestions?: string[];
    };
    return {
      at: new Date().toISOString(),
      completed: Array.isArray(parsed.completed) ? parsed.completed.map(String).slice(0, 12) : [],
      failed: Array.isArray(parsed.failed) ? parsed.failed.map(String).slice(0, 8) : [],
      currentState: String(parsed.currentState ?? "unknown").slice(0, 240),
      openQuestions: Array.isArray(parsed.openQuestions)
        ? parsed.openQuestions.map(String).slice(0, 4)
        : [],
      text: res.content ?? "",
    };
  } catch {
    return null;
  }
}

export interface CompactOptions {
  keepRecent?: number;
  triggerTurns?: number;
  force?: boolean;
  modelRef?: ModelRef;
  useLlm?: boolean;
}

/**
 * Compact older dialogue into archivedSummaries; keep last keepRecent turns raw.
 * Returns true if compaction ran.
 */
export async function maybeCompactSession(
  session: CompactableSession,
  opts: CompactOptions = {},
): Promise<boolean> {
  const config = await loadConfig();
  if (config.features?.compaction === false && !opts.force) return false;

  const keep = opts.keepRecent ?? config.agent?.compactKeepRecent ?? DEFAULT_KEEP;
  const trigger = opts.triggerTurns ?? config.agent?.compactEvery ?? DEFAULT_TRIGGER;
  const dialogue = session.messages.filter((m) => m.role === "user" || m.role === "assistant");
  if (!opts.force && dialogue.length < trigger) return false;
  if (dialogue.length <= keep) return false;

  const toArchive = dialogue.slice(0, -keep);
  const keepMsgs = dialogue.slice(-keep);
  // Preserve non-dialogue (rare) at end — usually none
  const others = session.messages.filter((m) => m.role !== "user" && m.role !== "assistant");

  const taskHint =
    session.currentTask ||
    [...dialogue].reverse().find((m) => m.role === "user")?.content.slice(0, 200);

  let summary: SessionSummary | null = null;
  if (opts.useLlm !== false) {
    const model =
      opts.modelRef ?? resolveFastModel((await loadConfig()).models ?? {});
    summary = await llmSummarize(toArchive, taskHint, model);
  }
  summary = summary ?? heuristicSummarize(toArchive, taskHint);

  // OpenClaw-style memory flush before dropping raw turns
  try {
    const { appendMemoryFacts, appendDailyNote } = await import("@heyagent/identity");
    const facts = [
      ...summary.completed.slice(-4).map((c) => `Done: ${c}`),
      ...summary.failed.slice(-2).map((f) => `Blocked: ${f}`),
    ].filter((f) => f.length > 8);
    if (facts.length) await appendMemoryFacts(facts);
    await appendDailyNote(
      `compact: ${summary.currentState.slice(0, 160)}${taskHint ? ` | task=${taskHint.slice(0, 80)}` : ""}`,
    );
  } catch {
    /* non-fatal */
  }

  session.archivedSummaries = [...(session.archivedSummaries ?? []), summary].slice(-20);
  session.workingSummary = summary;
  if (taskHint) session.currentTask = taskHint;
  session.messages = [...keepMsgs, ...others];
  await saveSession(session);
  return true;
}

/** Prompt block: summaries + recent raw turns (caller still passes recent via history). */
export function buildCompactionPromptBlock(session: CompactableSession): string {
  const lines: string[] = ["## Session Context"];
  if (session.currentTask) lines.push(`Task: ${session.currentTask}`);
  const summaries = session.archivedSummaries ?? [];
  if (session.workingSummary || summaries.length) {
    lines.push("### Previous work (summarized)");
    const s = session.workingSummary ?? summaries[summaries.length - 1]!;
    if (s.completed.length) lines.push(`- Completed: ${s.completed.slice(-6).join("; ")}`);
    if (s.failed.length) lines.push(`- Failed/Blocked: ${s.failed.slice(-4).join("; ")}`);
    lines.push(`- Current State: ${s.currentState}`);
    if (s.openQuestions.length) {
      lines.push(`- Open Questions: ${s.openQuestions.join("; ")}`);
    }
    if (summaries.length > 1) {
      lines.push(`(${summaries.length} archived summaries)`);
    }
  }
  lines.push("### Recent turns follow in chat history");
  return lines.join("\n");
}
