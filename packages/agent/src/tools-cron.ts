import type { ToolRegistry } from "./tools.js";
import { cronSchedule, cronList, cronCancel } from "./cron.js";

export function registerCronTools(registry: ToolRegistry): void {
  registry.register({
    name: "cron.schedule",
    description:
      "Schedule a recurring task: every N minutes run the given prompt as the agent (OpenClaw-style automation). Gateway must be running.",
    category: "system",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        prompt: { type: "string", description: "What the agent should do each tick" },
        everyMinutes: { type: "number" },
      },
      required: ["name", "prompt", "everyMinutes"],
    },
    execute: async (args) =>
      cronSchedule(
        String(args.name ?? "job"),
        String(args.prompt ?? ""),
        Number(args.everyMinutes ?? 60),
      ),
  });

  registry.register({
    name: "cron.list",
    description: "List scheduled cron jobs",
    category: "system",
    parameters: { type: "object", properties: {} },
    execute: async () => cronList(),
  });

  registry.register({
    name: "cron.cancel",
    description: "Cancel a cron job by id or name",
    category: "system",
    parameters: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    execute: async (args) => cronCancel(String(args.id ?? "")),
  });
}
