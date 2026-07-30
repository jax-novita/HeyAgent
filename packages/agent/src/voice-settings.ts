/**
 * Global voice settings (ElevenLabs credentials + replyMode for CLI & Telegram).
 * Not Telegram-scoped — same store as models credentials.
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  getCredentialsDir,
  getHeyAgentHome,
  ensureDir,
  loadConfig,
  saveConfig,
} from "@heyagent/shared";

const DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM"; // Rachel

export interface ElevenLabsCreds {
  apiKey?: string;
  voiceId?: string;
}

function credsPath(): string {
  return join(getCredentialsDir(), "elevenlabs.json");
}

function pendingPath(): string {
  return join(getHeyAgentHome(), "voice-pending.json");
}

export async function loadElevenLabsCreds(): Promise<ElevenLabsCreds> {
  let file: ElevenLabsCreds = {};
  if (existsSync(credsPath())) {
    try {
      file = JSON.parse(await readFile(credsPath(), "utf-8")) as ElevenLabsCreds;
    } catch {
      file = {};
    }
  }
  return {
    apiKey: process.env.ELEVENLABS_API_KEY || file.apiKey,
    voiceId: process.env.ELEVENLABS_VOICE_ID || file.voiceId,
  };
}

export async function saveElevenLabsCreds(patch: ElevenLabsCreds): Promise<void> {
  const fs = await import("node:fs/promises");
  await ensureDir(getCredentialsDir(), fs);
  const stored: ElevenLabsCreds = {};
  if (existsSync(credsPath())) {
    try {
      Object.assign(stored, JSON.parse(await readFile(credsPath(), "utf-8")));
    } catch {
      /* ignore */
    }
  }
  if (patch.apiKey !== undefined) stored.apiKey = patch.apiKey.trim();
  if (patch.voiceId !== undefined) stored.voiceId = patch.voiceId.trim() || DEFAULT_VOICE;
  await writeFile(credsPath(), JSON.stringify(stored, null, 2), "utf-8");
}

export async function hasElevenLabsKey(): Promise<boolean> {
  const c = await loadElevenLabsCreds();
  return Boolean(c.apiKey?.trim());
}

/** Toggle / set voice replies for BOTH cli and telegram at once. */
export async function setVoiceReplyBoth(on: boolean): Promise<void> {
  const config = await loadConfig();
  const mode = on ? "both" : "text";
  config.cli = { ...config.cli, replyMode: mode };
  config.telegram = { ...config.telegram, replyMode: mode };
  if (on && config.telegram) config.telegram.enabled = config.telegram.enabled ?? true;
  await saveConfig(config);
}

export async function isVoiceReplyOn(): Promise<boolean> {
  const config = await loadConfig();
  return config.cli?.replyMode === "both" || config.telegram?.replyMode === "both";
}

export async function voiceStatusText(): Promise<string> {
  const config = await loadConfig();
  const creds = await loadElevenLabsCreds();
  const on = await isVoiceReplyOn();
  const key = creds.apiKey ? `есть (${creds.apiKey.slice(0, 6)}…)` : "нет";
  const voice = creds.voiceId || config.telegram?.elevenLabsVoiceId || DEFAULT_VOICE;
  return [
    "🎙 Голос — ElevenLabs (hey chat + Telegram)",
    `Режим: ${on ? "ON (текст + голос)" : "OFF (только текст)"}`,
    `  · hey chat: ${config.cli?.replyMode === "both" ? "ElevenLabs → динамики" : "text"}`,
    `  · Telegram: ${config.telegram?.replyMode === "both" ? "ElevenLabs voice note" : "text"}`,
    `ElevenLabs API: ${key}`,
    `Voice ID: ${voice}`,
    "",
    "Настройка: /voice  или  hey voice",
  ].join("\n");
}

export function voiceMenuText(): string {
  return [
    "🎙 /voice — меню",
    "",
    "1 — вкл/выкл озвучку ответов (CLI + Telegram)",
    "2 — задать ElevenLabs API key",
    "3 — задать Voice ID",
    "4 — статус",
    "",
    "Напиши номер: 1   или   /voice 2   или   /voice 2 sk_xxx",
  ].join("\n");
}

type PendingKind = "api_key" | "voice_id" | "menu";

interface PendingMap {
  [channelKey: string]: { kind: PendingKind; at: string };
}

async function loadPending(): Promise<PendingMap> {
  if (!existsSync(pendingPath())) return {};
  try {
    return JSON.parse(await readFile(pendingPath(), "utf-8")) as PendingMap;
  } catch {
    return {};
  }
}

async function savePending(map: PendingMap): Promise<void> {
  const fs = await import("node:fs/promises");
  await ensureDir(getHeyAgentHome(), fs);
  await writeFile(pendingPath(), JSON.stringify(map, null, 2), "utf-8");
}

