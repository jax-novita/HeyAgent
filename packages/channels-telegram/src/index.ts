import { loadConfig } from "@heyagent/shared";
import { AgentRuntime } from "@heyagent/agent";
import {
  synthesizeAgentReplyAudio,
  telegramSendVoiceBot,
} from "@heyagent/computer";
import { transcribeAudioBuffer } from "./stt.js";
import {
  tryResumeWaitingOwner,
  tryHandleChatCommand,
  TELEGRAM_BOT_COMMANDS,
} from "@heyagent/agent";

interface TelegramFileRef {
  file_id: string;
  file_unique_id?: string;
  duration?: number;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
    caption?: string;
    voice?: TelegramFileRef;
    audio?: TelegramFileRef & { file_name?: string };
    video_note?: TelegramFileRef;
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat: { id: number }; message_id: number };
  };
}

/**
 * Telegram long-polling that stays alive through ECONNRESET / 409 conflicts,
 * always ACKs the user immediately, and never blocks the poll loop on agent work.
 */
export class TelegramChannel {
  private token: string;
  private allowedChatIds: Set<number>;
  private agent: Pick<AgentRuntime, "run">;
  private fetchImpl: typeof fetch;
  private voiceReplies: boolean;
  private pendingApprovals = new Map<string, (approved: boolean) => void>();
  private offset = 0;
  private running = false;
  private backoffMs = 1000;
  /** One agent job per chat; extras queue so poll never stalls. */
  private busyChats = new Set<number>();
  private chatQueues = new Map<number, string[]>();

  constructor(
    token: string,
    allowedChatIds: number[] = [],
    dependencies: {
      agent?: Pick<AgentRuntime, "run">;
      fetch?: typeof fetch;
      voiceReplies?: boolean;
    } = {},
  ) {
    this.token = token;
    this.allowedChatIds = new Set(allowedChatIds);
    this.agent = dependencies.agent ?? new AgentRuntime();
    this.fetchImpl = dependencies.fetch ?? globalThis.fetch;
    this.voiceReplies = dependencies.voiceReplies ?? true;
  }

  static async fromConfig(): Promise<TelegramChannel | null> {
    const config = await loadConfig();
    if (!config.telegram?.enabled || !config.telegram.botToken) return null;
    return new TelegramChannel(
      config.telegram.botToken,
      config.telegram.allowedChatIds ?? [],
    );
  }

  async start(): Promise<void> {
    this.running = true;
    console.log(
      "Telegram channel started (resilient long polling + instant ACK + voice STT)",
    );

    try {
      await this.bootstrap();
    } catch (err) {
      console.error("Telegram bootstrap warning:", err instanceof Error ? err.message : err);
    }

    while (this.running) {
      try {
        await this.poll();
        this.backoffMs = 1000;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("Telegram poll error:", msg);
        if (/409|Conflict/i.test(msg)) {
          console.error(
            "→ Уже крутится ДРУГОЙ gateway с этим ботом. Оставь только один: убей лишние node и снова npx hey gateway start",
          );
          await sleep(Math.max(this.backoffMs, 15_000));
        } else {
          await sleep(this.backoffMs);
          this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
        }
      }
    }
  }

  stop(): void {
    this.running = false;
  }

