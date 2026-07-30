/**
 * Thin adapter: honor orchestrator harness hint; only fill meta / rare fallbacks.
 */
import type { OrchestrateResult } from "@heyagent/orchestrator";
import { hasHardHarnessSlot } from "@heyagent/orchestrator";
import {
  extractYoutubeLessonQuery,
  detectYoutubeOpenMode,
  detectSystemControlIntent,
  detectTimeIntent,
} from "@heyagent/computer";
import { detectNotepadComposeIntent, type NotepadComposeIntent } from "./notepad-compose.js";
import {
  detectGitHubMissionIntent,
  detectHardBrowserMissionIntent,
} from "./intents.js";
import { detectCronScheduleIntent } from "./cron-intent.js";

export type HarnessId =
  | "clock.now"
  | "cancel"
  | "telegram_conversation"
  | "telegram_one_shot"
  | "open_tab"
  | "youtube.open.lesson"
  | "github.browse.mission"
  | "hard_browser"
  | "system.control"
  | "system.empty_recycle_bin"
  | "notepad.compose"
  | "app.install"
  | "gmail"
  | "cron.schedule"
  | "docs.compose"
  | "research.digest"
  | "briefing.compose"
  | "mission.replay"
  | "mission.wait_owner"
  | "presentation.create"
  | "desktop.office"
  | "google.sheets"
  | "google.slides"
  | "llm_loop";

export interface HarnessMatch {
  id: HarnessId;
  priority: number;
  meta: Record<string, unknown>;
}

export interface MatchInput {
  userMessage: string;
  workingMessage: string;
  orch?: OrchestrateResult | null;
  clockEnabled?: boolean;
}

export function matchHarness(input: MatchInput): HarnessMatch {
  const user = input.userMessage.trim();
  const work = (input.workingMessage || user).trim();
  const combined = `${work} ${user}`;
  const orch = input.orch;
  const slots = orch?.route.slots ?? {};
  const hinted = (slots.harness || orch?.dispatch.harness || "") as string;
  const googleDocs = slots.googleDocs === "1" || hinted === "docs.compose";

  // Clock is orthogonal and cheap — keep local.
  if (input.clockEnabled !== false && (detectTimeIntent(user) || detectTimeIntent(work))) {
    return { id: "clock.now", priority: 100, meta: {} };
  }

  // ——— Honor orchestrator SSOT ———
  if (hinted === "cancel" || orch?.dispatch.harness === "cancel") {
    return { id: "cancel", priority: 99, meta: {} };
  }

  if (hinted === "cron.schedule") {
    const cron =
      detectCronScheduleIntent(user) ||
      detectCronScheduleIntent(work) ||
      (slots.cronEveryMinutes
        ? {
            name: slots.cronName || "reminder",
            prompt: slots.cronPrompt || work,
            everyMinutes: Number(slots.cronEveryMinutes) || 30,
          }
        : null);
    if (cron) return { id: "cron.schedule", priority: 96, meta: { cron } };
  }

  if (hinted === "telegram_conversation" || orch?.dispatch.harness === "telegram_conversation") {
    return {
      id: "telegram_conversation",
      priority: 95,
      meta: {
        contact: slots.contact || "",
        endPhrase: slots.endPhrase || "до свидания",
      },
    };
  }
  if (hinted === "telegram_one_shot" || orch?.dispatch.harness === "telegram_one_shot") {
    return {
      id: "telegram_one_shot",
      priority: 94,
      meta: { contact: slots.contact || "" },
    };
  }
  if (hinted === "open_tab" || orch?.dispatch.harness === "open_tab") {
    return {
      id: "open_tab",
      priority: 93,
      meta: {
        tabQuery: slots.tabQuery,
        browser: slots.browser,
        quizContinue: slots.quizContinue,
      },
    };
  }

  // Docs compose — deterministic write (never web.search theatre)
  if (googleDocs || hinted === "docs.compose") {
    return {
      id: "docs.compose",
      priority: 92,
      meta: { topic: slots.query || work, googleDocs: true },
    };
  }

  if (hinted === "research.digest") {
    return {
      id: "research.digest",
      priority: 91,
      meta: { topic: slots.query || work },
    };
  }
  if (hinted === "briefing.compose" || slots.briefing === "1") {
    return {
      id: "briefing.compose",
      priority: 92,
      meta: { topic: slots.query || work },
    };
  }
  if (hinted === "mission.replay" || slots.replay === "1") {
    return { id: "mission.replay", priority: 94, meta: { topic: slots.query || work } };
  }
  if (hinted === "mission.wait_owner" || slots.waitOwner === "1") {
    return { id: "mission.wait_owner", priority: 93, meta: { topic: slots.query || work } };
  }
  if (hinted === "presentation.create") {
    return {
      id: "presentation.create",
      priority: 90,
      meta: { topic: slots.query || work },
    };
  }
  if (hinted === "desktop.office") {
    return {
      id: "desktop.office",
      priority: 89,
      meta: { app: slots.officeApp || "word", topic: slots.query || work },
    };
  }
  if (hinted === "google.sheets") {
    return { id: "google.sheets", priority: 88, meta: { topic: slots.query || work } };
  }
  if (hinted === "google.slides") {
    return { id: "google.slides", priority: 88, meta: { topic: slots.query || work } };
  }

  if (hinted === "youtube.open.lesson") {
    const ytQuery =
      slots.ytQuery ||
      extractYoutubeLessonQuery(work) ||
      extractYoutubeLessonQuery(user) ||
      slots.query ||
      work;
    return {
      id: "youtube.open.lesson",
      priority: 90,
      meta: {
        query: ytQuery,
        mode: slots.ytMode || detectYoutubeOpenMode(ytQuery, combined),
      },
    };
  }

  if (hinted === "app.install" || slots.appInstall === "1") {
    return {
      id: "app.install",
      priority: 91,
      meta: { query: slots.query || work },
    };
  }

  if (hinted === "notepad.compose") {
    const note = resolveNotepadIntent(work, user, slots);
    return { id: "notepad.compose", priority: 88, meta: { note } };
  }

  if (hinted === "system.control" || orch?.dispatch.harness === "system") {
    const sys = detectSystemControlIntent(work) || detectSystemControlIntent(user);
    return { id: "system.control", priority: 80, meta: { sys } };
  }

  if (hinted === "system.empty_recycle_bin") {
    return { id: "system.empty_recycle_bin", priority: 79, meta: {} };
  }

  if (hinted === "gmail" || orch?.dispatch.harness === "gmail" || orch?.route.domain === "mail") {
    return { id: "gmail", priority: 70, meta: {} };
  }

  // Explicit llm_loop from orch — full tool loop, no local re-guess
  if (hinted === "llm_loop") {
    return { id: "llm_loop", priority: 0, meta: {} };
  }

  // Soft orch hints without hard slots → llm_loop (avoid narrow harness theatre)
  const SOFT_HINTS = new Set(["desktop", "browser", "coder", "research", "general"]);
  if (SOFT_HINTS.has(hinted) && !hasHardHarnessSlot(slots)) {
    return { id: "llm_loop", priority: 0, meta: {} };
  }

  if (hinted === "browser" || hinted === "research" || hinted === "coder" || hinted === "desktop") {
    return fallbackLocal(work, user, combined, slots, hinted);
  }

  // No orch / unknown — legacy fallback path
  return fallbackLocal(work, user, combined, slots, hinted);
}