export async function setVoicePending(
  channelKey: string,
  kind: PendingKind,
): Promise<void> {
  const map = await loadPending();
  map[channelKey] = { kind, at: new Date().toISOString() };
  await savePending(map);
}

export async function clearVoicePending(channelKey: string): Promise<void> {
  const map = await loadPending();
  delete map[channelKey];
  await savePending(map);
}

/** If channel awaits menu pick / key / voice id, consume plain text. */
export async function tryConsumeVoicePending(
  channelKey: string,
  text: string,
): Promise<{ handled: true; reply: string } | null> {
  const map = await loadPending();
  const p = map[channelKey];
  if (!p) return null;
  const value = text.trim();
  if (!value || value.startsWith("/")) return null;

  if (p.kind === "menu") {
    if (!/^[1234]$/.test(value)) {
      delete map[channelKey];
      await savePending(map);
      return null; // ordinary chat
    }
    delete map[channelKey];
    await savePending(map);
    return handleVoiceCommand(value, channelKey);
  }

  delete map[channelKey];
  await savePending(map);

  if (p.kind === "api_key") {
    if (value.length < 10) {
      return { handled: true, reply: "Ключ слишком короткий. Ещё раз: /voice 2" };
    }
    await saveElevenLabsCreds({ apiKey: value });
    return {
      handled: true,
      reply: "✅ ElevenLabs API key сохранён (общий для hey chat и gateway).",
    };
  }
  await saveElevenLabsCreds({ voiceId: value });
  return { handled: true, reply: `✅ Voice ID: ${value}` };
}

export async function handleVoiceCommand(
  args: string,
  channelKey: string,
): Promise<{ handled: true; reply: string }> {
  const a = args.trim();
  const lower = a.toLowerCase();

  // bare /voice → menu (next message can be just 1/2/3/4)
  if (!a) {
    await setVoicePending(channelKey, "menu");
    return { handled: true, reply: `${await voiceStatusText()}\n\n${voiceMenuText()}` };
  }

  // /voice status | on | off (legacy)
  if (lower === "status") {
    return { handled: true, reply: await voiceStatusText() };
  }
  if (lower === "on") {
    await setVoiceReplyBoth(true);
    const has = await hasElevenLabsKey();
    return {
      handled: true,
      reply: has
        ? "🔊 Голос ON — ElevenLabs для hey chat (динамики) и Telegram (voice note)."
        : "🔊 Голос ON, но ключа нет — /voice 2  или  hey voice key",
    };
  }
  if (lower === "off") {
    await setVoiceReplyBoth(false);
    return { handled: true, reply: "🔇 Голос OFF — только текст." };
  }

  // menu numbers
  const num = lower.match(/^([1234])(?:\s+(.+))?$/);
  if (num) {
    const n = num[1];
    const rest = (num[2] || "").trim();
    if (n === "1") {
      const on = !(await isVoiceReplyOn());
      await setVoiceReplyBoth(on);
      return {
        handled: true,
        reply: on
          ? "🔊 Голос ON (CLI + Telegram)."
          : "🔇 Голос OFF.",
      };
    }
    if (n === "2") {
      if (rest) {
        await saveElevenLabsCreds({ apiKey: rest });
        return { handled: true, reply: "✅ ElevenLabs API key сохранён." };
      }
      await setVoicePending(channelKey, "api_key");
      return {
        handled: true,
        reply: "Пришли ElevenLabs API key следующим сообщением (или: /voice 2 sk_…).",
      };
    }
    if (n === "3") {
      if (rest) {
        await saveElevenLabsCreds({ voiceId: rest });
        return { handled: true, reply: `✅ Voice ID: ${rest}` };
      }
      await setVoicePending(channelKey, "voice_id");
      return {
        handled: true,
        reply: `Пришли Voice ID следующим сообщением (дефолт ${DEFAULT_VOICE}).`,
      };
    }
    if (n === "4") {
      return { handled: true, reply: await voiceStatusText() };
    }
  }

  // /voice key xxx  /voice id xxx
  if (lower.startsWith("key")) {
    const key = a.slice(3).trim();
    if (!key) {
      await setVoicePending(channelKey, "api_key");
      return { handled: true, reply: "Пришли API key следующим сообщением." };
    }
    await saveElevenLabsCreds({ apiKey: key });
    return { handled: true, reply: "✅ ElevenLabs API key сохранён." };
  }
  if (lower.startsWith("id") || lower.startsWith("voice")) {
    const id = a.replace(/^(id|voice)\s*/i, "").trim();
    if (!id) {
      await setVoicePending(channelKey, "voice_id");
      return { handled: true, reply: "Пришли Voice ID следующим сообщением." };
    }
    await saveElevenLabsCreds({ voiceId: id });
    return { handled: true, reply: `✅ Voice ID: ${id}` };
  }

  return {
    handled: true,
    reply: `Не понял.\n\n${voiceMenuText()}`,
  };
}
