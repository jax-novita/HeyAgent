import { platform } from "node:os";
import type { DesktopState, MonitorState, WindowState } from "@heyagent/shared";
import { runPowerShellQuiet } from "../ps-quiet.js";
import type { DesktopObserverBackend } from "./types.js";

export class SystemDesktopObserverBackend implements DesktopObserverBackend {
  async getMonitorLayout(): Promise<MonitorState[]> {
    if (platform() !== "win32") return [];
    const result = await runPowerShellQuiet([
      "Add-Type -AssemblyName System.Windows.Forms",
      "$items = [System.Windows.Forms.Screen]::AllScreens | ForEach-Object {",
      "  [pscustomobject]@{",
      "    id = $_.DeviceName; name = $_.DeviceName",
      "    x = $_.Bounds.X; y = $_.Bounds.Y",
      "    width = $_.Bounds.Width; height = $_.Bounds.Height",
      "    primary = $_.Primary",
      "  }",
      "}",
      "$items | ConvertTo-Json -Compress",
    ].join("\n"));
    if (!result.ok || !result.out) return [];
    const parsed: unknown = JSON.parse(result.out);
    const displays = (Array.isArray(parsed) ? parsed : [parsed]) as Array<{
      id: string; name: string; x: number; y: number;
      width: number; height: number; primary: boolean;
    }>;
    return displays.map((display) => ({
      ...display,
      scaleFactor: 1,
      dpi: 96,
    }));
  }

  async listWindows(): Promise<WindowState[]> {
    if (platform() !== "win32") return [];
    const result = await runPowerShellQuiet(WINDOW_LIST_SCRIPT, { timeoutMs: 15_000 });
    if (!result.ok) throw new Error(result.out);
    const parsed: unknown = JSON.parse(result.out || "[]");
    const values = Array.isArray(parsed) ? parsed : [parsed];
    return values.filter(isRawWindow).map((window) => ({
      id: String(window.handle),
      title: window.title,
      processId: window.processId,
      processName: window.processName,
      bounds: { x: window.x, y: window.y, width: window.width, height: window.height },
      displayState: window.minimized ? "minimized" : "normal",
      focused: window.focused,
      responding: window.responding,
    }));
  }

  async getCursor(): Promise<{ x: number; y: number } | undefined> {
    if (platform() !== "win32") return undefined;
    const result = await runPowerShellQuiet(
      "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position | ConvertTo-Json -Compress",
    );
    if (!result.ok) return undefined;
    const value = JSON.parse(result.out) as { X?: unknown; Y?: unknown };
    return typeof value.X === "number" && typeof value.Y === "number"
      ? { x: value.X, y: value.Y }
      : undefined;
  }

  async getClipboardType(): Promise<DesktopState["clipboardType"]> {
    if (platform() !== "win32") return "unknown";
    const result = await runPowerShellQuiet([
      "Add-Type -AssemblyName System.Windows.Forms",
      "if ([Windows.Forms.Clipboard]::ContainsFileDropList()) { 'files' }",
      "elseif ([Windows.Forms.Clipboard]::ContainsImage()) { 'image' }",
      "elseif ([Windows.Forms.Clipboard]::ContainsText()) { 'text' }",
      "else { 'empty' }",
    ].join("\n"));
    return result.ok && ["files", "image", "text", "empty"].includes(result.out)
      ? result.out as DesktopState["clipboardType"]
      : "unknown";
  }
}

interface RawWindow {
  handle: number;
  title: string;
  processId: number;
  processName: string;
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
  focused: boolean;
  responding: boolean;
}

function isRawWindow(value: unknown): value is RawWindow {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<RawWindow>;
  return (
    typeof item.handle === "number" &&
    typeof item.title === "string" &&
    typeof item.x === "number" &&
    typeof item.y === "number" &&
    typeof item.width === "number" &&
    typeof item.height === "number"
  );
}

const WINDOW_LIST_SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class HeyWindow {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsHungAppWindow(IntPtr hWnd);
}
"@
$focused = [HeyWindow]::GetForegroundWindow().ToInt64()
$out = foreach ($p in Get-Process | Where-Object { $_.MainWindowHandle -ne 0 }) {
  $r = New-Object HeyWindow+RECT
  if ([HeyWindow]::GetWindowRect($p.MainWindowHandle, [ref]$r)) {
    [pscustomobject]@{
      handle = $p.MainWindowHandle.ToInt64()
      title = $p.MainWindowTitle
      processId = $p.Id
      processName = $p.ProcessName
      x = $r.Left
      y = $r.Top
      width = $r.Right - $r.Left
      height = $r.Bottom - $r.Top
      minimized = [HeyWindow]::IsIconic($p.MainWindowHandle)
      focused = ($p.MainWindowHandle.ToInt64() -eq $focused)
      responding = -not [HeyWindow]::IsHungAppWindow($p.MainWindowHandle)
    }
  }
}
@($out) | ConvertTo-Json -Compress
`;