function resolveNotepadIntent(
  work: string,
  user: string,
  slots: Record<string, string>,
): NotepadComposeIntent {
  const detected = detectNotepadComposeIntent(work) || detectNotepadComposeIntent(user);
  if (detected) return detected;
  const genre = (slots.noteGenre as NotepadComposeIntent["genre"]) || "note";
  return {
    genre: ["story", "poem", "list", "letter", "note"].includes(genre) ? genre : "note",
    topic: (slots.query || work).slice(0, 160),
    destination: "desktop",
    raw: work || user,
  };
}

function fallbackLocal(
  work: string,
  user: string,
  combined: string,
  slots: Record<string, string>,
  hinted: string,
): HarnessMatch {
  // Cron fallback if orch missed it
  if (hinted !== "llm_loop" || !slots.harness) {
    const cron = detectCronScheduleIntent(user) || detectCronScheduleIntent(work);
    if (cron) return { id: "cron.schedule", priority: 96, meta: { cron } };
  }

  // YouTube ONLY when extract agrees AND not docs/compose
  if (slots.googleDocs !== "1" && slots.composeDoc !== "1" && hinted !== "docs.compose") {
    const ytQuery = extractYoutubeLessonQuery(work) || extractYoutubeLessonQuery(user);
    if (ytQuery && hinted !== "llm_loop") {
      return {
        id: "youtube.open.lesson",
        priority: 90,
        meta: { query: ytQuery, mode: detectYoutubeOpenMode(ytQuery, combined) },
      };
    }
    // If orch said browser without hint, still allow YT extract
    if (ytQuery && (hinted === "browser" || !hinted)) {
      return {
        id: "youtube.open.lesson",
        priority: 90,
        meta: { query: ytQuery, mode: detectYoutubeOpenMode(ytQuery, combined) },
      };
    }
  }

  const github = detectGitHubMissionIntent(work) || detectGitHubMissionIntent(user);
  if (github) {
    return { id: "github.browse.mission", priority: 85, meta: { github } };
  }

  const hard = detectHardBrowserMissionIntent(work) || detectHardBrowserMissionIntent(user);
  if (hard) {
    return { id: "hard_browser", priority: 84, meta: { hard } };
  }

  if (hinted !== "llm_loop" && hinted !== "browser") {
    const sys = detectSystemControlIntent(work) || detectSystemControlIntent(user);
    if (sys) {
      return { id: "system.control", priority: 80, meta: { sys } };
    }
  }

  if (
    /(очист(и|ь)|опустош|выброс|empty).{0,20}(корзин|trash|recycle)/i.test(combined) ||
    /^(empty|clear).{0,10}(recycle|trash|bin)\b/i.test(work)
  ) {
    return { id: "system.empty_recycle_bin", priority: 79, meta: {} };
  }

  if (slots.composeDoc === "1" || hinted === "desktop") {
    const note = resolveNotepadIntent(work, user, slots);
    if (slots.composeDoc === "1" || detectNotepadComposeIntent(work) || detectNotepadComposeIntent(user)) {
      return { id: "notepad.compose", priority: 75, meta: { note } };
    }
  } else {
    const note = detectNotepadComposeIntent(work) || detectNotepadComposeIntent(user);
    // Weak notepad regex without composeDoc slot → prefer full llm_loop
    if (note && (slots.composeDoc === "1" || hinted === "notepad.compose")) {
      return { id: "notepad.compose", priority: 75, meta: { note } };
    }
  }

  return { id: "llm_loop", priority: 0, meta: {} };
}
