import { readFile, appendFile } from "node:fs/promises";
import { chatCompletion, type ModelRef } from "@heyagent/models";
import { buildSystemPrompt } from "@heyagent/identity";
import { getAuditLogPath, type SupportedLocale } from "@heyagent/shared";
import { appendMissionTurn, completeMission } from "../memory.js";
import { cleanupLine } from "../cleanup.js";
import {
  globalOrchestrator,
  globalIdempotency,
  globalTimeline,
} from "@heyagent/orchestrator";

type StatusFn = (status: "idle" | "thinking" | "working" | "done", detail?: string) => void;

/**
 * DETERMINISTIC Telegram conversation harness:
 * open once → click composer → send ONE → WAIT → read/verify → loop until goodbye.
 * Model only composes text + reads screenshots; order is code-enforced.
 */
export async function runTelegramConversation(params: {
  modelRef: ModelRef;
  identity: Parameters<typeof buildSystemPrompt>[0];
  locale?: SupportedLocale;
  contact: string;
  endPhrase: string;
  task: string;
  onStatus?: StatusFn;
  /** When set, after the first send the mission parks and waits in background. */
  missionId?: string;
  ownerChannelKey?: string;
  /** false = block in-process (tests); default true for product waits. */
  background?: boolean;
}): Promise<string> {
  const {
    modelRef,
    identity,
    contact,
    endPhrase,
    task,
    onStatus,
    missionId,
    ownerChannelKey,
    background = true,
  } = params;
  const computer = await import("@heyagent/computer");
  const idem = globalIdempotency;
  computer.resetTelegramChatState();
  idem.clearChat();

  const endLc = endPhrase.toLowerCase();
  const transcript: { role: "agent" | "them"; text: string }[] = [];
  const timeline: string[] = [];
  const log = async (s: string) => {
    timeline.push(`${new Date().toISOString()} ${s}`);
    await globalTimeline.push({ kind: "step", name: "telegram", detail: s });
  };

  const persona = buildSystemPrompt(identity, params.locale);
  const composeSystem = params.locale === "en"
    ? [
        persona,
        `You are having a live Telegram conversation with "${contact}" on the owner's behalf.`,
        "Write like a real person: one short message at a time, without quotes, labels, reasoning or <think> blocks.",
        `Owner's task: "${task}". Continue until the farewell phrase "${endPhrase}" appears.`,
      ].join("\n")
    : [
    persona,
    `Ты ведёшь ЖИВОЙ диалог в Telegram с человеком по имени "${contact}" от лица владельца.`,
    "Пиши как живой человек: коротко (1–2 предложения), по-русски, без кавычек и пометок, одно сообщение за раз.",
    "БЕЗ reasoning, без <think>, без английских пояснений — только текст сообщения.",
    `Задача владельца: "${task}". Диалог идёт, пока не прозвучит прощание ("${endPhrase}").`,
  ].join("\n");

  const compose = async (kind: "first" | "reply" | "closing"): Promise<string> => {
    const dialog =
      transcript.map((t) => `${t.role === "agent" ? "Я" : contact}: ${t.text}`).join("\n") ||
      "(диалог ещё не начат)";
    const ask =
      kind === "first"
        ? `Начни разговор: поздоровайся с ${contact} и задай вопрос.`
        : kind === "closing"
          ? `${contact} попрощался. Ответь тёплым коротким прощанием.`
          : `Ответь на последнее сообщение ${contact}, поддержи беседу.`;
    const res = await chatCompletion(modelRef, [
      { role: "system", content: composeSystem },
      {
        role: "user",
        content: `Диалог:\n${dialog}\n\n${ask}\nНапиши ТОЛЬКО текст следующего сообщения.`,
      },
    ]);
    const line = cleanupLine(res.content) || "Привет!";
    if (line.length > 300 || /<think>|thinking process/i.test(line)) return "Привет!";
    return line;
  };

  let lastSeenReply = "";
  const readReply = async (ourLast: string): Promise<string | null> => {
    const waitRes = await computer.telegramWaitForReply(contact, { maxWaitSeconds: 45 });
    const path = waitRes.match(/VISION_PATH=(.+)$/m)?.[1]?.trim().split(/\s+/)[0];
    if (!path) return null;
    let buf: Buffer;
    try {
      buf = await readFile(path);
    } catch {
      return null;
    }
    const res = await chatCompletion(modelRef, [
      {
        role: "system",
        content: [
          "Ты читаешь скриншот чата Telegram Desktop.",
          `Сообщения справа — НАШИ. Слева — сообщения собеседника "${contact}".`,
        ].join("\n"),
      },
      {
        role: "user",
        content: `Наше последнее сообщение: "${ourLast}". Верни ТОЛЬКО новое последнее сообщение от ${contact} (после нашего). Если нового нет — верни ровно NONE.`,
        images: [{ mimeType: "image/jpeg", data: buf.toString("base64"), detail: "high" }],
      },
    ]);
    const text = cleanupLine(res.content);
    if (!text || /^none$/i.test(text)) return null;
    if (text.toLowerCase() === lastSeenReply.toLowerCase()) return null;
    if (text.toLowerCase() === ourLast.toLowerCase()) return null;
    lastSeenReply = text;
    await globalOrchestrator.verifyStep("n/a", "reply_received", {
      lastSeenReply: text,
      lastSentMessage: ourLast,
    });
    return text;
  };

  onStatus?.("working", "telegram.open");
  if (!idem.isChatOpen(contact)) {
    await computer.openTelegramChat(contact);
    idem.markChatOpen(contact);
  } else {
    await log(`chat already open (${contact}) — no search`);
  }
  await computer.clickTelegramComposer();
  await globalOrchestrator.verifyStep("n/a", "composer_focused", {
    expectedContact: contact,
  });

  const maxTurns = 16;
  const overallDeadline = Date.now() + 30 * 60 * 1000;
  const silenceBudgetMs = 8 * 60 * 1000;

  let myMsg = await compose("first");
  for (let turn = 0; turn < maxTurns && Date.now() < overallDeadline; turn++) {
    if (!idem.canSend(contact, myMsg)) {
      await log(`SKIP duplicate send: ${myMsg}`);
    } else {
      onStatus?.("working", "telegram.message");
      await computer.telegramSendUi(contact, myMsg);
      idem.recordSend(contact, myMsg);
      transcript.push({ role: "agent", text: myMsg });
      await appendMissionTurn("agent", myMsg);
      await log(`sent: ${myMsg}`);
      await globalOrchestrator.verifyStep("n/a", "message_sent", {
        lastSentMessage: myMsg,
      });
    }
    if (myMsg.toLowerCase().includes(endLc)) break;

    // Product mode: park and wait for hours via gateway background worker
    // instead of blocking this request (which would time out / spam).
    if (background && missionId && turn === 0) {
      const { parkConversationWait } = await import("./background.js");
      await parkConversationWait({
        missionId,
        contact,
        endPhrase,
        lastSent: myMsg,
        transcript,
        ownerChannelKey,
      });
      await persistTimeline(contact, timeline);
      return [
        `Написал ${contact}: «${myMsg}».`,
        `Жду ответ в фоне — хоть часами. Как только ${contact} ответит, сам продолжу диалог до «${endPhrase}» и сообщу тебе.`,
        `Скажи «стоп», если нужно прервать.`,
      ].join("\n");
    }

    onStatus?.("working", "telegram.wait_reply");
    let reply: string | null = null;
    const waitUntil = Math.min(Date.now() + silenceBudgetMs, overallDeadline);
    while (Date.now() < waitUntil && !reply) {
      reply = await readReply(myMsg);
    }
    if (!reply) {
      // Fall back to background park instead of giving up after 8 min
      if (missionId) {
        const { parkConversationWait } = await import("./background.js");
        await parkConversationWait({
          missionId,
          contact,
          endPhrase,
          lastSent: myMsg,
          transcript,
          ownerChannelKey,
        });
        await persistTimeline(contact, timeline);
        return [
          `Написал ${contact}: «${myMsg}». Пока тихо — перевожу ожидание в фон.`,
          `Продолжу, когда ${contact} ответит.`,
        ].join("\n");
      }
      await completeMission();
      await persistTimeline(contact, timeline);
      return [
        `Написал ${contact} и ждал ответа, но за ${Math.round(silenceBudgetMs / 60000)} мин ответа не было.`,
        `Последнее моё сообщение: «${myMsg}».`,
      ].join("\n");
    }

    transcript.push({ role: "them", text: reply });
    await appendMissionTurn("them", reply);
    await log(`got: ${reply}`);

    if (reply.toLowerCase().includes(endLc)) {
      const bye = await compose("closing");
      if (idem.canSend(contact, bye)) {
        onStatus?.("working", "telegram.message");
        await computer.telegramSendUi(contact, bye);
        idem.recordSend(contact, bye);
      }
      transcript.push({ role: "agent", text: bye });
      await appendMissionTurn("agent", bye);
      break;
    }
    myMsg = await compose("reply");
  }

  await completeMission();
  await persistTimeline(contact, timeline);
  const lines = transcript.map((t) => `${t.role === "agent" ? "Я" : contact}: ${t.text}`);
  return [
    `Поговорил с ${contact} в Telegram (${transcript.length} реплик), закончил по «${endPhrase}».`,
    "",
    ...lines,
  ].join("\n");
}