  private async bootstrap(): Promise<void> {
    const del = await this.api<{ ok: boolean; description?: string }>("deleteWebhook", {
      drop_pending_updates: false,
    });
    console.log("Telegram deleteWebhook:", del.ok ? "ok" : del.description ?? "fail");

    const me = await this.api<{
      ok: boolean;
      result?: { username?: string; id?: number };
      description?: string;
    }>("getMe");
    if (!me.ok) {
      throw new Error(`getMe failed: ${me.description ?? "unknown"}`);
    }
    console.log(`Telegram bot online: @${me.result?.username ?? "?"} (id=${me.result?.id})`);

    try {
      await this.api("setMyCommands", { commands: TELEGRAM_BOT_COMMANDS });
    } catch (err) {
      console.warn(
        "setMyCommands skipped:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  private async poll(): Promise<void> {
    const data = await this.api<{
      ok: boolean;
      result?: TelegramUpdate[];
      description?: string;
      error_code?: number;
    }>(
      "getUpdates",
      {
        offset: this.offset,
        timeout: 25,
        allowed_updates: ["message", "callback_query"],
      },
      40_000,
    );

    if (!data.ok) {
      const desc = data.description ?? "Telegram API error";
      if (data.error_code === 409) throw new Error(`409 Conflict: ${desc}`);
      throw new Error(desc);
    }

    const updates = Array.isArray(data.result) ? data.result : [];
    for (const candidate of updates) {
      const update = parseTelegramUpdate(candidate);
      if (!update) {
        console.warn("Telegram ignored malformed update");
        continue;
      }
      this.offset = update.update_id + 1;
      // Do NOT await agent — keep polling alive
      void this.handleUpdate(update).catch((err) => {
        console.error("Telegram handleUpdate error:", err);
      });
    }
  }

  /** Validated entry point used by channel adapters and integration tests. */
  async acceptUpdate(candidate: unknown): Promise<boolean> {
    const update = parseTelegramUpdate(candidate);
    if (!update) return false;
    await this.handleUpdate(update);
    return true;
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (update.callback_query) {
      await this.handleCallback(update.callback_query);
      return;
    }

    const msg = update.message;
    if (!msg) return;

    const chatId = msg.chat.id;
    if (this.allowedChatIds.size > 0 && !this.allowedChatIds.has(chatId)) {
      await this.sendMessage(chatId, "Unauthorized. Pair this chat with: hey telegram pair");
      return;
    }

    let text = msg.text?.trim() ?? "";

    const voiceRef = msg.voice ?? msg.audio ?? msg.video_note;
    if (voiceRef && !text) {
      const config = await loadConfig();
      if (config.telegram?.voiceStt === false) {
        await this.sendMessage(
          chatId,
          "Голосовые отключены (telegram.voiceStt=false). Напиши текстом или включи STT в конфиге.",
        );
        return;
      }

      await this.sendChatAction(chatId, "typing");
      await this.sendMessage(chatId, "🎙 Слушаю… распознаю голос.");
      try {
        const filename = msg.audio?.file_name ?? (msg.voice ? "voice.ogg" : "audio.ogg");
        const buffer = await this.downloadFile(voiceRef.file_id);
        const transcript = await transcribeAudioBuffer(buffer, filename, "ru");
        const caption = msg.caption?.trim();
        text = caption ? `${caption}\n\n${transcript}` : transcript;
        await this.sendMessage(chatId, `📝 Распознано:\n${transcript}`);
      } catch (err) {
        await this.sendMessage(
          chatId,
          `Не удалось распознать голос: ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }
    }

    if (!text) return;

    // In-chat settings: /switchmodel /switchavatar /voice /status …
    const cmd = await tryHandleChatCommand(text, {
      channel: "telegram",
      channelKey: `telegram:${chatId}`,
    });
    if (cmd.handled && cmd.reply) {
      await this.sendMessage(chatId, cmd.reply);
      return;
    }

    const resumed = await tryResumeWaitingOwner(chatId, text, async (msg) => {
      await this.sendMessage(chatId, msg);
    });
    if (resumed) {
      await this.runAgentForChat(chatId, resumed);
      return;
    }

    const preview = text.length > 80 ? `${text.slice(0, 77)}…` : text;
    await this.sendMessage(chatId, `✅ Принял: «${preview}»\n⏳ Работаю…`);

    if (this.busyChats.has(chatId)) {
      const q = this.chatQueues.get(chatId) ?? [];
      q.push(text);
      this.chatQueues.set(chatId, q);
      await this.sendMessage(
        chatId,
        `Ещё занят предыдущей задачей. В очереди: ${q.length}. Сделаю по порядку.`,
      );
      return;
    }

    await this.runAgentForChat(chatId, text);
  }

  private async runAgentForChat(chatId: number, text: string): Promise<void> {
    this.busyChats.add(chatId);
    const typingTimer = setInterval(() => {
      void this.sendChatAction(chatId, "typing");
    }, 4000);

    try {
      await this.sendChatAction(chatId, "typing");
      const result = await this.agent.run(text, {
        channel: "telegram",
        channelKey: `telegram:${chatId}`,
        onStatus: (status, detail) => {
          if (typeof detail === "string" && detail.startsWith("clarified:")) {
            void this.sendMessage(
              chatId,
              `🔎 Перечитал и понял так:\n«${detail.slice("clarified:".length)}»\nДальше делаю.`,
            );
          } else if (status === "thinking" && detail === "reread") {
            void this.sendMessage(chatId, "📖 Перечитываю задание (исправляю смысл/ошибки)…");
          } else if (typeof detail === "string" && detail.startsWith("orchestrator:")) {
            void this.sendMessage(chatId, `🧭 ${detail.slice("orchestrator:".length)}`);
          } else if (typeof detail === "string" && /жду ответ/i.test(detail)) {
            void this.sendMessage(chatId, `⏳ ${detail}`);
          } else if (status === "working" && detail === "telegram.wait_reply") {
            void this.sendMessage(chatId, "⏳ Жду ответ собеседника в Telegram…");
          }
        },
        onApprovalNeeded: async (desc, toolName, args) => {
          const approvalId = `${Date.now()}`;
          await this.sendApproval(chatId, approvalId, desc, toolName, args);
          return new Promise<boolean>((resolve) => {
            this.pendingApprovals.set(approvalId, resolve);
            setTimeout(() => {
              if (this.pendingApprovals.has(approvalId)) {
                this.pendingApprovals.delete(approvalId);
                resolve(false);
              }
            }, 120_000);
          });
        },
      });
      const response = result.response || "(пустой ответ)";
      await this.sendMessage(chatId, response);
      if (this.voiceReplies) await this.maybeSendVoiceReply(chatId, response);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Telegram agent error chat=${chatId}:`, msg);
      await this.sendMessage(chatId, `❌ Ошибка: ${msg}`);
    } finally {
      clearInterval(typingTimer);
      this.busyChats.delete(chatId);
      const q = this.chatQueues.get(chatId) ?? [];
      if (q.length) {
        const next = q.shift()!;
        this.chatQueues.set(chatId, q);
        await this.sendMessage(chatId, `⏭ Следующее из очереди: «${next.slice(0, 60)}»`);
        void this.runAgentForChat(chatId, next);
      }
    }
  }

  private async api<T extends { ok?: boolean }>(
    method: string,
    body?: Record<string, unknown>,
    timeoutMs = 20_000,
  ): Promise<T> {
    const url = `https://api.telegram.org/bot${this.token}/${method}`;
    const attempts = method === "getUpdates" ? 3 : 2;
    let lastErr: unknown;

    for (let i = 0; i < attempts; i++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      try {
        const res = await this.fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body ?? {}),
          signal: ac.signal,
        });
        return (await res.json()) as T;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (i < attempts - 1) {
          console.warn(`Telegram ${method} retry ${i + 1}: ${msg}`);
          await sleep(800 * (i + 1));
          continue;
        }
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastErr instanceof Error
      ? lastErr
      : new Error(`Telegram ${method} failed: ${String(lastErr)}`);
  }

  private async downloadFile(fileId: string): Promise<Buffer> {
    const meta = await this.api<{
      ok: boolean;
      result?: { file_path?: string };
      description?: string;
    }>("getFile", { file_id: fileId });
    if (!meta.ok || !meta.result?.file_path) {
      throw new Error(meta.description ?? "getFile failed");
    }
    const fileRes = await this.fetchImpl(
      `https://api.telegram.org/file/bot${this.token}/${meta.result.file_path}`,
      { signal: AbortSignal.timeout(60_000) },
    );
    if (!fileRes.ok) throw new Error(`Download failed: ${fileRes.status}`);
    return Buffer.from(await fileRes.arrayBuffer());
  }

  private async maybeSendVoiceReply(chatId: number, response: string): Promise<void> {
    try {
      const config = await loadConfig();
      if (config.telegram?.replyMode !== "both") return;
      const audio = await synthesizeAgentReplyAudio(response, {
        voiceId: config.telegram.elevenLabsVoiceId,
        modelId: config.telegram.elevenLabsModel,
      });
      if ("skip" in audio) {
        if (process.env.HEYAGENT_DEBUG === "1") {
          console.warn(`Telegram voice skipped: ${audio.reason}`);
        }
        return;
      }
      await telegramSendVoiceBot(audio.path, chatId);
    } catch (err) {
      if (process.env.HEYAGENT_DEBUG === "1") {
        console.warn("Telegram voice reply failed:", err instanceof Error ? err.message : err);
      }
    }
  }

  private async handleCallback(
    query: NonNullable<TelegramUpdate["callback_query"]>,
  ): Promise<void> {
    const data = query.data ?? "";
    const [action, approvalId] = data.split(":");
    const resolver = this.pendingApprovals.get(approvalId);
    if (resolver) {
      resolver(action === "approve");
      this.pendingApprovals.delete(approvalId);
    }
    await this.api("answerCallbackQuery", { callback_query_id: query.id }).catch(() => undefined);
  }

  private async sendApproval(
    chatId: number,
    approvalId: string,
    description: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<void> {
    const plan = [
      "📋 Safe preview — подтверди действие:",
      "",
      description,
      "",
      `Инструмент: ${toolName}`,
      `Аргументы: ${JSON.stringify(args).slice(0, 500)}`,
      "",
      "Approve = выполнить. Deny = отменить.",
    ].join("\n");
    await this.api("sendMessage", {
      chat_id: chatId,
      text: plan.slice(0, 4000),
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Approve", callback_data: `approve:${approvalId}` },
            { text: "Deny", callback_data: `deny:${approvalId}` },
          ],
        ],
      },
    });
  }

