/**
 * Run a matched deterministic harness. Returns null → fall through to LLM loop.
 */
import type { AgentIdentity } from "@heyagent/identity";
import type { ModelRef } from "@heyagent/models";
import type { AgentSession, SupportedLocale } from "@heyagent/shared";
import type { OrchestrateResult } from "@heyagent/orchestrator";
import { globalOrchestrator } from "@heyagent/orchestrator";
import { IntegrationsHub } from "@heyagent/integrations";
import { addMessage } from "../session.js";
import {
  rememberAction,
  startChatMission,
  cancelMission,
  setLastNotepad,
} from "../memory.js";
import { runTelegramConversation, runTelegramOneShot } from "./telegram.js";
import { runOpenTabTask } from "./open-tab.js";
import { runNotepadCompose } from "./notepad-compose.js";
import { cronSchedule } from "../cron.js";
import { detectMailIntent, detectPreferredBrowser } from "./intents.js";
import { recordHarnessRun } from "./metrics.js";
import type { HarnessMatch } from "./match.js";
import type { AgentRunOptions, AgentRunResult } from "../run-types.js";

export interface HarnessExecContext {
  userMessage: string;
  workingMessage: string;
  rereadPrefix: string;
  session: AgentSession;
  identity: AgentIdentity;
  modelRef: ModelRef;
  orch: OrchestrateResult;
  options: AgentRunOptions;
  locale?: SupportedLocale;
  timezone?: string;
}

function withPrefix(prefix: string, body: string): string {
  return prefix ? `${prefix}\n\n${body}` : body;
}

/** Harnesses that may fall through to llm_loop on ERROR (not Telegram chat-until). */
function shouldFallThroughHarness(id: HarnessMatch["id"]): boolean {
  return (
    id !== "telegram_conversation" &&
    id !== "telegram_one_shot" &&
    id !== "cancel" &&
    id !== "clock.now" &&
    id !== "cron.schedule" &&
    // Docs uses the Workspace API. Falling back to screen automation after an
    // API error hides the real cause and creates a useless screen.see loop.
    id !== "docs.compose" &&
    // News digest already wrote a file — never discard for openPath / "PDF failed" wording
    id !== "research.digest"
  );
}

/** True success: avoid false FAIL on «PDF failed → HTML written». */
function harnessSucceeded(id: HarnessMatch["id"], response: string): boolean {
  if (id === "research.digest") {
    if (/\bpath:\s*\S+/i.test(response) || /Report PDF written|HTML written|Дайджест:|DONE:/i.test(response)) {
      return !/^ERROR:/m.test(response.trim());
    }
  }
  // Hard failures only — do not match substring "failed" inside success notes
  if (/^ERROR:|LOOP_BREAK|Stopped by/im.test(response)) return false;
  if (/\bERROR:\s/i.test(response) && !/\bDONE:/i.test(response)) return false;
  return true;
}

export async function executeHarness(
  match: HarnessMatch,
  ctx: HarnessExecContext,
): Promise<AgentRunResult | null> {
  if (match.id === "llm_loop") return null;
  if (match.id === "cancel") {
    const { browserHardStop, resetTelegramChatState } = await import("@heyagent/computer");
    await browserHardStop().catch(() => undefined);
    resetTelegramChatState();
    await cancelMission();
    globalOrchestrator.getQueue().cancel();
    return null; // continue with remaining instruction via LLM if any
  }

  // Every UI harness participates in the same single-flight queue.  A number
  // of deterministic harnesses used to call the desktop directly while their
  // mission was still queued, allowing two UI missions to overlap.
  if (ctx.orch.mission.requiresUi && !ensureMissionClaimed(ctx.orch.mission.id)) {
    const response = "Сейчас уже идёт другая UI-миссия. Подожди или скажи «стоп», потом повтори.";
    await addMessage(ctx.session, { role: "user", content: ctx.userMessage });
    await addMessage(ctx.session, { role: "assistant", content: response });
    ctx.options.onStatus?.("done");
    return { sessionId: ctx.session.id, response, toolCallsExecuted: ["orchestrator.queue"] };
  }

  const t0 = Date.now();
  try {
    const result = await runMatched(match, ctx);
    if (result) {
      const ok = harnessSucceeded(match.id, result.response);
      await recordHarnessRun(match.id, ok, Date.now() - t0).catch(() => undefined);
      // Harness failed → fall through to llm_loop with full toolset
      if (!ok && shouldFallThroughHarness(match.id)) {
        return null;
      }
      // Preserve a waiting chat mission; all other successful deterministic
      // harnesses have their own concrete tool evidence in `result`.
      const queued = globalOrchestrator.getQueue().get(ctx.orch.mission.id);
      if (ok && queued?.status !== "waiting") {
        globalOrchestrator.getQueue().update(ctx.orch.mission.id, { status: "done" });
        if (match.id !== "mission.wait_owner" && match.id !== "mission.replay") {
          void import("../mission-history.js")
            .then(({ recordMissionSuccess }) =>
              recordMissionSuccess({
                goal: ctx.userMessage,
                harness: match.id,
                tools: result.toolCallsExecuted,
                summary: result.response,
              }),
            )
            .catch(() => undefined);
        }
      }
    }
    return result;
  } catch (err) {
    await recordHarnessRun(
      match.id,
      false,
      Date.now() - t0,
      err instanceof Error ? err.message : String(err),
    ).catch(() => undefined);
    throw err;
  }
}

