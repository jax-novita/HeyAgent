/**
 * Telegram Bot API media — send files/photos/text to the paired owner chat.
 * (Contact file send via Desktop UI lives in index.ts as telegramSendFileUi.)
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { loadConfig } from "@heyagent/shared";

async function ownerChat(): Promise<{ token: string; chatId: number } | string> {
  const config = await loadConfig();
  const token = config.telegram?.botToken;
  if (!token) return "Telegram bot token missing. Run: hey telegram setup";
  const chatId = config.telegram?.allowedChatIds?.[0];
  if (!chatId) return "No paired chat_id. Run: hey telegram pair";
  return { token, chatId };
}

export async function telegramSendDocumentBot(
  filePath: string,
  caption?: string,
  chatId?: number,
): Promise<string> {
  const owner = await ownerChat();
  if (typeof owner === "string") return owner;
  const target = chatId ?? owner.chatId;
  const buf = await readFile(filePath);
  const form = new FormData();
  form.append("chat_id", String(target));
  form.append("document", new Blob([new Uint8Array(buf)]), basename(filePath));
  if (caption) form.append("caption", caption.slice(0, 1024));

  const res = await fetch(`https://api.telegram.org/bot${owner.token}/sendDocument`, {
    method: "POST",
    body: form,
  });
  const data = (await res.json()) as { ok: boolean; description?: string };
  if (!data.ok) return `Bot sendDocument failed: ${data.description ?? res.status}`;
  return `Sent document to owner chat ${target}: ${basename(filePath)}`;
}

export async function telegramSendPhotoBot(
  filePath: string,
  caption?: string,
  chatId?: number,
): Promise<string> {
  const owner = await ownerChat();
  if (typeof owner === "string") return owner;
  const target = chatId ?? owner.chatId;
  const buf = await readFile(filePath);
  const form = new FormData();
  form.append("chat_id", String(target));
  form.append("photo", new Blob([new Uint8Array(buf)]), basename(filePath));
  if (caption) form.append("caption", caption.slice(0, 1024));

  const res = await fetch(`https://api.telegram.org/bot${owner.token}/sendPhoto`, {
    method: "POST",
    body: form,
  });
  const data = (await res.json()) as { ok: boolean; description?: string };
  if (!data.ok) return `Bot sendPhoto failed: ${data.description ?? res.status}`;
  return `Sent photo to owner chat ${target}: ${basename(filePath)}`;
}

export async function telegramNotifyOwner(text: string): Promise<string> {
  const owner = await ownerChat();
  if (typeof owner === "string") return owner;
  const res = await fetch(`https://api.telegram.org/bot${owner.token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: owner.chatId, text: text.slice(0, 4096) }),
  });
  const data = (await res.json()) as { ok: boolean; description?: string };
  if (!data.ok) return `Notify failed: ${data.description}`;
  return "Notified owner via bot";
}

/** Send a voice note (or audio) to a chat — used for ElevenLabs agent replies. */
export async function telegramSendVoiceBot(
  filePath: string,
  chatId?: number,
  caption?: string,
): Promise<string> {
  const owner = await ownerChat();
  if (typeof owner === "string") return owner;
  const target = chatId ?? owner.chatId;
  const buf = await readFile(filePath);
  const form = new FormData();
  form.append("chat_id", String(target));
  const name = basename(filePath);
  const isMp3 = /\.mp3$/i.test(name);
  form.append(isMp3 ? "audio" : "voice", new Blob([new Uint8Array(buf)]), name);
  if (caption) form.append("caption", caption.slice(0, 1024));

  const method = isMp3 ? "sendAudio" : "sendVoice";
  const res = await fetch(`https://api.telegram.org/bot${owner.token}/${method}`, {
    method: "POST",
    body: form,
  });
  const data = (await res.json()) as { ok: boolean; description?: string };
  if (!data.ok) return `Bot ${method} failed: ${data.description ?? res.status}`;
  return `Sent voice to chat ${target}: ${name}`;
}
