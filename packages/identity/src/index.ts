import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import {
  getIdentityPath,
  getHeyAgentHome,
  ensureDir,
  type SupportedLocale,
} from "@heyagent/shared";
import {
  type AgentIdentity,
  validateAgentName,
  isValidAvatarId,
  AVATAR_CATALOG,
} from "./types.js";

export * from "./types.js";
export * from "./sprites.js";
export * from "./workspace.js";

export async function loadIdentity(): Promise<AgentIdentity | null> {
  const path = getIdentityPath();
  if (!existsSync(path)) return null;
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw) as AgentIdentity;
}

export async function saveIdentity(identity: AgentIdentity): Promise<void> {
  const home = getHeyAgentHome();
  await ensureDir(home, { mkdir } as typeof import("node:fs/promises"));
  await writeFile(getIdentityPath(), JSON.stringify(identity, null, 2), "utf-8");
}

export async function createIdentity(
  name: string,
  avatarId: string,
  persona = "friendly",
  locale: SupportedLocale = "en",
): Promise<AgentIdentity> {
  const nameError = validateAgentName(name, locale);
  if (nameError) throw new Error(nameError);
  if (!isValidAvatarId(avatarId)) {
    throw new Error(
      locale === "ru"
        ? `Недопустимый аватар. Выберите один из: ${AVATAR_CATALOG.map((a) => a.id).join(", ")}`
        : `Invalid avatar. Choose one of: ${AVATAR_CATALOG.map((a) => a.id).join(", ")}`,
    );
  }

  const identity: AgentIdentity = {
    name: name.trim(),
    avatarId,
    persona,
    createdAt: new Date().toISOString(),
  };
  await saveIdentity(identity);
  return identity;
}

export function isOnboarded(): boolean {
  return existsSync(getIdentityPath());
}
