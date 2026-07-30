import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig, saveConfig } from "@heyagent/shared";
import { synthesizeAgentReplyAudio } from "./elevenlabs-tts.js";

test("ElevenLabs retries the default voice after a configured voice returns 404", async () => {
  const previousKey = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = "test-key";
  const urls: string[] = [];
  const fetchImpl = (async (input) => {
    const url = String(input);
    urls.push(url);
    if (url.endsWith("/invalid-voice")) {
      return new Response('{"detail":"voice_not_found"}', { status: 404 });
    }
    return new Response(new Uint8Array([0x49, 0x44, 0x33]), { status: 200 });
  }) as typeof fetch;

  try {
    const result = await synthesizeAgentReplyAudio("Тестовый ответ", {
      voiceId: "invalid-voice",
      fetchImpl,
    });
    assert.equal("path" in result, true);
    assert.match(urls[0] ?? "", /invalid-voice$/);
    assert.match(urls[1] ?? "", /21m00Tcm4TlvDq8ikWAM$/);
    if ("path" in result) await rm(result.path, { force: true });
  } finally {
    if (previousKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = previousKey;
  }
});

test("ElevenLabs billing/auth failure silently switches reply modes to text", async () => {
  const previousHome = process.env.HEYAGENT_HOME;
  const previousKey = process.env.ELEVENLABS_API_KEY;
  const root = await mkdtemp(join(tmpdir(), "heyagent-voice-degrade-"));
  process.env.HEYAGENT_HOME = root;
  process.env.ELEVENLABS_API_KEY = "test-key";
  await saveConfig({
    cli: { replyMode: "both" },
    telegram: { enabled: true, replyMode: "both" },
  });
  const fetchImpl = (async () =>
    new Response('{"detail":"payment_required"}', { status: 402 })) as typeof fetch;

  try {
    const result = await synthesizeAgentReplyAudio("Проверка голосового ответа HeyAgent", { fetchImpl });
    assert.deepEqual(result, {
      skip: true,
      reason: "elevenlabs_unavailable_402",
    });
    const config = await loadConfig();
    assert.equal(config.cli?.replyMode, "text");
    assert.equal(config.telegram?.replyMode, "text");
  } finally {
    await rm(root, { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.HEYAGENT_HOME;
    else process.env.HEYAGENT_HOME = previousHome;
    if (previousKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = previousKey;
  }
});
