import type {
  ApplicationState,
  DesktopState,
  MonitorState,
  ObservationRecord,
  WindowState,
} from "@heyagent/shared";

export interface DesktopSnapshot {
  version: number;
  capturedAt: string;
  desktop: DesktopState;
  monitors: MonitorState[];
  windows: WindowState[];
  applications: ApplicationState[];
  observation: ObservationRecord;
}

export interface WindowQuery {
  id?: string;
  title?: string | RegExp;
  processName?: string;
  processId?: number;
  visible?: boolean;
  modal?: boolean;
}

export interface DesktopObserverBackend {
  getMonitorLayout(): Promise<MonitorState[]>;
  listWindows(): Promise<WindowState[]>;
  getCursor?(): Promise<{ x: number; y: number } | undefined>;
  getClipboardType?(): Promise<DesktopState["clipboardType"]>;
}

export interface WaitOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
}
