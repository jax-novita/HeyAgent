import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  getConfigPath,
  getHeyAgentHome,
  ensureDir,
  type HeyAgentConfig,
} from "@heyagent/shared";

export async function loadConfig(): Promise<HeyAgentConfig> {
  const path = getConfigPath();
  if (!existsSync(path)) {
    return {};
  }
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw) as HeyAgentConfig;
}

export async function saveConfig(config: HeyAgentConfig): Promise<void> {
  const home = getHeyAgentHome();
  await ensureDir(home, { mkdir } as typeof import("node:fs/promises"));
  await writeFile(getConfigPath(), JSON.stringify(config, null, 2), "utf-8");
}

export async function loadJson<T>(path: string, fallback: T): Promise<T> {
  if (!existsSync(path)) return fallback;
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw) as T;
}

export async function saveJson<T>(path: string, data: T): Promise<void> {
  const dir = path.replace(/[/\\][^/\\]+$/, "");
  await ensureDir(dir, { mkdir } as typeof import("node:fs/promises"));
  await writeFile(path, JSON.stringify(data, null, 2), "utf-8");
}
