/**
 * Background mission worker — continues chat-until waits for hours without
 * blocking the agent's HTTP/Telegram request loop.
 */
import { readFile } from "node:fs/promises";
import { chatCompletion, resolveDefaultModel, type ModelRef } from "@heyagent/models";
import { loadConfig } from "@heyagent/shared";
import {
  globalMissionQueue,
  globalTimeline,
  persistMissionQueue,
  listWaitingMissions,
} from "@heyagent/orchestrator";
import { appendMissionTurn, completeMission } from "../memory.js";
import { cleanupLine } from "../cleanup.js";

export type BackgroundNotify = (chatKey: string, text: string) => Promise<void>;

let running = false;
let notifyFn: BackgroundNotify | null = null;
let modelRef: ModelRef | null = null;

export function setBackgroundNotify(fn: BackgroundNotify): void {
  notifyFn = fn;
}

/**
 * Park an active chat-until mission into waiting state after the first outbound
 * message, so the gateway worker can poll for replies for hours.
 */
export async function parkConversationWait(params: {
  missionId: string;
  contact: string;
  endPhrase: string;
  lastSent: string;
  transcript: { role: "agent" | "them"; text: string }[];
  ownerChannelKey?: string;
}): Promise<void> {
  globalMissionQueue.update(params.missionId, {
    status: "waiting",
    kind: "background_wait",
    checkpoint: {
      planStepIndex: 0,
      lastSentMessage: params.lastSent,
      lastSeenReply: undefined,
      transcript: params.transcript.map((t) => ({
        ...t,
        at: new Date().toISOString(),
      })),
      extra: {
        contact: params.contact,
        endPhrase: params.endPhrase,
        ownerChannelKey: params.ownerChannelKey ?? "",
      },
    },
  });
  await persistMissionQueue();
  await globalTimeline.push({
    kind: "status",
    name: "park_wait",
    detail: `waiting for ${params.contact}`,
    missionId: params.missionId,
  });
}

/** One tick: poll waiting Telegram missions for new replies. */
export async function tickBackgroundMissions(): Promise<void> {
  if (running) return;
  running = true;
  try {
    if (!modelRef) {
      const cfg = await loadConfig();
      modelRef = resolveDefaultModel(cfg.models ?? {});
    }
    const waiting = await listWaitingMissions();
    for (const mission of waiting) {
      if (mission.domain !== "messaging" && mission.kind !== "background_wait") continue;
      const contact = String(mission.checkpoint.extra?.contact ?? mission.plan.goal);
      const endPhrase = String(mission.checkpoint.extra?.endPhrase ?? "до свидания");
      const lastSent = mission.checkpoint.lastSentMessage ?? "";
      const ownerKey = String(mission.checkpoint.extra?.ownerChannelKey ?? "");
      if (!contact) continue;

      try {
        const computer = await import("@heyagent/computer");
        const waitRes = await computer.telegramWaitForReply(contact, {
          maxWaitSeconds: 25,
          pollSeconds: 5,
        });
        if (/No visible reply/i.test(waitRes)) continue;

        const path = waitRes.match(/VISION_PATH=(.+)$/m)?.[1]?.trim().split(/\s+/)[0];
        if (!path) continue;
        let buf: Buffer;
        try {
          buf = await readFile(path);
        } catch {
          continue;
        }

        const res = await chatCompletion(modelRef, [
          {
            role: "system",
            content: `Читаешь скриншот Telegram. Справа — наши сообщения, слева — ${contact}.`,
          },
          {
            role: "user",
            content: `Наше последнее: "${lastSent}". Верни ТОЛЬКО новое сообщение от ${contact} или NONE.`,
            images: [{ mimeType: "image/jpeg", data: buf.toString("base64"), detail: "high" }],
          },
        ]);
        const reply = cleanupLine(res.content);
        if (!reply || /^none$/i.test(reply)) continue;
        if (reply.toLowerCase() === (mission.checkpoint.lastSeenReply ?? "").toLowerCase()) {
          continue;
        }

        // Compose a reply and send once
        const transcript = mission.checkpoint.transcript ?? [];
        transcript.push({ role: "them", text: reply, at: new Date().toISOString() });
        await appendMissionTurn("them", reply);

        const endLc = endPhrase.toLowerCase();
        const closing = reply.toLowerCase().includes(endLc);
        const compose = await chatCompletion(modelRef, [
          {
            role: "system",
            content: closing
              ? `Попрощайся коротко с ${contact} по-русски. Только текст.`
              : `Ответь ${contact} коротко по-русски на: «${reply}». Только текст сообщения.`,
          },
          { role: "user", content: reply },
        ]);
        const out = cleanupLine(compose.content) || (closing ? "Пока!" : "Ок");
        await computer.telegramSendUi(contact, out);
        transcript.push({ role: "agent", text: out, at: new Date().toISOString() });
        await appendMissionTurn("agent", out);

        if (closing || out.toLowerCase().includes(endLc)) {
          await completeMission();
          globalMissionQueue.update(mission.id, { status: "done", checkpoint: { ...mission.checkpoint, transcript, lastSeenReply: reply, lastSentMessage: out } });
          await notifyFn?.(
            ownerKey,
            `✅ Диалог с ${contact} завершён.\nОн: ${reply}\nЯ: ${out}`,
          );
        } else {
          globalMissionQueue.update(mission.id, {
            status: "waiting",
            checkpoint: {
              ...mission.checkpoint,
              transcript,
              lastSeenReply: reply,
              lastSentMessage: out,
            },
          });
          await notifyFn?.(
            ownerKey,
            `💬 ${contact}: ${reply}\n→ ответил: ${out}\n(продолжаю ждать дальше)`,
          );
        }
        await persistMissionQueue();
      } catch (err) {
        await globalTimeline.push({
          kind: "error",
          name: "background_tick",
          detail: err instanceof Error ? err.message : String(err),
          missionId: mission.id,
        });
      }
    }
  } finally {
    running = false;
  }
}

export function startBackgroundWorker(intervalMs = 20_000): NodeJS.Timeout {
  void tickBackgroundMissions();
  return setInterval(() => {
    void tickBackgroundMissions();
  }, intervalMs);
}
