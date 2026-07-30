import { generateId } from "@heyagent/shared";
import type { TimelineEvent, Verdict } from "./types.js";

const MAX_EVENTS = 400;

/**
 * Observability timeline: tool → screenshot → verdict.
 * In-memory ring buffer + optional sink for persistence.
 */
export class Timeline {
  private events: TimelineEvent[] = [];
  private sink?: (e: TimelineEvent) => void | Promise<void>;

  onEvent(sink: (e: TimelineEvent) => void | Promise<void>): void {
    this.sink = sink;
  }

  async push(
    partial: Omit<TimelineEvent, "id" | "at"> & { at?: string },
  ): Promise<TimelineEvent> {
    const e: TimelineEvent = {
      id: generateId("evt"),
      at: partial.at ?? new Date().toISOString(),
      ...partial,
    };
    this.events.push(e);
    if (this.events.length > MAX_EVENTS) this.events = this.events.slice(-MAX_EVENTS);
    await this.sink?.(e);
    return e;
  }

  async step(
    name: string,
    detail?: string,
    missionId?: string,
  ): Promise<TimelineEvent> {
    return this.push({ kind: "step", name, detail, missionId });
  }

  async tool(
    name: string,
    detail?: string,
    missionId?: string,
  ): Promise<TimelineEvent> {
    return this.push({ kind: "tool", name, detail, missionId });
  }

  async verify(
    name: string,
    verdict: Verdict,
    detail?: string,
    screenshotPath?: string,
    missionId?: string,
  ): Promise<TimelineEvent> {
    return this.push({
      kind: "verify",
      name,
      verdict,
      detail,
      screenshotPath,
      missionId,
    });
  }

  list(limit = 50): TimelineEvent[] {
    return this.events.slice(-limit);
  }

  clear(): void {
    this.events = [];
  }
}

export const globalTimeline = new Timeline();
