/**
 * ElevenLabs TTS → temp audio file (Telegram voice notes + CLI/desktop speakers).
 */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getCredentialsDir, loadConfig, saveConfig } from "@heyagent/shared";
import { prepareTextForTts } from "./tts-sanitize.js";

const DEFAULT_ELEVENLABS_VOICE = "21m00Tcm4TlvDq8ikWAM";
const invalidVoiceIds = new Set<string>();

async function resolveElevenLabsKey(): Promise<string | null> {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
  const path = join(getCredentialsDir(), "elevenlabs.json");
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(await readFile(path, "utf-8")) as { apiKey?: string };
    return raw.apiKey || null;
  } catch {
    return null;
  }
}

export async function synthesizeAgentReplyAudio(
  rawText: string,
  opts?: { voiceId?: string; modelId?: string; fetchImpl?: typeof fetch },
): Promise<{ path: string } | { skip: true; reason: string }> {
  const prepared = prepareTextForTts(rawText);
  if (prepared.skip || !prepared.text) {
    return { skip: true, reason: prepared.reason || "empty" };
  }

  const apiKey = await resolveElevenLabsKey();
  if (!apiKey) {
    return { skip: true, reason: "no_elevenlabs_key" };
  }

  const config = await loadConfig();
  let storedVoice: string | undefined;
  try {
    const path = join(getCredentialsDir(), "elevenlabs.json");
    if (existsSync(path)) {
      storedVoice = (JSON.parse(await readFile(path, "utf-8")) as { voiceId?: string }).voiceId;
    }
  } catch {
    /* ignore */
  }

  const configuredVoiceId =
    opts?.voiceId ||
    config.telegram?.elevenLabsVoiceId ||
    process.env.ELEVENLABS_VOICE_ID ||
    storedVoice ||
    DEFAULT_ELEVENLABS_VOICE;
  const voiceId = invalidVoiceIds.has(configuredVoiceId)
    ? DEFAULT_ELEVENLABS_VOICE
    : configuredVoiceId;
  const modelId =
    opts?.modelId ||
    config.telegram?.elevenLabsModel ||
    process.env.ELEVENLABS_MODEL ||
    "eleven_multilingual_v2";

  const fetchImpl = opts?.fetchImpl ?? globalThis.fetch;
  const request = (id: string) =>
    fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${id}`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: prepared.text,
        model_id: modelId,
        voice_settings: { stability: 0.4, similarity_boost: 0.75 },
      }),
    });

  let res = await request(voiceId);
  if (res.status === 404 && voiceId !== DEFAULT_ELEVENLABS_VOICE) {
    invalidVoiceIds.add(voiceId);
    res = await request(DEFAULT_ELEVENLABS_VOICE);
  }
  if (!res.ok) {
    if ([401, 402, 403].includes(res.status)) {
      config.cli = { ...config.cli, replyMode: "text" };
      config.telegram = { ...config.telegram, replyMode: "text" };
      await saveConfig(config).catch(() => undefined);
    }
    return { skip: true, reason: `elevenlabs_unavailable_${res.status}` };
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) return { skip: true, reason: "elevenlabs_empty_audio" };
  const dir = join(tmpdir(), "heyagent-tts");
  await mkdir(dir, { recursive: true });
  const outPath = join(dir, `reply-${Date.now()}.mp3`);
  await writeFile(outPath, buf);
  return { path: outPath };
}