  private async sendChatAction(chatId: number, action: string): Promise<void> {
    await this.api("sendChatAction", { chat_id: chatId, action }, 8_000).catch(() => undefined);
  }

  private async sendMessage(chatId: number, text: string): Promise<void> {
    for (const chunk of splitTelegramText(text, 4096)) {
      try {
        const res = await this.api<{ ok: boolean; description?: string }>("sendMessage", {
          chat_id: chatId,
          text: chunk,
        });
        if (!res.ok) console.error("sendMessage failed:", res.description);
      } catch (error) {
        console.error(
          `sendMessage transport error chat=${chatId}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  /** Public notify used by background mission worker. */
  async notifyChat(chatId: number, text: string): Promise<void> {
    await this.sendMessage(chatId, text);
  }
}

export function splitTelegramText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, "");
  }
  if (rest) out.push(rest);
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFileRef(value: unknown): TelegramFileRef | undefined {
  if (!isRecord(value) || typeof value.file_id !== "string" || !value.file_id) {
    return undefined;
  }
  const ref: TelegramFileRef = { file_id: value.file_id };
  if (typeof value.file_unique_id === "string") ref.file_unique_id = value.file_unique_id;
  if (typeof value.duration === "number") ref.duration = value.duration;
  if (typeof value.mime_type === "string") ref.mime_type = value.mime_type;
  if (typeof value.file_size === "number") ref.file_size = value.file_size;
  return ref;
}

export function parseTelegramUpdate(value: unknown): TelegramUpdate | null {
  if (!isRecord(value) || !Number.isInteger(value.update_id)) return null;
  const updateId = Number(value.update_id);

  if (isRecord(value.message)) {
    const raw = value.message;
    if (
      !Number.isInteger(raw.message_id) ||
      !isRecord(raw.chat) ||
      !Number.isInteger(raw.chat.id)
    ) {
      return null;
    }
    const message: NonNullable<TelegramUpdate["message"]> = {
      message_id: Number(raw.message_id),
      chat: { id: Number(raw.chat.id) },
    };
    if (typeof raw.text === "string") message.text = raw.text;
    if (typeof raw.caption === "string") message.caption = raw.caption;
    const voice = parseFileRef(raw.voice);
    if (voice) message.voice = voice;
    const audio = parseFileRef(raw.audio);
    if (audio) {
      message.audio = {
        ...audio,
        ...(isRecord(raw.audio) && typeof raw.audio.file_name === "string"
          ? { file_name: raw.audio.file_name }
          : {}),
      };
    }
    const videoNote = parseFileRef(raw.video_note);
    if (videoNote) message.video_note = videoNote;
    return { update_id: updateId, message };
  }

  if (isRecord(value.callback_query)) {
    const raw = value.callback_query;
    if (typeof raw.id !== "string" || !raw.id) return null;
    const callback: NonNullable<TelegramUpdate["callback_query"]> = { id: raw.id };
    if (typeof raw.data === "string") callback.data = raw.data;
    if (
      isRecord(raw.message) &&
      isRecord(raw.message.chat) &&
      Number.isInteger(raw.message.chat.id) &&
      Number.isInteger(raw.message.message_id)
    ) {
      callback.message = {
        chat: { id: Number(raw.message.chat.id) },
        message_id: Number(raw.message.message_id),
      };
    }
    return { update_id: updateId, callback_query: callback };
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
