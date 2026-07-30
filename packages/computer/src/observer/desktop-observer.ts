import { generateId, type ApplicationState, type Evidence, type MonitorState, type WindowState } from "@heyagent/shared";
import { monitorForPoint, monitorForRectangle } from "../monitors.js";
import type { DesktopObserverBackend, DesktopSnapshot, WaitOptions, WindowQuery } from "./types.js";

export class DesktopObserver {
  constructor(private readonly backend: DesktopObserverBackend) {}

  async observeDesktop(): Promise<DesktopSnapshot> {
    const [monitors, rawWindows, cursor, clipboardType] = await Promise.all([
      this.backend.getMonitorLayout(),
      this.backend.listWindows(),
      this.backend.getCursor?.(),
      this.backend.getClipboardType?.(),
    ]);
    const windows = rawWindows.map((window) => ({
      ...window,
      monitorId: window.monitorId ?? monitorForRectangle(monitors, window.bounds)?.id,
    }));
    const focused = windows.find((window) => window.focused);
    const cursorMonitor = cursor ? monitorForPoint(monitors, cursor.x, cursor.y) : undefined;
    const capturedAt = new Date().toISOString();
    const evidence: Evidence = {
      id: generateId("evidence"),
      kind: "system_api",
      summary: `Observed ${windows.length} windows on ${monitors.length} monitors`,
      capturedAt,
    };
    return {
      version: 1,
      capturedAt,
      desktop: {
        activeWindowId: focused?.id,
        activeMonitorId: focused?.monitorId,
        cursor: cursor ? { ...cursor, monitorId: cursorMonitor?.id } : undefined,
        clipboardType: clipboardType ?? "unknown",
        modalWindowIds: windows.filter((window) => window.modal).map((window) => window.id),
      },
      monitors,
      windows,
      applications: groupApplications(windows),
      observation: {
        id: generateId("observation"),
        source: "system_api",
        observedAt: capturedAt,
        summary: evidence.summary,
        evidence: [evidence],
      },
    };
  }

  async getActiveWindow(): Promise<WindowState | undefined> {
    return (await this.observeDesktop()).windows.find((window) => window.focused);
  }

  async listWindows(): Promise<WindowState[]> {
    return (await this.observeDesktop()).windows;
  }

  async getMonitorLayout(): Promise<MonitorState[]> {
    return this.backend.getMonitorLayout();
  }

  waitForWindow(query: WindowQuery, options?: WaitOptions): Promise<WindowState> {
    return this.poll(
      async () => (await this.listWindows()).find((window) => matchesWindow(window, query)),
      `window matching ${describeQuery(query)}`,
      options,
    );
  }

  async waitForWindowChange(
    previous: DesktopSnapshot,
    options?: WaitOptions,
  ): Promise<DesktopSnapshot> {
    return this.poll(async () => {
      const next = await this.observeDesktop();
      return snapshotKey(next) === snapshotKey(previous) ? undefined : next;
    }, "desktop window change", options);
  }

  waitForApplication(name: string, options?: WaitOptions): Promise<ApplicationState> {
    return this.poll(async () => {
      const snapshot = await this.observeDesktop();
      return snapshot.applications.find((application) =>
        application.name.toLowerCase().includes(name.toLowerCase()),
      );
    }, `application ${name}`, options);
  }

  waitForVisualChange(
    previousHash: string,
    observeHash: () => Promise<string>,
    options?: WaitOptions,
  ): Promise<string> {
    return this.poll(async () => {
      const current = await observeHash();
      return current === previousHash ? undefined : current;
    }, "visual change", options);
  }

  private async poll<T>(
    probe: () => Promise<T | undefined>,
    description: string,
    options: WaitOptions = {},
  ): Promise<T> {
    const timeoutMs = options.timeoutMs ?? 10_000;
    const pollIntervalMs = options.pollIntervalMs ?? 250;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      if (options.signal?.aborted) throw new Error(`Waiting for ${description} was cancelled`);
      const value = await probe();
      if (value !== undefined) return value;
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    throw new Error(`Timed out waiting for ${description}`);
  }
}

function matchesWindow(window: WindowState, query: WindowQuery): boolean {
  if (query.id && window.id !== query.id) return false;
  if (query.processId && window.processId !== query.processId) return false;
  if (query.processName && !window.processName?.toLowerCase().includes(query.processName.toLowerCase())) {
    return false;
  }
  if (typeof query.title === "string" && !window.title.toLowerCase().includes(query.title.toLowerCase())) {
    return false;
  }
  if (query.title instanceof RegExp && !query.title.test(window.title)) return false;
  if (query.modal !== undefined && window.modal !== query.modal) return false;
  if (query.visible === true && (window.bounds.width <= 0 || window.bounds.height <= 0)) return false;
  return true;
}

function groupApplications(windows: WindowState[]): ApplicationState[] {
  const applications = new Map<string, ApplicationState>();
  for (const window of windows) {
    const id = window.processId ? String(window.processId) : window.processName ?? window.id;
    const current = applications.get(id) ?? {
      id,
      name: window.processName ?? "unknown",
      processId: window.processId,
      responding: true,
      windowIds: [],
    };
    current.windowIds.push(window.id);
    current.responding = current.responding && window.responding;
    applications.set(id, current);
  }
  return [...applications.values()];
}

function snapshotKey(snapshot: DesktopSnapshot): string {
  return JSON.stringify(
    snapshot.windows.map((window) => [
      window.id,
      window.title,
      window.focused,
      window.displayState,
      window.bounds,
    ]),
  );
}

function describeQuery(query: WindowQuery): string {
  return query.id ?? String(query.title ?? query.processName ?? query.processId ?? "query");
}
