import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getHeyAgentHome, ensureDir } from "@heyagent/shared";
import type { Mission } from "./types.js";
import { globalMissionQueue } from "./queue.js";
import { createTaskContract } from "./task-contract.js";
import { planToGraph } from "./plan-graph.js";

interface PersistedMissionQueue {
  version: number;
  items: Mission[];
  activeUiId: string | null;
  savedAt: string;
}

function queuePath(): string {
  return join(getHeyAgentHome(), "mission-queue.json");
}

export async function persistMissionQueue(): Promise<void> {
  await ensureDir(getHeyAgentHome(), { mkdir } as typeof import("node:fs/promises"));
  const snap = globalMissionQueue.snapshot();
  const payload: PersistedMissionQueue = {
    version: 1,
    ...snap,
    savedAt: new Date().toISOString(),
  };
  const path = queuePath();
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify(payload, null, 2), "utf-8");
  await rename(temporary, path);
}

export async function restoreMissionQueue(): Promise<void> {
  const p = queuePath();
  if (!existsSync(p)) return;
  try {
    const raw = migrateMissionQueue(JSON.parse(await readFile(p, "utf-8")) as unknown);
    // Re-queue interrupted running/waiting missions as waiting/paused so worker can resume
    for (const m of raw.items ?? []) {
      if (m.status === "running") m.status = "waiting";
    }
    globalMissionQueue.restore(raw);
  } catch {
    /* ignore corrupt */
  }
}

export function migrateMissionQueue(value: unknown): PersistedMissionQueue {
  if (!value || typeof value !== "object") throw new Error("mission queue must be an object");
  const candidate = value as {
    version?: unknown;
    items?: unknown;
    activeUiId?: unknown;
    savedAt?: unknown;
  };
  if (!Array.isArray(candidate.items)) throw new Error("mission queue items must be an array");
  const items = candidate.items.map(migrateMission);
  const activeUiId =
    typeof candidate.activeUiId === "string" &&
    items.some((mission) => mission.id === candidate.activeUiId)
      ? candidate.activeUiId
      : null;
  return {
    version: 1,
    items,
    activeUiId,
    savedAt: typeof candidate.savedAt === "string" ? candidate.savedAt : new Date().toISOString(),
  };
}

function migrateMission(value: unknown): Mission {
  if (!value || typeof value !== "object") throw new Error("invalid mission");
  const mission = value as Mission;
  if (
    typeof mission.id !== "string" ||
    typeof mission.goal !== "string" ||
    !mission.plan ||
    !Array.isArray(mission.plan.steps) ||
    !mission.checkpoint
  ) {
    throw new Error("invalid mission fields");
  }
  return {
    ...mission,
    version: 1,
    taskContract: mission.taskContract ?? createTaskContract(mission.goal),
    planGraph: mission.planGraph ?? planToGraph(mission.plan),
    activeWaits: Array.isArray(mission.activeWaits) ? mission.activeWaits : [],
    actionHistory: Array.isArray(mission.actionHistory) ? mission.actionHistory : [],
    artifacts: Array.isArray(mission.artifacts) ? mission.artifacts : [],
  };
}

export async function listWaitingMissions(): Promise<Mission[]> {
  return globalMissionQueue
    .list()
    .filter((m) => m.status === "waiting" || m.status === "paused");
}
