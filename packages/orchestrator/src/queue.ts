import { generateId } from "@heyagent/shared";
import type { Mission, MissionStatus } from "./types.js";

/**
 * Single-flight UI mission queue: only ONE UI mission runs at a time.
 * Non-UI missions can run in parallel with the UI one.
 */
export class MissionQueue {
  private items: Mission[] = [];
  private activeUiId: string | null = null;

  enqueue(mission: Mission): Mission {
    const m: Mission = {
      ...mission,
      id: mission.id || generateId("mission"),
      status: "queued",
      updatedAt: new Date().toISOString(),
    };
    this.items.push(m);
    return m;
  }

  /** Pick next runnable mission respecting UI single-flight. */
  /** Claim a specific mission if runnable (UI single-flight respected). */
  tryClaim(id: string): Mission | null {
    const m = this.get(id);
    if (!m) return null;
    if (m.status !== "queued" && m.status !== "paused") return null;
    if (m.requiresUi && this.activeUiId && this.activeUiId !== m.id) return null;
    m.status = "running";
    m.updatedAt = new Date().toISOString();
    if (m.requiresUi) this.activeUiId = m.id;
    return m;
  }

  dequeueRunnable(): Mission | null {
    for (const m of this.items) {
      if (m.status !== "queued" && m.status !== "paused") continue;
      if (m.requiresUi && this.activeUiId && this.activeUiId !== m.id) continue;
      m.status = "running";
      m.updatedAt = new Date().toISOString();
      if (m.requiresUi) this.activeUiId = m.id;
      return m;
    }
    return null;
  }

  update(id: string, patch: Partial<Mission>): Mission | null {
    const m = this.items.find((x) => x.id === id);
    if (!m) return null;
    Object.assign(m, patch, { updatedAt: new Date().toISOString() });
    if (
      m.requiresUi &&
      (m.status === "done" ||
        m.status === "cancelled" ||
        m.status === "failed" ||
        m.status === "paused")
    ) {
      if (this.activeUiId === id) this.activeUiId = null;
    }
    if (m.requiresUi && m.status === "waiting") {
      // still holds the UI lock while waiting for a reply
      this.activeUiId = id;
    }
    return m;
  }

  cancel(id?: string): Mission[] {
    const cancelled: Mission[] = [];
    for (const m of this.items) {
      if (id && m.id !== id) continue;
      if (m.status === "done" || m.status === "cancelled") continue;
      m.status = "cancelled";
      m.updatedAt = new Date().toISOString();
      cancelled.push(m);
      if (this.activeUiId === m.id) this.activeUiId = null;
    }
    return cancelled;
  }

  /** Pause running/waiting/queued missions (keeps them resumable). */
  pause(id?: string): Mission[] {
    const paused: Mission[] = [];
    for (const m of this.items) {
      if (id && m.id !== id) continue;
      if (m.status !== "running" && m.status !== "waiting" && m.status !== "queued") continue;
      m.status = "paused";
      m.updatedAt = new Date().toISOString();
      paused.push(m);
      if (this.activeUiId === m.id) this.activeUiId = null;
    }
    return paused;
  }

  get(id: string): Mission | undefined {
    return this.items.find((m) => m.id === id);
  }

  activeUi(): Mission | null {
    return this.activeUiId ? this.get(this.activeUiId) ?? null : null;
  }

  list(status?: MissionStatus): Mission[] {
    return status ? this.items.filter((m) => m.status === status) : [...this.items];
  }

  /** Persistable snapshot for resume. */
  snapshot(): { items: Mission[]; activeUiId: string | null } {
    return { items: this.items, activeUiId: this.activeUiId };
  }

  restore(data: { items: Mission[]; activeUiId: string | null }): void {
    this.items = data.items ?? [];
    this.activeUiId = data.activeUiId ?? null;
  }
}

/** Process-wide singleton used by AgentRuntime / gateway. */
export const globalMissionQueue = new MissionQueue();
