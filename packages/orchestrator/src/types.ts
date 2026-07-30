/** Core types for the HeyAgent orchestration stack. */
import type { WorldState } from "@heyagent/shared";
import type { ActionRecord } from "./action-ledger.js";
import type { PlanGraph } from "./plan-graph.js";
import type { TaskContract } from "./task-contract.js";
import type { WaitCondition } from "./waits.js";

export type Domain =
  | "messaging"
  | "mail"
  | "browser"
  | "system"
  | "research"
  | "desktop"
  | "coder"
  | "general";

export type AgentKind =
  | "messaging"
  | "browser"
  | "system"
  | "research"
  | "desktop"
  | "coder"
  | "general";

export type StepKind =
  | "open_chat"
  | "confirm_focus"
  | "click_composer"
  | "send_message_once"
  | "wait_for_reply"
  | "read_reply"
  | "compose_reply"
  | "browser_open_and_verify"
  | "system_control"
  | "research"
  | "llm_tool_loop"
  | "cancel"
  | "custom";

export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";

export type StepPriority = "critical" | "high" | "normal" | "low";

export type StepRetryPolicy = "none" | "backoff" | "exponential";

export interface PlanStep {
  id: string;
  kind: StepKind;
  title: string;
  status: StepStatus;
  params?: Record<string, unknown>;
  result?: string;
  /** Optional verifier name to run after the step. */
  verify?: string;
  /** Execution weight for logging + scheduling. Defaults to "normal". */
  priority?: StepPriority;
  /** Hard wall-clock budget for this step in ms. Undefined = harness default. */
  timeoutMs?: number;
  /** How the harness should retry a soft/hard failure. Defaults to "backoff". */
  retryPolicy?: StepRetryPolicy;
}

export interface Plan {
  id: string;
  goal: string;
  domain: Domain;
  agent: AgentKind;
  steps: PlanStep[];
  createdAt: string;
  updatedAt: string;
}

export type MissionKind =
  | "chat_until"
  | "one_shot"
  | "browser_tour"
  | "system"
  | "research"
  | "background_wait";

export type MissionStatus =
  | "queued"
  | "running"
  | "waiting"
  | "paused"
  | "done"
  | "cancelled"
  | "failed";

export interface MissionCheckpoint {
  planStepIndex: number;
  lastSeenReply?: string;
  lastSentMessage?: string;
  transcript?: { role: "agent" | "them"; text: string; at: string }[];
  world?: WorldSnapshot;
  extra?: Record<string, unknown>;
  /** ISO time the checkpoint was last persisted — used for crash recovery. */
  lastSavedAt?: string;
}

export interface Mission {
  /** Persisted schema version. Missing means legacy v0 and is migrated on load. */
  version?: number;
  id: string;
  kind: MissionKind;
  domain: Domain;
  agent: AgentKind;
  status: MissionStatus;
  goal: string;
  plan: Plan;
  /** UI missions serialize through the single-flight queue. */
  requiresUi: boolean;
  checkpoint: MissionCheckpoint;
  createdAt: string;
  updatedAt: string;
  error?: string;
  /** Parent mission that spawned this one (sub-mission hierarchy). */
  parentId?: string;
  /** Child mission ids spawned by this mission. */
  children?: string[];
  /** ISO wall-clock deadline. The runner abandons the mission after this. */
  deadlineAt?: string;
  taskContract?: TaskContract;
  planGraph?: PlanGraph;
  activeWaits?: WaitCondition[];
  actionHistory?: ActionRecord[];
  lastConfirmedWorldState?: WorldState;
  artifacts?: string[];
}

export interface RouteAlternate {
  domain: Domain;
  agent: AgentKind;
  priority: number;
  reason: string;
}

export interface RouteDecision {
  domain: Domain;
  agent: AgentKind;
  requiresUi: boolean;
  missionKind: MissionKind;
  priority: number;
  reason: string;
  /** Extracted slots for planners. */
  slots: Record<string, string>;
  /**
   * Router self-confidence in [0..1]. Derived from the winning rule priority.
   * Downstream can request LLM disambiguation when this is low and an
   * alternate is close behind. Optional so old callers keep working.
   */
  confidence?: number;
  /** Runner-up domains considered, strongest first. Empty for hard matches. */
  alternates?: RouteAlternate[];
}

export type Verdict = "pass" | "fail" | "unknown";

export interface VerifyResult {
  verdict: Verdict;
  reason: string;
  evidence?: string;
  screenshotPath?: string;
}

export interface WorldSnapshot {
  at: string;
  focusedWindow?: string;
  focusedProcess?: string;
  telegram?: {
    chatOpen?: string | null;
    searchBarText?: string | null;
    unreadHint?: boolean;
  };
  browser?: {
    url?: string;
    title?: string;
  };
  notes?: string[];
}

export interface TimelineEvent {
  id: string;
  at: string;
  missionId?: string;
  kind: "route" | "plan" | "step" | "tool" | "verify" | "status" | "error" | "recovery" | "approval" | "observation";
  name: string;
  detail?: string;
  verdict?: Verdict;
  screenshotPath?: string;
}

export interface PersonMemory {
  name: string;
  aliases: string[];
  handle?: string;
  channel?: string;
  tone?: string;
  notes?: string;
  updatedAt: string;
}

export interface EpisodicEntry {
  id: string;
  at: string;
  goal: string;
  domain: Domain;
  tried: string;
  outcome: "success" | "fail";
  lesson: string;
}

export interface OrchestratorProgress {
  status: "idle" | "thinking" | "working" | "waiting" | "done" | "error";
  detail?: string;
  missionId?: string;
  domain?: Domain;
}