/** One-shot: open chat (if needed) → composer → send once. No spam loop. */
export async function runTelegramOneShot(params: {
  modelRef: ModelRef;
  identity: Parameters<typeof buildSystemPrompt>[0];
  locale?: SupportedLocale;
  contact: string;
  task: string;
  onStatus?: StatusFn;
}): Promise<string> {
  const { modelRef, identity, contact, task, onStatus } = params;
  const computer = await import("@heyagent/computer");
  const idem = globalIdempotency;

  onStatus?.("working", "telegram.open");
  if (!idem.isChatOpen(contact)) {
    await computer.openTelegramChat(contact);
    idem.markChatOpen(contact);
  }
  await computer.clickTelegramComposer();

  const persona = buildSystemPrompt(identity, params.locale);
  const res = await chatCompletion(modelRef, [
    {
      role: "system",
      content: [
        persona,
        `Напиши ОДНО короткое сообщение для ${contact} в Telegram от лица владельца.`,
        `Задача: "${task}".`,
        "СТРОГО: только текст сообщения (1–2 предложения). Без кавычек, без reasoning, без <think>, без списков, без английских пояснений.",
      ].join("\n"),
    },
    { role: "user", content: task },
  ]);
  const msg = cleanupLine(res.content) || "Привет!";
  if (msg.length > 300 || /<think>|thinking process|analyze user/i.test(msg)) {
    return `ERROR: модель выдала мусор вместо сообщения — не отправляю в Telegram.`;
  }

  if (!idem.canSend(contact, msg)) {
    return `Уже недавно отправлял «${msg}» — не спамлю.`;
  }
  onStatus?.("working", "telegram.message");
  await computer.telegramSendUi(contact, msg);
  idem.recordSend(contact, msg);
  await appendMissionTurn("agent", msg).catch(() => undefined);
  return `Отправил ${contact} в Telegram: «${msg}»`;
}

async function persistTimeline(contact: string, timeline: string[]): Promise<void> {
  try {
    await appendFile(
      getAuditLogPath(),
      JSON.stringify({
        kind: "mission.timeline",
        mission: `telegram:${contact}`,
        timeline,
        ts: new Date().toISOString(),
      }) + "\n",
      "utf-8",
    );
  } catch {
    /* best-effort */
  }
}
