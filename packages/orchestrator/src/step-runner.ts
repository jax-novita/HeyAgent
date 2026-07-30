/**
 * Mission step state machine — keeps plan progress across tool calls.
 */
import { markStep, nextPendingStep } from "./planner.js";
import type { Mission, Plan, PlanStep, StepStatus } from "./types.js";
import type { MissionQueue } from "./queue.js";

export function getCurrentStep(plan: Plan): PlanStep | undefined {
  return plan.steps.find((s) => s.status === "running") ?? nextPendingStep(plan);
}

export function beginStep(mission: Mission, stepId?: string): Mission {
  const step = stepId
    ? mission.plan.steps.find((s) => s.id === stepId)
    : nextPendingStep(mission.plan);
  if (!step) return mission;
  const plan = markStep(mission.plan, step.id, "running");
  const idx = plan.steps.findIndex((s) => s.id === step.id);
  return {
    ...mission,
    plan,
    checkpoint: {
      ...mission.checkpoint,
      planStepIndex: Math.max(0, idx),
    },
    updatedAt: new Date().toISOString(),
  };
}

export function completeStep(
  mission: Mission,
  status: Extract<StepStatus, "done" | "failed" | "skipped">,
  result?: string,
  stepId?: string,
): Mission {
  const step =
    (stepId && mission.plan.steps.find((s) => s.id === stepId)) ||
    mission.plan.steps.find((s) => s.status === "running") ||
    nextPendingStep(mission.plan);
  if (!step) return mission;
  const plan = markStep(mission.plan, step.id, status, result);
  const next = nextPendingStep(plan);
  const idx = next
    ? plan.steps.findIndex((s) => s.id === next.id)
    : plan.steps.length;
  return {
    ...mission,
    plan,
    status: status === "failed" ? "failed" : mission.status,
    error: status === "failed" ? result || mission.error : mission.error,
    checkpoint: {
      ...mission.checkpoint,
      planStepIndex: Math.max(0, idx),
    },
    updatedAt: new Date().toISOString(),
  };
}

/** Scratch working memory that survives between tool iterations. */
export function patchScratch(
  mission: Mission,
  patch: Record<string, unknown>,
): Mission {
  const extra = { ...(mission.checkpoint.extra || {}), ...patch };
  return {
    ...mission,
    checkpoint: { ...mission.checkpoint, extra },
    updatedAt: new Date().toISOString(),
  };
}

export function formatScratchBlock(mission: Mission): string {
  const extra = mission.checkpoint.extra || {};
  const keys = Object.keys(extra);
  if (!keys.length) return "";
  const lines = ["### WORKING MEMORY (orchestrator scratch — do not forget)"];
  for (const k of keys.slice(0, 20)) {
    const v = extra[k];
    const s = typeof v === "string" ? v : JSON.stringify(v);
    lines.push(`- ${k}: ${String(s).slice(0, 220)}`);
  }
  return lines.join("\n");
}

export function syncMission(queue: MissionQueue, mission: Mission): void {
  queue.update(mission.id, {
    plan: mission.plan,
    checkpoint: mission.checkpoint,
    status: mission.status,
    error: mission.error,
    updatedAt: mission.updatedAt,
  });
}

/** Heuristic: which plan step a tool advances. */
export function inferStepFromTool(
  plan: Plan,
  toolName: string,
): PlanStep | undefined {
  // The active step must be advanced before the next pending one. Looking only
  // at pending steps skipped verification of the running step after beginStep.
  const pending = plan.steps.find((s) => s.status === "running") ?? nextPendingStep(plan);
  if (!pending) return undefined;
  const n = toolName.toLowerCase();
  const kind = pending.kind;
  if (kind === "open_chat" && /telegram|app\.open/.test(n)) return pending;
  if (kind === "click_composer" && /click|composer|screen/.test(n)) return pending;
  if (kind === "send_message_once" && /telegram\.message|send/.test(n)) return pending;
  if (kind === "wait_for_reply" && /wait_reply|wait/.test(n)) return pending;
  if (kind === "browser_open_and_verify" && /browser\.|youtube|tabs/.test(n)) return pending;
  if (kind === "system_control" && /system\.|shell/.test(n)) return pending;
  if (kind === "llm_tool_loop") return pending;

  // A custom step is intentionally broad, but it must still name the tools
  // that can advance it. Previously any successful tool call consumed the
  // next custom step, so an unrelated read/search could falsely finish a plan.
  if (kind === "custom" || kind === "research") {
    const allowed = pending.params?.tools;
    if (!Array.isArray(allowed)) return undefined;
    return allowed.map(String).includes(toolName) ? pending : undefined;
  }
  return undefined;
}
