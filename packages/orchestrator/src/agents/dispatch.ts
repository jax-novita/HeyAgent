import type { AgentKind, RouteDecision } from "../types.js";
import type { OrchHarnessHint } from "../intent-signals.js";

export interface AgentDispatch {
  agent: AgentKind;
  /** Concrete harness id — must match agent HarnessId (+ docs.compose alias). */
  harness: OrchHarnessHint | "system" | "research" | "desktop" | "coder" | "browser";
  description: string;
}

/** Map route → specialized agent + harness (honors slots.harness from classifyIntent). */
export function dispatchAgent(route: RouteDecision): AgentDispatch {
  const hinted = route.slots.harness as OrchHarnessHint | undefined;
  if (hinted) {
    return {
      agent: route.agent,
      harness: hinted,
      description: route.reason || hinted,
    };
  }

  if (route.slots.cancel === "1") {
    return { agent: "general", harness: "cancel", description: "Cancel active missions" };
  }
  switch (route.agent) {
    case "messaging":
      if (route.domain === "mail") {
        return { agent: "messaging", harness: "gmail", description: "Mail / Gmail browser" };
      }
      return {
        agent: "messaging",
        harness: route.missionKind === "chat_until" ? "telegram_conversation" : "telegram_one_shot",
        description: "Telegram Desktop messaging",
      };
    case "browser":
      if (route.slots.openTab === "1") {
        return {
          agent: "browser",
          harness: "open_tab",
          description: "Focus already-open browser tab (no new search)",
        };
      }
      if (route.slots.googleDocs === "1") {
        return { agent: "browser", harness: "docs.compose", description: "Google Docs compose" };
      }
      return { agent: "browser", harness: "browser", description: "Browser / YouTube CDP" };
    case "system":
      return { agent: "system", harness: "system.control", description: "Windows system controls" };
    case "research":
      return { agent: "research", harness: "research", description: "Research → report" };
    case "desktop":
      if (route.slots.appInstall === "1") {
        return {
          agent: "desktop",
          harness: "app.install",
          description: "Install program via package manager",
        };
      }
      if (route.slots.composeDoc === "1") {
        return {
          agent: "desktop",
          harness: "notepad.compose",
          description: "Notepad / local compose",
        };
      }
      return { agent: "desktop", harness: "desktop", description: "Desktop UI grounding" };
    case "coder":
      return { agent: "coder", harness: "coder", description: "Files / git / code" };
    default:
      return { agent: "general", harness: "llm_loop", description: "General LLM tool loop" };
  }
}