function ensureMissionClaimed(missionId: string): boolean {
  const queue = globalOrchestrator.getQueue();
  const mission = queue.get(missionId);
  if (mission?.status === "running") return true;
  return Boolean(queue.tryClaim(missionId));
}

async function runMatched(
  match: HarnessMatch,
  ctx: HarnessExecContext,
): Promise<AgentRunResult | null> {
  const {
    userMessage,
    workingMessage,
    rereadPrefix,
    session,
    identity,
    modelRef,
    orch,
    options,
    locale = "ru",
  } = ctx;

  if (match.id === "clock.now") {
    const { formatClockForHumans, getClockSnapshot } = await import("@heyagent/computer");
    await addMessage(session, { role: "user", content: userMessage });
    const response = formatClockForHumans(getClockSnapshot(ctx.timezone));
    await addMessage(session, { role: "assistant", content: response });
    options.onStatus?.("done");
    return { sessionId: session.id, response, toolCallsExecuted: ["clock.now"] };
  }

  if (match.id === "cron.schedule") {
    const cron = match.meta.cron as {
      name: string;
      prompt: string;
      everyMinutes: number;
      daily?: { hourLocal: number; minuteLocal: number };
    };
    await addMessage(session, { role: "user", content: userMessage });
    options.onStatus?.("working", "cron.schedule");
    const response = await cronSchedule(
      cron.name,
      cron.prompt,
      cron.everyMinutes,
      cron.daily,
    );
    const out = withPrefix(rereadPrefix, response);
    await rememberAction("cron.schedule", out.slice(0, 400));
    await addMessage(session, { role: "assistant", content: out });
    options.onStatus?.("done");
    return { sessionId: session.id, response: out, toolCallsExecuted: ["cron.schedule"] };
  }

  if (match.id === "mission.replay") {
    const { pickReplayGoal } = await import("../mission-history.js");
    await addMessage(session, { role: "user", content: userMessage });
    const entry = await pickReplayGoal(true);
    if (!entry) {
      const msg = "История миссий пуста — сначала выполни задачу успешно.";
      await addMessage(session, { role: "assistant", content: msg });
      options.onStatus?.("done");
      return { sessionId: session.id, response: msg, toolCallsExecuted: ["mission.replay"] };
    }
    const replayGoal = `[REPLAY] ${entry.goal}`;
    options.onStatus?.("working", "mission.replay");
    // Fall through to llm_loop / re-run by returning null after noting — better: recursive via null
    await addMessage(session, {
      role: "assistant",
      content: `Повторяю задачу от ${entry.at.slice(0, 16)}:\n«${entry.goal}»`,
    });
    // Re-enter runtime by executing as clarified goal through llm_loop path
    const { AgentRuntime } = await import("../index.js");
    const runtime = new AgentRuntime();
    const nested = await runtime.run(replayGoal, {
      sessionId: session.id,
      channel: options.channel,
      channelKey: options.channelKey,
      modelRef,
      onStatus: options.onStatus,
      onApprovalNeeded: options.onApprovalNeeded,
    });
    const out = withPrefix(rereadPrefix, nested.response);
    options.onStatus?.("done");
    return {
      sessionId: nested.sessionId,
      response: out,
      toolCallsExecuted: ["mission.replay", ...(nested.toolCallsExecuted || [])],
    };
  }

  if (match.id === "mission.wait_owner") {
    const { parkWaitingOwner } = await import("../waiting-owner.js");
    await addMessage(session, { role: "user", content: userMessage });
    const planSummary = String(match.meta.topic || userMessage).slice(0, 200);
    const chatKey = options.channelKey || "";
    const chatId = Number(chatKey.replace(/^telegram:/, "")) || 0;
    if (!chatId) {
      const msg =
        "Пауза до ответа владельца работает из Telegram-бота. Напиши боту: «подожди мой ответ».";
      await addMessage(session, { role: "assistant", content: msg });
      options.onStatus?.("done");
      return { sessionId: session.id, response: msg, toolCallsExecuted: ["mission.wait_owner"] };
    }
    await parkWaitingOwner(
      chatId,
      "[RESUME after owner pause] Продолжи задачу после ответа владельца.",
      planSummary,
    );
    globalOrchestrator.getQueue().update(orch.mission.id, { status: "waiting" });
    const msg =
      "⏸ Жду твоё следующее сообщение в Telegram — потом продолжу.\nНапиши, когда будешь готов.";
    await addMessage(session, { role: "assistant", content: msg });
    options.onStatus?.("done");
    return { sessionId: session.id, response: msg, toolCallsExecuted: ["mission.wait_owner"] };
  }

  if (match.id === "briefing.compose") {
    const { runBriefingCompose } = await import("./briefing.js");
    await addMessage(session, { role: "user", content: userMessage });
    options.onStatus?.("working", "briefing.compose");
    const brief = await runBriefingCompose({
      topic: String(match.meta.topic || workingMessage || userMessage),
      modelRef,
      onStatus: options.onStatus,
    });
    const out = withPrefix(rereadPrefix, brief.summary);
    await rememberAction("briefing.compose", out.slice(0, 500));
    try {
      const { recordMissionSuccess } = await import("../mission-history.js");
      await recordMissionSuccess({
        goal: userMessage,
        harness: "briefing.compose",
        tools: ["briefing.compose", "report.write"],
        summary: out,
      });
    } catch {
      /* ignore */
    }
    await addMessage(session, { role: "assistant", content: out });
    options.onStatus?.("done");
    return {
      sessionId: session.id,
      response: out,
      toolCallsExecuted: ["briefing.compose", "report.write"],
    };
  }

  if (match.id === "telegram_conversation" || match.id === "telegram_one_shot") {
    const claimed = ensureMissionClaimed(orch.mission.id);
    if (!claimed) {
      const msg =
        "Сейчас уже идёт другая UI-миссия. Подожди или скажи «стоп», потом повтори.";
      await addMessage(session, { role: "user", content: userMessage });
      await addMessage(session, { role: "assistant", content: msg });
      options.onStatus?.("done");
      return { sessionId: session.id, response: msg, toolCallsExecuted: ["orchestrator.queue"] };
    }
    await addMessage(session, { role: "user", content: userMessage });
    const contact = String(match.meta.contact || "").trim();
    if (!contact || contact.length < 2 || /^(н|на|контакт)$/i.test(contact)) {
      const msg =
        "Не понял, кому писать в Telegram. Для теста в браузере напиши «пройди тест» — Telegram не открою.";
      await addMessage(session, { role: "assistant", content: msg });
      globalOrchestrator.getQueue().update(orch.mission.id, { status: "done" });
      options.onStatus?.("done");
      return {
        sessionId: session.id,
        response: msg,
        toolCallsExecuted: ["orchestrator.telegram_guard"],
      };
    }
    const endPhrase = String(match.meta.endPhrase || "до свидания");
    await startChatMission(contact, endPhrase);
    const response =
      match.id === "telegram_conversation"
        ? await runTelegramConversation({
            modelRef,
            identity,
            locale,
            contact,
            endPhrase,
            task: userMessage,
            missionId: orch.mission.id,
            ownerChannelKey: options.channelKey,
            background: true,
            onStatus: (s, d) => {
              options.onStatus?.(s, d);
              if (s === "working" && d === "telegram.wait_reply") {
                options.onStatus?.("working", `жду ответ ${contact}…`);
              }
            },
          })
        : await runTelegramOneShot({
            modelRef,
            identity,
            locale,
            contact,
            task: userMessage,
            onStatus: options.onStatus,
          });
    const out = withPrefix(rereadPrefix, response);
    await rememberAction("telegram.harness", out.slice(0, 500));
    await globalOrchestrator.noteEpisode(
      userMessage,
      "messaging",
      match.id,
      /ERROR|fail/i.test(out) ? "fail" : "success",
      /ERROR/i.test(out)
        ? "Wait longer / verify composer focus before send"
        : "Deterministic send→wait harness OK",
    );
    const stillWaiting = /жду ответ в фоне|перевожу ожидание в фон/i.test(out);
    if (!stillWaiting) {
      globalOrchestrator.getQueue().update(orch.mission.id, { status: "done" });
    }
    await addMessage(session, { role: "assistant", content: out });
    options.onStatus?.("done");
    return {
      sessionId: session.id,
      response: out,
      toolCallsExecuted: [`orchestrator.${match.id}`],
    };
  }

  if (match.id === "open_tab") {
    const claimed = ensureMissionClaimed(orch.mission.id);
    if (!claimed) {
      const msg =
        "Сейчас уже идёт другая UI-миссия. Подожди или скажи «стоп», потом повтори.";
      await addMessage(session, { role: "user", content: userMessage });
      await addMessage(session, { role: "assistant", content: msg });
      options.onStatus?.("done");
      return { sessionId: session.id, response: msg, toolCallsExecuted: ["orchestrator.queue"] };
    }
    await addMessage(session, { role: "user", content: userMessage });
    const rawBrowser = String(match.meta.browser || "auto").toLowerCase();
    type PrefBrowser = "auto" | "yandex" | "chrome" | "edge";
    let preferredBrowser: PrefBrowser =
      rawBrowser === "yandex" || rawBrowser === "chrome" || rawBrowser === "edge"
        ? rawBrowser
        : "auto";
    let tabQuery = match.meta.tabQuery as string | undefined;
    if (match.meta.quizContinue === "1" || !tabQuery || tabQuery === "тест") {
      try {
        const { loadLastQuiz } = await import("./quiz-memory.js");
        const last = await loadLastQuiz();
        if (last) {
          if (last.tabQuery) tabQuery = last.tabQuery;
          if (last.browser === "yandex" || last.browser === "chrome" || last.browser === "edge") {
            preferredBrowser = last.browser;
          }
        }
      } catch {
        /* ignore */
      }
    }
    const response = await runOpenTabTask({
      modelRef,
      identity,
      locale,
      task: userMessage,
      tabQuery,
      preferredBrowser,
      onStatus: options.onStatus,
      maxQuestions: 40,
    });
    const out = withPrefix(rereadPrefix, response);
    await rememberAction("browser.open_tab", out.slice(0, 500));
    await globalOrchestrator.noteEpisode(
      userMessage,
      "browser",
      "open_tab",
      /ERROR/i.test(out) ? "fail" : "success",
      /ERROR/i.test(out)
        ? "List all CDP tabs and match title/URL before any browser.open"
        : "Focused existing tab via CDP list+score",
    );
    globalOrchestrator.getQueue().update(orch.mission.id, { status: "done" });
    await addMessage(session, { role: "assistant", content: out });
    options.onStatus?.("done");
    return {
      sessionId: session.id,
      response: out,
      toolCallsExecuted: ["orchestrator.open_tab"],
    };
  }

  if (match.id === "youtube.open.lesson") {
    const { youtubeOpenLessonMission } = await import("@heyagent/computer");
    await addMessage(session, { role: "user", content: userMessage });
    options.onStatus?.("working", "youtube.open.lesson");
    const preferred = detectPreferredBrowser(workingMessage + " " + userMessage);
    const mode = (match.meta.mode as "quick" | "deep") || "quick";
    const response = await youtubeOpenLessonMission({
      query: String(match.meta.query || ""),
      browser: preferred === "auto" ? "yandex" : preferred,
      mode,
      rawUserText: userMessage,
      skipTop: 0,
      minMinutes: mode === "quick" ? 0 : undefined,
    });
    const out = withPrefix(rereadPrefix, response);
    await rememberAction("youtube.open.lesson", out.slice(0, 500));
    await addMessage(session, { role: "assistant", content: out });
    options.onStatus?.("done");
    return {
      sessionId: session.id,
      response: out,
      toolCallsExecuted: ["youtube.open.lesson"],
    };
  }

  if (match.id === "github.browse.mission") {
    const github = match.meta.github as { repo: string; browser: "yandex" | "chrome" | "edge" | "auto" };
    await addMessage(session, { role: "user", content: userMessage });
    options.onStatus?.("working", "github.browse.mission");
    const { githubBrowseMission } = await import("@heyagent/computer");
    const response = await githubBrowseMission({
      repo: github.repo,
      browser: github.browser,
      openBrowser: true,
    });
    const out = withPrefix(rereadPrefix, response);
    await rememberAction("github.browse.mission", out.slice(0, 500));
    await addMessage(session, { role: "assistant", content: out });
    options.onStatus?.("done");
    return {
      sessionId: session.id,
      response: out,
      toolCallsExecuted: ["github.browse.mission"],
    };
  }

  if (match.id === "hard_browser") {
    const hard = match.meta.hard as {
      kind: string;
      hops?: number;
      query?: string;
      browser: "yandex" | "chrome" | "edge" | "auto";
    };
    await addMessage(session, { role: "user", content: userMessage });
    const computer = await import("@heyagent/computer");
    let response = "";
    let tool = "hard_browser";
    if (hard.kind === "stop") {
      options.onStatus?.("working", "browser.mission.stop");
      response = await computer.browserHardStop();
      tool = "browser.mission.stop";
    } else if (hard.kind === "wikipedia") {
      options.onStatus?.("working", "browser.wikipedia.hops");
      response = await computer.wikipediaHopMission({
        hops: hard.hops,
        browser: hard.browser,
      });
      tool = "browser.wikipedia.hops";
    } else if (hard.kind === "reddit") {
      options.onStatus?.("working", "browser.reddit.scroll");
      response = await computer.redditOpenAiScrollMission({ browser: hard.browser });
      tool = "browser.reddit.scroll";
    } else if (hard.kind === "multitab") {
      options.onStatus?.("working", "browser.tabs.compare");
      response = await computer.multiTabCompareMission({
        query: hard.query,
        browser: hard.browser,
      });
      tool = "browser.tabs.compare";
    } else if (hard.kind === "selected") {
      response = await computer.browserWhatIsSelected(hard.browser);
      tool = "browser.what_selected";
    } else if (hard.kind === "recover") {
      response = await computer.browserHardRecover(hard.browser);
      tool = "browser.mission.recover";
    } else {
      return null;
    }
    await rememberAction(tool, response.slice(0, 500));
    await addMessage(session, { role: "assistant", content: response });
    options.onStatus?.("done");
    return { sessionId: session.id, response, toolCallsExecuted: [tool] };
  }

  if (match.id === "system.control") {
    const { systemControl, validateSystemControlParams } =
      await import("@heyagent/computer");
    const parsed = validateSystemControlParams(match.meta.sys);
    if (!parsed.ok) {
      const detail = `system.control: invalid or unrecognized command (${parsed.reason})`;
      console.warn("Unable to parse system.control command", {
        input: (workingMessage || userMessage).slice(0, 240),
        reason: parsed.reason,
      });
      options.onStatus?.("error", detail);
      // The deterministic system harness did not handle this input. Returning
      // null lets the normal LLM/tool route try another suitable handler.
      return null;
    }
    const sys = parsed.value;
    await addMessage(session, { role: "user", content: userMessage });
    options.onStatus?.("working", `system.control:${sys.action}`);
    const response = await systemControl(sys);
    const out = withPrefix(rereadPrefix, response);
    await rememberAction(`system.control:${sys.action}`, out.slice(0, 400));
    await addMessage(session, { role: "assistant", content: out });
    options.onStatus?.("done");
    return {
      sessionId: session.id,
      response: out,
      toolCallsExecuted: [`system.control:${sys.action}`],
    };
  }

  if (match.id === "system.empty_recycle_bin") {
    await addMessage(session, { role: "user", content: userMessage });
    options.onStatus?.("working", "system.empty_recycle_bin");
    const { emptyRecycleBin } = await import("@heyagent/computer");
    const response = await emptyRecycleBin();
    const out = withPrefix(rereadPrefix, response);
    await rememberAction("system.empty_recycle_bin", out.slice(0, 400));
    await addMessage(session, { role: "assistant", content: out });
    options.onStatus?.("done");
    return {
      sessionId: session.id,
      response: out,
      toolCallsExecuted: ["system.empty_recycle_bin"],
    };
  }

  if (match.id === "app.install") {
    const { runAppInstall } = await import("./app-install.js");
    await addMessage(session, { role: "user", content: userMessage });
    options.onStatus?.("working", "app.install");
    const installed = await runAppInstall({
      userText: workingMessage || userMessage,
      onStatus: options.onStatus,
    });
    const out = withPrefix(rereadPrefix, installed.summary);
    await rememberAction("app.install", out.slice(0, 500));
    await addMessage(session, { role: "assistant", content: out });
    options.onStatus?.("done");
    return {
      sessionId: session.id,
      response: out,
      toolCallsExecuted: ["app.search", "app.install"],
    };
  }

  if (match.id === "notepad.compose") {
    const note = match.meta.note as Parameters<typeof runNotepadCompose>[0]["intent"];
    await addMessage(session, { role: "user", content: userMessage });
    options.onStatus?.("working", "notepad.compose");
    const composed = await runNotepadCompose({
      text: userMessage,
      modelRef,
      intent: note ?? undefined,
    });
    const out = withPrefix(rereadPrefix, composed.summary);
    await rememberAction("notepad.compose", out.slice(0, 500));
    try {
      const pathMatch = composed.summary.match(/path:\s*(.+?)\s*(?:\(|$)/i);
      if (pathMatch && composed.content) {
        await setLastNotepad(pathMatch[1].trim(), composed.content);
      }
    } catch {
      /* ignore */
    }
    await addMessage(session, { role: "assistant", content: out });
    options.onStatus?.("done");
    return {
      sessionId: session.id,
      response: out,
      toolCallsExecuted: ["notepad.compose"],
    };
  }

  if (match.id === "docs.compose") {
    const { runDocsCompose } = await import("./docs-compose.js");
    await addMessage(session, { role: "user", content: userMessage });
    options.onStatus?.("working", "docs.compose");
    const composed = await runDocsCompose({
      userText: workingMessage || userMessage,
      modelRef,
      onStatus: options.onStatus,
    });
    const out = withPrefix(rereadPrefix, composed.summary);
    await rememberAction("docs.compose", out.slice(0, 500));
    await addMessage(session, { role: "assistant", content: out });
    options.onStatus?.("done");
    return {
      sessionId: session.id,
      response: out,
      toolCallsExecuted: ["docs.compose", "google.docs.write"],
    };
  }

  if (match.id === "research.digest") {
    const { runResearchDigest, extractDigestTopic } = await import("./research-digest.js");
    await addMessage(session, { role: "user", content: userMessage });
    options.onStatus?.("working", "research.digest");
    const topic = extractDigestTopic(
      String(match.meta.topic || workingMessage || userMessage),
    );
    const dig = await runResearchDigest({
      topic,
      modelRef,
      onStatus: options.onStatus,
    });
    const out = withPrefix(rereadPrefix, dig.summary);
    await rememberAction("research.digest", out.slice(0, 500));
    await addMessage(session, { role: "assistant", content: out });
    options.onStatus?.("done");
    return {
      sessionId: session.id,
      response: out,
      toolCallsExecuted: ["research.digest", "web.search", "report.write"],
    };
  }

  if (match.id === "presentation.create") {
    await addMessage(session, { role: "user", content: userMessage });
    options.onStatus?.("working", "presentation.create");
    const { createPresentationDeck } = await import("@heyagent/computer");
    const { chatCompletion } = await import("@heyagent/models");
    const topic = String(match.meta.topic || userMessage);
    let slides: { title: string; bullets?: string[] }[] = [
      { title: topic.slice(0, 80), bullets: ["Введение", "Ключевые тезисы", "Выводы"] },
    ];
    try {
      const res = await chatCompletion(
        modelRef,
        [
          {
            role: "system",
            content:
              'Make a short presentation outline. STRICT JSON: {"title":"...","slides":[{"title":"...","bullets":["..."]}]} — 5-8 slides, Russian.',
          },
          { role: "user", content: topic },
        ],
        { maxTokens: 1200, toolChoice: "none", useDefaultFallbacks: true },
      );
      const m = (res.content || "").match(/\{[\s\S]*\}/);
      if (m) {
        const parsed = JSON.parse(m[0]) as {
          title?: string;
          slides?: { title?: string; bullets?: string[] }[];
        };
        if (Array.isArray(parsed.slides) && parsed.slides.length) {
          slides = parsed.slides.map((s) => ({
            title: String(s.title || "Slide"),
            bullets: Array.isArray(s.bullets) ? s.bullets.map(String) : [],
          }));
        }
      }
    } catch {
      /* keep default */
    }
    const deck = await createPresentationDeck({
      title: topic.replace(/^(сделай|создай)\s+презентац\w*\s+(про|по)\s+/i, "").slice(0, 80) || "Presentation",
      slides,
      open: true,
    });
    const out = withPrefix(rereadPrefix, `DONE: ${deck.message}`);
    await rememberAction("presentation.create", out.slice(0, 500));
    await addMessage(session, { role: "assistant", content: out });
    options.onStatus?.("done");
    return {
      sessionId: session.id,
      response: out,
      toolCallsExecuted: ["presentation.create"],
    };
  }

  if (match.id === "desktop.office") {
    await addMessage(session, { role: "user", content: userMessage });
    options.onStatus?.("working", "desktop.office");
    const { officeWriteDocument } = await import("@heyagent/computer");
    const { chatCompletion } = await import("@heyagent/models");
    const app = String(match.meta.app || "word") as "word" | "excel" | "powerpoint" | "wordpad";
    let title = "Document";
    let content = workingMessage;
    try {
      const res = await chatCompletion(
        modelRef,
        [
          {
            role: "system",
            content:
              'Extract document title and body for an Office file. STRICT JSON: {"title":"...","content":"..."}. Russian body, substantial text.',
          },
          { role: "user", content: userMessage },
        ],
        { maxTokens: 2000, toolChoice: "none", useDefaultFallbacks: true },
      );
      const m = (res.content || "").match(/\{[\s\S]*\}/);
      if (m) {
        const parsed = JSON.parse(m[0]) as { title?: string; content?: string };
        if (parsed.title) title = String(parsed.title).slice(0, 120);
        if (parsed.content) content = String(parsed.content).slice(0, 8000);
      }
    } catch {
      /* keep */
    }
    const result = await officeWriteDocument({ app, title, content });
    const out = withPrefix(rereadPrefix, `DONE: ${result}`);
    await rememberAction("desktop.office", out.slice(0, 500));
    await addMessage(session, { role: "assistant", content: out });
    options.onStatus?.("done");
    return {
      sessionId: session.id,
      response: out,
      toolCallsExecuted: ["office.desktop.write"],
    };
  }

  if (match.id === "google.sheets" || match.id === "google.slides") {
    // Prefer tools via llm_loop with slots already set — fall through with null? 
    // Or execute directly:
    await addMessage(session, { role: "user", content: userMessage });
    options.onStatus?.("working", match.id);
    const hub = new IntegrationsHub();
    const { chatCompletion } = await import("@heyagent/models");
    if (match.id === "google.sheets") {
      let title = "Sheet";
      let rows = "A,B\n1,2";
      try {
        const res = await chatCompletion(
          modelRef,
          [
            {
              role: "system",
              content:
                'Build a polished small spreadsheet. STRICT JSON: {"title":"...","rowsCsv":"h1,h2\\nv1,v2"}. Use readable Unicode math (Δ, ψ, ≥, ℏ, ₁), never LaTeX or backslashes. First row must contain concise headers.',
            },
            { role: "user", content: userMessage },
          ],
          { maxTokens: 800, toolChoice: "none", useDefaultFallbacks: true },
        );
        const m = (res.content || "").match(/\{[\s\S]*\}/);
        if (m) {
          const p = JSON.parse(m[0]) as { title?: string; rowsCsv?: string };
          if (p.title) title = String(p.title);
          if (p.rowsCsv) rows = String(p.rowsCsv);
        }
      } catch {
        /* */
      }
      const result = await hub.googleSheetsCreate(title, rows);
      const out = withPrefix(rereadPrefix, `DONE: ${result}`);
      await addMessage(session, { role: "assistant", content: out });
      options.onStatus?.("done");
      return {
        sessionId: session.id,
        response: out,
        toolCallsExecuted: ["google.sheets.create"],
      };
    }
    let title = "Slides";
    let slidesJson = '[{"title":"Intro","bullets":["Point 1"]}]';
    try {
      const res = await chatCompletion(
        modelRef,
        [
          {
            role: "system",
            content:
              'Google Slides outline. STRICT JSON: {"title":"...","slides":[{"title":"...","bullets":["..."]}]}. Use concise slide titles and short bullets. Use readable Unicode math (Δx · Δp ≥ ℏ/2; ψ = c₁ψ₁ + c₂ψ₂), never LaTeX, Markdown, or backslashes.',
          },
          { role: "user", content: userMessage },
        ],
        { maxTokens: 1200, toolChoice: "none", useDefaultFallbacks: true },
      );
      const m = (res.content || "").match(/\{[\s\S]*\}/);
      if (m) {
        const p = JSON.parse(m[0]) as { title?: string; slides?: unknown };
        if (p.title) title = String(p.title);
        if (p.slides) slidesJson = JSON.stringify(p.slides);
      }
    } catch {
      /* */
    }
    const result = await hub.googleSlidesCreate(title, slidesJson);
    const out = withPrefix(rereadPrefix, `DONE: ${result}`);
    await addMessage(session, { role: "assistant", content: out });
    options.onStatus?.("done");
    return {
      sessionId: session.id,
      response: out,
      toolCallsExecuted: ["google.slides.create"],
    };
  }

  if (match.id === "gmail") {
    const mailIntent =
      detectMailIntent(workingMessage) || detectMailIntent(userMessage);
    if (!mailIntent) return null;
    await addMessage(session, { role: "user", content: userMessage });
    const { gmailBrowserOpen, gmailBrowserCompose, gmailBrowserReply, gmailBrowserSendOpen } =
      await import("@heyagent/computer");
    let response = "";
    const executed: string[] = [];

    if (mailIntent.kind === "open" || mailIntent.kind === "check") {
      options.onStatus?.("working", "gmail.browser.open");
      response = await gmailBrowserOpen({ browser: mailIntent.browser });
      executed.push("gmail.browser.open");
      try {
        const hub = new IntegrationsHub();
        const summary = await hub.gmailSummary(mailIntent.limit, mailIntent.unreadOnly);
        if (!summary.startsWith("ERROR")) {
          response = `${response}\n\n${summary}`;
          executed.push("gmail.summary");
        }
      } catch {
        /* ignore */
      }
    } else if (mailIntent.kind === "compose") {
      options.onStatus?.("working", "gmail.browser.compose");
      response = await gmailBrowserCompose({
        to: mailIntent.to ?? "",
        subject: mailIntent.subject,
        body: mailIntent.body,
        send: mailIntent.send,
        browser: mailIntent.browser,
      });
      executed.push("gmail.browser.compose");
    } else if (mailIntent.kind === "reply") {
      options.onStatus?.("working", "gmail.browser.reply");
      response = await gmailBrowserReply({
        body: mailIntent.body ?? "",
        send: mailIntent.send,
        openInboxFirst: true,
        browser: mailIntent.browser,
      });
      executed.push("gmail.browser.reply");
    } else if (mailIntent.kind === "send") {
      options.onStatus?.("working", "gmail.browser.send");
      response = await gmailBrowserSendOpen({ browser: mailIntent.browser });
      executed.push("gmail.browser.send");
    }

    await rememberAction(executed[0] ?? "gmail.browser", response.slice(0, 500));
    const out = withPrefix(rereadPrefix, response);
    await addMessage(session, { role: "assistant", content: out });
    options.onStatus?.("done");
    return { sessionId: session.id, response: out, toolCallsExecuted: executed };
  }

  return null;
}
