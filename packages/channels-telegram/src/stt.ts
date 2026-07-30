import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveApiKeyForProvider } from "@heyagent/models";

/**
 * Transcribe audio (Telegram voice OGG/Opus, etc.) via OpenAI Whisper.
 */
export async function transcribeAudioBuffer(
  buffer: Buffer,
  filename = "voice.ogg",
  language = "ru",
): Promise<string> {
  const apiKey = await resolveApiKeyForProvider("openai");
  if (!apiKey) {
    throw new Error(
      "Для голосовых нужен OpenAI API key (Whisper). Выполни: hey models auth openai",
    );
  }

  const tmp = join(tmpdir(), `heyagent-voice-${Date.now()}-${filename}`);
  await writeFile(tmp, buffer);
  try {
    const blob = new Blob([new Uint8Array(buffer)], { type: guessMime(filename) });
    const form = new FormData();
    form.append("file", blob, filename);
    form.append("model", "whisper-1");
    if (language) form.append("language", language);

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Whisper STT failed (${res.status}): ${errText.slice(0, 400)}`);
    }
    const data = (await res.json()) as { text?: string };
    const text = (data.text ?? "").trim();
    if (!text) throw new Error("Whisper вернул пустой текст");
    return text;
  } finally {
    await unlink(tmp).catch(() => undefined);
  }
}

function guessMime(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".ogg") || lower.endsWith(".opus")) return "audio/ogg";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".webm")) return "audio/webm";
  return "application/octet-stream";
}
