import { generateId } from "@heyagent/shared";

export type WaitSource =
  | "time"
  | "telegram"
  | "email"
  | "browser"
  | "filesystem"
  | "application"
  | "system"
  | "approval";

export type WaitPredicate =
  | { kind: "after"; at: string }
  | { kind: "equals"; field: string; value: unknown }
  | { kind: "changed"; field: string; previous?: unknown }
  | { kind: "exists"; path: string }
  | { kind: "event"; name: string; correlationId?: string };

export interface WaitCondition {
  id: string;
  missionId: string;
  stepId: string;
  source: WaitSource;
  predicate: WaitPredicate;
  pollIntervalMs?: number;
  deadline?: string;
  status: "active" | "triggered" | "expired" | "cancelled";
  createdAt: string;
  triggeredAt?: string;
  version: number;
}

export class WaitRegistry {
  private waits = new Map<string, WaitCondition>();

  constructor(initial: WaitCondition[] = []) {
    for (const wait of initial) this.waits.set(wait.id, structuredClone(wait));
  }

  create(input: Omit<WaitCondition, "id" | "status" | "createdAt" | "version">): WaitCondition {
    const wait: WaitCondition = {
      ...structuredClone(input),
      id: generateId("wait"),
      status: "active",
      createdAt: new Date().toISOString(),
      version: 1,
    };
    this.waits.set(wait.id, wait);
    return structuredClone(wait);
  }

  evaluate(
    id: string,
    context: Record<string, unknown>,
    now = new Date(),
  ): WaitCondition {
    const wait = this.waits.get(id);
    if (!wait) throw new Error(`Wait not found: ${id}`);
    if (wait.status !== "active") return structuredClone(wait);
    if (wait.deadline && now.getTime() > new Date(wait.deadline).getTime()) {
      wait.status = "expired";
    } else if (matches(wait.predicate, context, now)) {
      wait.status = "triggered";
      wait.triggeredAt = now.toISOString();
    }
    return structuredClone(wait);
  }

  cancel(id: string): WaitCondition | undefined {
    const wait = this.waits.get(id);
    if (!wait) return undefined;
    wait.status = "cancelled";
    return structuredClone(wait);
  }

  list(missionId?: string): WaitCondition[] {
    const values = [...this.waits.values()];
    return structuredClone(missionId ? values.filter((item) => item.missionId === missionId) : values);
  }
}

function matches(predicate: WaitPredicate, context: Record<string, unknown>, now: Date): boolean {
  switch (predicate.kind) {
    case "after":
      return now.getTime() >= new Date(predicate.at).getTime();
    case "equals":
      return getPath(context, predicate.field) === predicate.value;
    case "changed":
      return getPath(context, predicate.field) !== predicate.previous;
    case "exists":
      return context.paths instanceof Set && context.paths.has(predicate.path);
    case "event":
      return (
        context.eventName === predicate.name &&
        (!predicate.correlationId || context.correlationId === predicate.correlationId)
      );
  }
}

function getPath(context: Record<string, unknown>, path: string): unknown {
  let value: unknown = context;
  for (const part of path.split(".")) {
    if (!value || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}
