export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
  category: "computer" | "integration" | "system" | "memory";
}

export interface ToolRegistry {
  list(): AgentTool[];
  get(name: string): AgentTool | undefined;
  register(tool: AgentTool): void;
}

export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, AgentTool>();

  return {
    list: () => [...tools.values()],
    get: (name) => tools.get(name),
    register: (tool) => tools.set(tool.name, tool),
  };
}
