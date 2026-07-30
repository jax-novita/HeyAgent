export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MonitorState extends Rectangle {
  id: string;
  name?: string;
  scaleFactor: number;
  dpi?: number;
  primary: boolean;
}

export type WindowDisplayState = "normal" | "minimized" | "maximized" | "unknown";

export interface WindowState {
  id: string;
  title: string;
  processId?: number;
  processName?: string;
  bounds: Rectangle;
  displayState: WindowDisplayState;
  focused: boolean;
  responding: boolean;
  monitorId?: string;
  parentWindowId?: string;
  modal?: boolean;
}

export interface ApplicationState {
  id: string;
  name: string;
  processId?: number;
  responding?: boolean;
  windowIds: string[];
}

export interface DesktopState {
  activeWindowId?: string;
  activeMonitorId?: string;
  cursor?: { x: number; y: number; monitorId?: string };
  clipboardType?: "empty" | "text" | "files" | "image" | "unknown";
  notificationDetected?: boolean;
  modalWindowIds: string[];
}

export interface BrowserRuntimeState {
  connected: boolean;
  url?: string;
  title?: string;
  tabId?: string;
}

export interface FileArtifactState {
  id: string;
  path: string;
  kind?: string;
  verifiedAt: string;
  size?: number;
  hash?: string;
}

export interface CommunicationState {
  telegram?: { activeChat?: string; lastMessageId?: string };
  email?: { activeThreadId?: string; lastMessageId?: string };
}

export interface Evidence {
  id: string;
  kind:
    | "system_api"
    | "cdp"
    | "accessibility"
    | "ocr"
    | "vision"
    | "screenshot"
    | "file"
    | "tool_result"
    | "user_confirmation";
  summary: string;
  capturedAt: string;
  uri?: string;
  metadata?: Record<string, unknown>;
}

export interface ObservationRecord {
  id: string;
  source: Evidence["kind"];
  observedAt: string;
  summary: string;
  evidence: Evidence[];
}

export interface WorldStateDiff {
  baseVersion: number;
  changes: WorldStateChange[];
  observedAt: string;
}

export interface WorldStateChange {
  path: string;
  before?: unknown;
  after?: unknown;
  evidenceIds: string[];
}

export interface ApprovalState {
  id: string;
  action: string;
  status: "pending" | "approved" | "denied" | "expired" | "consumed";
  createdAt: string;
}

export interface WaitState {
  id: string;
  missionId: string;
  status: "active" | "triggered" | "expired" | "cancelled";
  source: string;
}

export interface WorldState {
  version: number;
  updatedAt: string;
  session: Record<string, unknown>;
  mission: Record<string, unknown> | null;
  desktop: DesktopState;
  monitors: MonitorState[];
  windows: WindowState[];
  applications: ApplicationState[];
  browser: BrowserRuntimeState;
  files: FileArtifactState[];
  communications: CommunicationState;
  pendingApprovals: ApprovalState[];
  activeWaits: WaitState[];
  observations: ObservationRecord[];
}

export interface ToolError {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface ToolExecutionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: ToolError;
  evidence: Evidence[];
  observation?: ObservationRecord;
  stateDiff?: WorldStateDiff;
  startedAt: string;
  finishedAt: string;
}

export function createEmptyWorldState(now = new Date().toISOString()): WorldState {
  return {
    version: 1,
    updatedAt: now,
    session: {},
    mission: null,
    desktop: { modalWindowIds: [] },
    monitors: [],
    windows: [],
    applications: [],
    browser: { connected: false },
    files: [],
    communications: {},
    pendingApprovals: [],
    activeWaits: [],
    observations: [],
  };
}
