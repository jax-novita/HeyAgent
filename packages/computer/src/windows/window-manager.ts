import {
  generateId,
  type MonitorState,
  type ToolExecutionResult,
  type WindowState,
} from "@heyagent/shared";
import { runPowerShellQuiet } from "../ps-quiet.js";
import { SystemDesktopObserverBackend } from "../observer/windows-backend.js";
import type { WindowQuery } from "../observer/types.js";

export interface WindowPlacement {
  x: number;
  y: number;
  monitorId?: string;
}

export interface WindowSize {
  width: number;
  height: number;
}

export interface WindowManager {
  list(): Promise<WindowState[]>;
  find(query: WindowQuery): Promise<WindowState[]>;
  focus(windowId: string): Promise<ToolExecutionResult>;
  move(windowId: string, target: WindowPlacement): Promise<ToolExecutionResult>;
  resize(windowId: string, size: WindowSize): Promise<ToolExecutionResult>;
  minimize(windowId: string): Promise<ToolExecutionResult>;
  maximize(windowId: string): Promise<ToolExecutionResult>;
  restore(windowId: string): Promise<ToolExecutionResult>;
  close(windowId: string): Promise<ToolExecutionResult>;
}

export class WindowsWindowManager implements WindowManager {
  constructor(
    private readonly backend = new SystemDesktopObserverBackend(),
    private readonly monitorProvider: () => Promise<MonitorState[]> = () => backend.getMonitorLayout(),
  ) {}

  list(): Promise<WindowState[]> {
    return this.backend.listWindows();
  }

  async find(query: WindowQuery): Promise<WindowState[]> {
    return (await this.list()).filter((window) => {
      if (query.id && window.id !== query.id) return false;
      if (query.processId && window.processId !== query.processId) return false;
      if (query.processName && !window.processName?.toLowerCase().includes(query.processName.toLowerCase())) {
        return false;
      }
      if (typeof query.title === "string" && !window.title.toLowerCase().includes(query.title.toLowerCase())) {
        return false;
      }
      if (query.title instanceof RegExp && !query.title.test(window.title)) return false;
      return true;
    });
  }

  focus(windowId: string): Promise<ToolExecutionResult> {
    return this.show(windowId, 9, "focus");
  }

  move(windowId: string, target: WindowPlacement): Promise<ToolExecutionResult> {
    return this.mutate(windowId, "move", async (window) => {
      let x = target.x;
      let y = target.y;
      if (target.monitorId) {
        const monitor = (await this.monitorProvider()).find((item) => item.id === target.monitorId);
        if (!monitor) throw new Error(`Monitor not found: ${target.monitorId}`);
        x += monitor.x;
        y += monitor.y;
      }
      return setWindowPosition(windowId, x, y, window.bounds.width, window.bounds.height);
    });
  }

  resize(windowId: string, size: WindowSize): Promise<ToolExecutionResult> {
    if (size.width <= 0 || size.height <= 0) return Promise.resolve(failure("resize", "INVALID_SIZE"));
    return this.mutate(windowId, "resize", (window) =>
      setWindowPosition(windowId, window.bounds.x, window.bounds.y, size.width, size.height),
    );
  }

  minimize(windowId: string): Promise<ToolExecutionResult> {
    return this.show(windowId, 6, "minimize");
  }

  maximize(windowId: string): Promise<ToolExecutionResult> {
    return this.show(windowId, 3, "maximize");
  }

  restore(windowId: string): Promise<ToolExecutionResult> {
    return this.show(windowId, 9, "restore");
  }

  close(windowId: string): Promise<ToolExecutionResult> {
    return this.mutate(windowId, "close", () => invokeWindow(windowId, 0x0010));
  }

  private show(windowId: string, command: number, action: string): Promise<ToolExecutionResult> {
    return this.mutate(windowId, action, () => showWindow(windowId, command));
  }

  private async mutate(
    windowId: string,
    action: string,
    operation: (window: WindowState) => Promise<{ ok: boolean; out: string }>,
  ): Promise<ToolExecutionResult> {
    const startedAt = new Date().toISOString();
    const window = (await this.list()).find((item) => item.id === windowId);
    if (!window) return failure(action, "WINDOW_NOT_FOUND", startedAt);
    try {
      const result = await operation(window);
      const finishedAt = new Date().toISOString();
      if (!result.ok) return failure(action, result.out, startedAt, finishedAt);
      return {
        success: true,
        data: { windowId, action },
        evidence: [{
          id: generateId("evidence"),
          kind: "system_api",
          summary: `${action} ${window.title}: ${result.out}`,
          capturedAt: finishedAt,
        }],
        startedAt,
        finishedAt,
      };
    } catch (error) {
      return failure(action, error instanceof Error ? error.message : String(error), startedAt);
    }
  }
}

async function showWindow(id: string, command: number): Promise<{ ok: boolean; out: string }> {
  return runUser32(
    id,
    `[HeyAgentWindow]::ShowWindow($h, ${command}) | Out-Null; [HeyAgentWindow]::SetForegroundWindow($h) | Out-Null; 'OK'`,
  );
}

async function invokeWindow(id: string, message: number): Promise<{ ok: boolean; out: string }> {
  return runUser32(id, `[HeyAgentWindow]::PostMessage($h, ${message}, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null; 'OK'`);
}

async function setWindowPosition(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<{ ok: boolean; out: string }> {
  return runUser32(
    id,
    `[HeyAgentWindow]::SetWindowPos($h, [IntPtr]::Zero, ${Math.round(x)}, ${Math.round(y)}, ${Math.round(width)}, ${Math.round(height)}, 0x0040) | Out-Null; 'OK'`,
  );
}

function runUser32(id: string, body: string): Promise<{ ok: boolean; out: string }> {
  if (!/^\d+$/.test(id)) return Promise.resolve({ ok: false, out: "INVALID_WINDOW_ID" });
  return runPowerShellQuiet(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class HeyAgentWindow {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
}
"@
$h = [IntPtr]::new([Int64]${id})
${body}
`);
}

function failure(
  action: string,
  message: string,
  startedAt = new Date().toISOString(),
  finishedAt = new Date().toISOString(),
): ToolExecutionResult {
  return {
    success: false,
    error: { code: message, message: `${action} failed: ${message}`, retryable: true },
    evidence: [],
    startedAt,
    finishedAt,
  };
}
