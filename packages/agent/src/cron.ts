import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getHeyAgentHome, ensureDir, generateId } from "@heyagent/shared";

export interface CronDailySchedule {
  kind: "daily";
  hourLocal: number;
  minuteLocal: number;
}

export interface CronJob {
  id: string;
  name: string;
  prompt: string;
  everyMinutes: number;
  /** If set, overrides everyMinutes for next-run calculation. */
  schedule?: CronDailySchedule;
  nextRunAt: string;
  enabled: boolean;
  lastRunAt?: string;
  lastResult?: string;
  createdAt: string;
}

interface CronStore {
  jobs: CronJob[];
}

function cronPath(): string {
  return join(getHeyAgentHome(), "cron.json");
}

async function loadStore(): Promise<CronStore> {
  if (!existsSync(cronPath())) return { jobs: [] };
  try {
    return JSON.parse(await readFile(cronPath(), "utf-8")) as CronStore;
  } catch {
    return { jobs: [] };
  }
}

async function saveStore(store: CronStore): Promise<void> {
  const fs = await import("node:fs/promises");
  await ensureDir(getHeyAgentHome(), fs);
  await writeFile(cronPath(), JSON.stringify(store, null, 2), "utf-8");
}

function nextDailyRun(hour: number, minute: number, from = new Date()): Date {
  const h = Math.max(0, Math.min(23, hour));
  const m = Math.max(0, Math.min(59, minute));
  const next = new Date(from);
  next.setSeconds(0, 0);
  next.setHours(h, m, 0, 0);
  if (next.getTime() <= from.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

export async function cronSchedule(
  name: string,
  prompt: string,
  everyMinutes: number,
  daily?: { hourLocal: number; minuteLocal: number },
): Promise<string> {
  const store = await loadStore();
  const mins = Math.max(1, Math.min(Number(everyMinutes) || 60, 60 * 24 * 7));
  const schedule: CronDailySchedule | undefined = daily
    ? { kind: "daily", hourLocal: daily.hourLocal, minuteLocal: daily.minuteLocal }
    : undefined;
  const nextRunAt = schedule
    ? nextDailyRun(schedule.hourLocal, schedule.minuteLocal).toISOString()
    : new Date(Date.now() + mins * 60_000).toISOString();
  const job: CronJob = {
    id: generateId("cron"),
    name: name.trim() || "job",
    prompt: prompt.trim(),
    everyMinutes: schedule ? 60 * 24 : mins,
    schedule,
    nextRunAt,
    enabled: true,
    createdAt: new Date().toISOString(),
  };
  store.jobs.push(job);
  await saveStore(store);
  if (schedule) {
    return `Scheduled "${job.name}" daily at ${String(schedule.hourLocal).padStart(2, "0")}:${String(schedule.minuteLocal).padStart(2, "0")} (id ${job.id}). Next: ${job.nextRunAt}. Gateway must be running.`;
  }
  return `Scheduled "${job.name}" every ${mins} min (id ${job.id}). Next: ${job.nextRunAt}. Gateway must be running.`;
}

export async function cronList(): Promise<string> {
  const store = await loadStore();
  if (!store.jobs.length) return "No cron jobs.";
  return store.jobs
    .map((j) => {
      const when = j.schedule
        ? `daily ${String(j.schedule.hourLocal).padStart(2, "0")}:${String(j.schedule.minuteLocal).padStart(2, "0")}`
        : `every ${j.everyMinutes}m`;
      return `- ${j.id} | ${j.enabled ? "ON" : "OFF"} | ${when} | ${j.name}\n  next: ${j.nextRunAt}\n  prompt: ${j.prompt.slice(0, 120)}`;
    })
    .join("\n");
}

export async function cronCancel(id: string): Promise<string> {
  const store = await loadStore();
  const before = store.jobs.length;
  store.jobs = store.jobs.filter((j) => j.id !== id && j.name !== id);
  await saveStore(store);
  return store.jobs.length < before ? `Cancelled ${id}` : `Job not found: ${id}`;
}

/** Due jobs for gateway ticker. */
export async function cronDueJobs(): Promise<CronJob[]> {
  const store = await loadStore();
  const now = Date.now();
  return store.jobs.filter((j) => j.enabled && new Date(j.nextRunAt).getTime() <= now);
}

export async function cronMarkRan(id: string, result: string): Promise<void> {
  const store = await loadStore();
  const job = store.jobs.find((j) => j.id === id);
  if (!job) return;
  job.lastRunAt = new Date().toISOString();
  job.lastResult = result.slice(0, 500);
  if (job.schedule?.kind === "daily") {
    job.nextRunAt = nextDailyRun(
      job.schedule.hourLocal,
      job.schedule.minuteLocal,
      new Date(Date.now() + 60_000),
    ).toISOString();
  } else {
    job.nextRunAt = new Date(Date.now() + job.everyMinutes * 60_000).toISOString();
  }
  await saveStore(store);
}
