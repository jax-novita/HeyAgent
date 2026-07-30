import type { ToolRegistry } from "./tools.js";
import {
  rememberFact,
  startChatMission,
  cancelMission,
  appendMissionTurn,
  loadMemory,
} from "./memory.js";

export function registerMemoryTools(registry: ToolRegistry): void {
  registry.register({
    name: "memory.remember",
    description:
      "Save a durable fact about the user or ongoing work (name, preference, path, agreement).",
    category: "memory",
    parameters: {
      type: "object",
      properties: {
        key: { type: "string" },
        value: { type: "string" },
      },
      required: ["key", "value"],
    },
    execute: async (args) => {
      await rememberFact(String(args.key ?? ""), String(args.value ?? ""));
      try {
        const { appendMemoryFacts } = await import("@heyagent/identity");
        await appendMemoryFacts([`${args.key}: ${args.value}`]);
      } catch {
        /* ignore */
      }
      return `Remembered ${args.key}=${args.value}`;
    },
  });

  registry.register({
    name: "memory.search",
    description:
      "Search MEMORY.md and recent daily notes for keywords (OpenClaw-style workspace memory lookup).",
    category: "memory",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
    execute: async (args) => {
      const { searchWorkspaceMemory } = await import("@heyagent/identity");
      return searchWorkspaceMemory(String(args.query ?? ""), Number(args.limit ?? 8));
    },
  });

  registry.register({
    name: "mission.start",
    description:
      "Start a long chat mission: keep messaging a Telegram contact until an end phrase (default «до свидания»). Use when user asks to chat/talk with someone until goodbye.",
    category: "memory",
    parameters: {
      type: "object",
      properties: {
        contact: { type: "string", description: "e.g. Ренат" },
        endPhrase: { type: "string", description: "default: до свидания" },
        firstMessage: {
          type: "string",
          description: "Optional first message to send immediately via Telegram Desktop",
        },
      },
      required: ["contact"],
    },
    execute: async (args) => {
      const contact = String(args.contact ?? "").trim();
      const endPhrase = String(args.endPhrase ?? "до свидания").trim() || "до свидания";
      const mission = await startChatMission(contact, endPhrase);
      let sent = "";
      const first = String(args.firstMessage ?? "").trim();
      if (first) {
        const { telegramSendUi } = await import("@heyagent/computer");
        sent = await telegramSendUi(contact, first);
        await appendMissionTurn("agent", first);
      }
      return [
        `Mission started: chat with "${contact}" until "${endPhrase}" (id ${mission.id}).`,
        sent || "Send the first message with telegram_message, then wait for the owner to forward replies.",
        "After each reply from the contact (forwarded by the owner), continue the conversation until the end phrase appears.",
      ].join("\n");
    },
  });

  registry.register({
    name: "mission.note_turn",
    description:
      "Record a turn in the active chat mission (your message or their reply). Call after sending or receiving.",
    category: "memory",
    parameters: {
      type: "object",
      properties: {
        role: { type: "string", description: "agent or them" },
        text: { type: "string" },
      },
      required: ["role", "text"],
    },
    execute: async (args) => {
      const role = String(args.role ?? "agent") === "them" ? "them" : "agent";
      const mission = await appendMissionTurn(role, String(args.text ?? ""));
      if (!mission) return "No active mission.";
      if (mission.status === "done") {
        return `Turn saved. Mission COMPLETE — end phrase "${mission.endPhrase}" detected. Tell the owner.`;
      }
      return `Turn saved (${mission.turns.length} total). Mission still active — continue until "${mission.endPhrase}".`;
    },
  });

  registry.register({
    name: "mission.cancel",
    description: "Cancel the active long-running chat mission.",
    category: "memory",
    parameters: { type: "object", properties: {} },
    execute: async () => {
      await cancelMission();
      return "Mission cancelled.";
    },
  });

  registry.register({
    name: "mission.status",
    description: "Show active mission and recent memory artifacts.",
    category: "memory",
    parameters: { type: "object", properties: {} },
    execute: async () => {
      const mem = await loadMemory();
      return JSON.stringify(
        {
          activeMission: mem.activeMission,
          artifacts: mem.artifacts,
          recentActions: mem.recentActions.slice(-5),
          facts: mem.facts.slice(-10),
        },
        null,
        2,
      );
    },
  });
}
