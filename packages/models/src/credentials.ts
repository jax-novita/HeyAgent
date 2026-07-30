import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getCredentialsDir, ensureDir } from "@heyagent/shared";
import { getProvider, type ModelRef } from "./providers.js";

export interface StoredCredentials {
  apiKey?: string;
  baseUrl?: string;
  oauthToken?: string;
  /** ElevenLabs voice id */
  voiceId?: string;
}

export async function resolveApiKeyForProvider(providerId: string): Promise<string | null> {
  const stored = await loadProviderCredentials(providerId);
  if (stored?.apiKey) return stored.apiKey;

  const provider = getProvider(providerId);
  if (!provider?.envKey) return null;

  const fromEnv = process.env[provider.envKey] ?? null;
  if (fromEnv) return fromEnv;
  // Bedrock also documents AWS_BEARER_TOKEN_BEDROCK; accept alias
  if (providerId === "bedrock") {
    return process.env.AWS_BEARER_TOKEN_BEDROCK ?? process.env.BEDROCK_API_KEY ?? null;
  }
  if (providerId === "elevenlabs") {
    return process.env.ELEVENLABS_API_KEY ?? null;
  }
  return null;
}

export async function loadProviderCredentials(
  providerId: string,
): Promise<StoredCredentials | null> {
  const path = join(getCredentialsDir(), `${providerId}.json`);
  if (!existsSync(path)) return null;
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw) as StoredCredentials;
}

export async function saveProviderCredentials(
  providerId: string,
  creds: StoredCredentials,
): Promise<void> {
  const dir = getCredentialsDir();
  await ensureDir(dir, { mkdir } as typeof import("node:fs/promises"));
  await writeFile(join(dir, `${providerId}.json`), JSON.stringify(creds, null, 2), "utf-8");
}

export async function getProviderBaseUrl(providerId: string): Promise<string | undefined> {
  const stored = await loadProviderCredentials(providerId);
  if (stored?.baseUrl) return stored.baseUrl;
  if (providerId === "bedrock") {
    const region =
      process.env.AWS_REGION ||
      process.env.AWS_DEFAULT_REGION ||
      process.env.BEDROCK_REGION ||
      "us-east-1";
    return `https://bedrock-mantle.${region}.api.aws/v1`;
  }
  return getProvider(providerId)?.baseUrl;
}

export function resolveDefaultModel(config: {
  defaultProvider?: string;
  defaultModel?: string;
}): ModelRef {
  return {
    provider: config.defaultProvider ?? "openai",
    model: config.defaultModel ?? "gpt-4.1-mini",
  };
}

/** Parse "provider/model" strings from config.models.fallbacks */
export function parseModelFallbacks(raw?: string[]): ModelRef[] {
  if (!raw?.length) return [];
  const out: ModelRef[] = [];
  for (const s of raw) {
    const t = String(s ?? "").trim();
    if (!t) continue;
    const slash = t.indexOf("/");
    if (slash <= 0) continue;
    out.push({ provider: t.slice(0, slash), model: t.slice(slash + 1) });
  }
  return out;
}

export function resolveFastModel(config: {
  defaultProvider?: string;
  defaultModel?: string;
  fastProvider?: string;
  fastModel?: string;
}): ModelRef {
  if (config.fastProvider && config.fastModel) {
    return { provider: config.fastProvider, model: config.fastModel };
  }
  return resolveDefaultModel(config);
}
