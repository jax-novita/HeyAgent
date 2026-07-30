import { homedir } from "node:os";
import { join } from "node:path";

export const PRODUCT_NAME = "HeyAgent";
export const CLI_NAME = "hey";
export const GATEWAY_DEFAULT_PORT = 28789;
export const GATEWAY_DEFAULT_HOST = "127.0.0.1";

export function getHeyAgentHome(): string {
  return process.env.HEYAGENT_HOME ?? join(homedir(), ".heyagent");
}

export function getConfigPath(): string {
  return join(getHeyAgentHome(), "config.json");
}

export function getIdentityPath(): string {
  return join(getHeyAgentHome(), "identity.json");
}

export function getCredentialsDir(): string {
  return join(getHeyAgentHome(), "credentials");
}

export function getSessionsDir(): string {
  return join(getHeyAgentHome(), "sessions");
}

export function getAuditLogPath(): string {
  return join(getHeyAgentHome(), "audit.log");
}

export function getSkillsDir(): string {
  return join(getHeyAgentHome(), "skills");
}

/** Editable agent workspace: SOUL.md, AGENTS.md, MEMORY.md, daily notes */
export function getWorkspaceDir(): string {
  return join(getHeyAgentHome(), "workspace");
}

// safe        = only sensitive/destructive tools ask (default behaviour of "ask")
// ask         = classic: sensitive + send/delete/write ask
// risky       = ask ONLY on genuinely irreversible actions (send/delete/shutdown/shell)
// allowlist   = only explicitly allowed tools run without asking
// full        = never ask (God mode)
export type PolicyMode = "ask" | "risky" | "allowlist" | "full";
export type SupportedLocale = "ru" | "en";

export function normalizeLocale(value: unknown): SupportedLocale {
  // Backward compatibility: HeyAgent was Russian-first before locale existed.
  return value === "en" ? "en" : "ru";
}

export function resolveLocale(config: Pick<HeyAgentConfig, "user">): SupportedLocale {
  return normalizeLocale(config.user?.locale);
}

/**
 * Explicit trust-boundary helper: locale and presentation code must never
 * translate, correct, trim or otherwise rewrite the user's request.
 */
export function preserveUserMessage(message: string): string {
  return message;
}

export interface HeyAgentConfig {
  user?: {
    /**
     * Product presentation language. This controls UI, errors, onboarding,
     * system messages and templates only. It must never rewrite user input.
     */
    locale?: SupportedLocale;
  };
  gateway?: {
    host?: string;
    port?: number;
  };
  models?: {
    defaultProvider?: string;
    defaultModel?: string;
    /** Cheap/fast model for reread/compose (falls back to default). */
    fastProvider?: string;
    fastModel?: string;
    /**
     * Failover chain after primary dies (500/503/429…).
     * Strings: "provider/model" e.g. "openai/gpt-4.1-mini"
     */
    fallbacks?: string[];
  };
  agent?: {
    /** Max LLM tool-loop iterations (default 24; chat-until uses missionMaxIterations). */
    maxIterations?: number;
    missionMaxIterations?: number;
    /** Stop if the same tool+args repeats this many times (default 8). */
    toolLoopLimit?: number;
    /** Keep this many recent user/assistant turns after compaction (default 6). */
    compactKeepRecent?: number;
    /** Compact when dialogue turns exceed this (default 14). */
    compactEvery?: number;
  };
  policy?: {
    mode?: PolicyMode;
    allowlist?: string[];
  };
  telegram?: {
    enabled?: boolean;
    botToken?: string;
    allowedChatIds?: number[];
    /** Voice messages → Whisper STT → agent (default true) */
    voiceStt?: boolean;
    /** Outgoing: text only, or text + ElevenLabs voice note (default text) */
    replyMode?: "text" | "both";
    elevenLabsVoiceId?: string;
    elevenLabsModel?: string;
  };
  cli?: {
    /** Outgoing: text only, or text + ElevenLabs on speakers (default text) */
    replyMode?: "text" | "both";
  };
  /** IANA timezone for accurate clock, e.g. Europe/Moscow */
  timezone?: string;
  features?: {
    /** Inject OS clock + clock.now tool (default true) — LLMs invent time otherwise */
    accurateClock?: boolean;
    /** Re-read / fix illiterate task 1–2 times before acting (default true) */
    /** Hierarchical session compaction (default true) */
    compaction?: boolean;
    /** On Windows, request UAC admin on gateway start (OPT-IN, default false) */
    requireAdmin?: boolean;
    /**
     * Use real Chrome/Yandex/Edge profile (logins + session tabs).
     * DEFAULT true. Set false (or HEYAGENT_BROWSER_GUEST=1) for disposable guest profile.
     * Attaching CDP restarts the browser with --restore-last-session.
     */
    browserRealProfile?: boolean;
    /** Side-effect-free gateway liveness heartbeat (default true). */
    heartbeat?: boolean;
  };
  /** Gateway liveness heartbeat (actionable schedules are handled by cron). */
  heartbeat?: {
    /** Minutes between liveness checks (default 30). */
    everyMinutes?: number;
  };
  integrations?: Record<string, { connected?: boolean; connectedAt?: string }>;
}

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

export interface SessionSummary {
  at: string;
  completed: string[];
  failed: string[];
  currentState: string;
  openQuestions: string[];
  text: string;
}

export interface AgentSession {
  id: string;
  channel: "cli" | "telegram" | "desktop";
  messages: Message[];
  createdAt: string;
  updatedAt: string;
  /** Latest working summary after compaction */
  workingSummary?: SessionSummary;
  archivedSummaries?: SessionSummary[];
  currentTask?: string;
}

export interface GatewayEvent {
  type: string;
  payload: unknown;
  timestamp: string;
}

export interface ApprovalRequest {
  id: string;
  action: string;
  description: string;
  toolName: string;
  arguments: Record<string, unknown>;
  createdAt: string;
  status: "pending" | "approved" | "denied";
}

export function generateId(prefix = ""): string {
  const id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  return prefix ? `${prefix}_${id}` : id;
}

export async function ensureDir(path: string, fs: typeof import("node:fs/promises")): Promise<void> {
  await fs.mkdir(path, { recursive: true });
}

export * from "./config.js";
export * from "./autonomy.js";
