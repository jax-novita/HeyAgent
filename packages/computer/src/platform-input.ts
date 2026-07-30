/**
 * Cross-platform input / window primitives for Windows, macOS, and Linux.
 * Prefer real OS tools (cliclick, xdotool, osascript, wmctrl) over stubs.
 */
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { platform } from "node:os";

const execAsync = promisify(exec);

export type OsKind = "win32" | "darwin" | "linux" | "other";

export function osKind(): OsKind {
  const p = platform();
  if (p === "win32" || p === "darwin" || p === "linux") return p;
  return "other";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function which(cmd: string): Promise<boolean> {
  try {
    const checker = osKind() === "win32" ? `where ${cmd}` : `command -v ${cmd}`;
    await execAsync(checker, { shell: osKind() === "win32" ? "cmd.exe" : "/bin/sh" });
    return true;
  } catch {
    return false;
  }
}

export async function platformCapabilities(): Promise<string[]> {
  const os = osKind();
  const caps: string[] = [`os=${os}`];
  if (os === "darwin") {
    if (await which("cliclick")) caps.push("cliclick");
    if (await which("osascript")) caps.push("osascript");
    if (await which("screencapture")) caps.push("screencapture");
    if (await which("say")) caps.push("tts:say");
  } else if (os === "linux") {
    if (await which("xdotool")) caps.push("xdotool");
    if (await which("wmctrl")) caps.push("wmctrl");
    if (await which("xclip") || (await which("wl-copy"))) caps.push("clipboard");
    if (await which("pactl") || (await which("wpctl"))) caps.push("audio");
    if (await which("notify-send")) caps.push("notify");
    if (await which("espeak-ng") || (await which("spd-say")) || (await which("espeak")))
      caps.push("tts");
  } else if (os === "win32") {
    caps.push("powershell", "user32", "uia", "tts:sapi");
  }
  return caps;
}

/** Smooth cursor move then click — all OSes. */
export async function xplatMouseClick(x: number, y: number): Promise<void> {
  const os = osKind();
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (os === "win32") {
    const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$s = [System.Windows.Forms.Cursor]::Position
$sx=$s.X;$sy=$s.Y;$n=12
for ($i=1;$i -le $n;$i++){
  $t=$i/$n; $e=if($t -lt 0.5){2*$t*$t}else{-1+(4-2*$t)*$t}
  [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point([int]($sx+(${xi}-$sx)*$e),[int]($sy+(${yi}-$sy)*$e))
  Start-Sleep -Milliseconds 6
}
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${xi},${yi})
Add-Type @"
using System; using System.Runtime.InteropServices;
public class XPClk { [DllImport("user32.dll")] public static extern void mouse_event(int f,int x,int y,int d,int e); }
"@
[XPClk]::mouse_event(0x0002,0,0,0,0); [XPClk]::mouse_event(0x0004,0,0,0,0)
`;
    await execAsync(ps, { shell: "powershell.exe" });
    return;
  }
  if (os === "darwin") {
    if (await which("cliclick")) {
      await execAsync(`cliclick m:${xi},${yi} c:${xi},${yi}`);
      return;
    }
    // Fallback: AppleScript click at position (requires Accessibility)
    await execAsync(
      `osascript -e 'tell application "System Events" to click at {${xi}, ${yi}}'`,
    ).catch(() => undefined);
    return;
  }
  // linux
  await execAsync(`xdotool mousemove --sync ${xi} ${yi} click 1`);
}

export async function xplatMouseMove(x: number, y: number): Promise<void> {
  const os = osKind();
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (os === "win32") {
    await execAsync(
      `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${xi},${yi})`,
      { shell: "powershell.exe" },
    );
    return;
  }
  if (os === "darwin") {
    if (await which("cliclick")) {
      await execAsync(`cliclick m:${xi},${yi}`);
      return;
    }
    return;
  }
  await execAsync(`xdotool mousemove --sync ${xi} ${yi}`);
}

export async function xplatMouseScroll(delta: number): Promise<void> {
  const os = osKind();
  if (os === "win32") {
    await execAsync(
      `
Add-Type @"
using System; using System.Runtime.InteropServices;
public class Scr { [DllImport("user32.dll")] public static extern void mouse_event(int f,int x,int y,int d,int e); }
"@
[Scr]::mouse_event(0x0800,0,0,${Math.trunc(delta)},0)
`,
      { shell: "powershell.exe" },
    );
    return;
  }
  if (os === "darwin") {
    if (await which("cliclick")) {
      const clicks = Math.max(1, Math.min(20, Math.abs(Math.round(delta / 120)) || 3));
      await execAsync(
        `osascript -e 'tell application "System Events" to scroll ${delta < 0 ? "up" : "down"} ${clicks}'`,
      ).catch(() => undefined);
      return;
    }
    return;
  }
  const button = delta < 0 ? 4 : 5;
  const n = Math.max(1, Math.min(10, Math.abs(Math.round(delta / 120)) || 3));
  for (let i = 0; i < n; i++) await execAsync(`xdotool click ${button}`);
}

export async function xplatMouseDoubleClick(x: number, y: number): Promise<void> {
  const os = osKind();
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (os === "win32") {
    await xplatMouseClick(xi, yi);
    await sleep(60);
    await xplatMouseClick(xi, yi);
    return;
  }
  if (os === "darwin") {
    if (await which("cliclick")) {
      await execAsync(`cliclick dc:${xi},${yi}`);
      return;
    }
    await xplatMouseClick(xi, yi);
    await sleep(60);
    await xplatMouseClick(xi, yi);
    return;
  }
  await execAsync(`xdotool mousemove --sync ${xi} ${yi} click --repeat 2 1`);
}

export async function xplatMouseDrag(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): Promise<void> {
  const os = osKind();
  if (os === "darwin" && (await which("cliclick"))) {
    await execAsync(
      `cliclick dd:${Math.round(x1)},${Math.round(y1)} du:${Math.round(x2)},${Math.round(y2)}`,
    );
    return;
  }
  if (os === "linux") {
    await execAsync(
      `xdotool mousemove --sync ${Math.round(x1)} ${Math.round(y1)} mousedown 1 mousemove --sync ${Math.round(x2)} ${Math.round(y2)} mouseup 1`,
    );
    return;
  }
  // win32 handled by existing screen.ts; fallback: move+click ends
  await xplatMouseMove(x1, y1);
  await xplatMouseMove(x2, y2);
}

/** Type unicode text reliably via clipboard paste on all OSes. */
export async function xplatTypeText(text: string): Promise<void> {
  const os = osKind();
  if (os === "win32") {
    const b64 = Buffer.from(text, "utf8").toString("base64");
    await execAsync(
      `$t=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')); Set-Clipboard -Value $t; Start-Sleep -Milliseconds 120; Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("^v")`,
      { shell: "powershell.exe" },
    );
    return;
  }
  if (os === "darwin") {
    // pbcopy + Cmd+V
    await execAsync(`printf %s ${JSON.stringify(text)} | pbcopy`);
    await sleep(80);
    await execAsync(
      `osascript -e 'tell application "System Events" to keystroke "v" using command down'`,
    );
    return;
  }
  // linux: try wl-copy/xclip then ctrl+v
  const escaped = JSON.stringify(text);
  await execAsync(`printf %s ${escaped} | wl-copy`).catch(() =>
    execAsync(`printf %s ${escaped} | xclip -selection clipboard`),
  );
  await sleep(80);
  await execAsync(`xdotool key --clearmodifiers ctrl+v`);
}

/** Hotkey like "ctrl+f", "cmd+enter", "alt+tab", "esc". */
export async function xplatHotkey(keys: string): Promise<void> {
  const os = osKind();
  const parts = keys.toLowerCase().split("+").map((p) => p.trim()).filter(Boolean);
  if (os === "win32") {
    const map: Record<string, string> = {
      ctrl: "^",
      control: "^",
      alt: "%",
      shift: "+",
      enter: "{ENTER}",
      return: "{ENTER}",
      tab: "{TAB}",
      esc: "{ESC}",
      escape: "{ESC}",
      backspace: "{BACKSPACE}",
      delete: "{DELETE}",
      end: "{END}",
      home: "{HOME}",
      down: "{DOWN}",
      up: "{UP}",
      left: "{LEFT}",
      right: "{RIGHT}",
      f4: "{F4}",
      f5: "{F5}",
    };
    let seq = "";
    for (const p of parts) {
      seq += map[p] ?? (p.length === 1 ? p : `{${p.toUpperCase()}}`);
    }
    await execAsync(
      `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("${seq.replace(/"/g, '""')}")`,
      { shell: "powershell.exe" },
    );
    return;
  }
  if (os === "darwin") {
    const key = parts[parts.length - 1] ?? "";
    const mods = parts.slice(0, -1);
    const using: string[] = [];
    for (const m of mods) {
      if (m === "cmd" || m === "command" || m === "meta") using.push("command down");
      else if (m === "ctrl" || m === "control") using.push("control down");
      else if (m === "alt" || m === "option") using.push("option down");
      else if (m === "shift") using.push("shift down");
    }
    const keyCode: Record<string, number> = {
      enter: 36,
      return: 36,
      tab: 48,
      esc: 53,
      escape: 53,
      delete: 117,
      backspace: 51,
      space: 49,
      down: 125,
      up: 126,
      left: 123,
      right: 124,
      end: 119,
      home: 115,
    };
    if (keyCode[key] != null) {
      const usingClause = using.length ? ` using {${using.join(", ")}}` : "";
      await execAsync(
        `osascript -e 'tell application "System Events" to key code ${keyCode[key]}${usingClause}'`,
      );
      return;
    }
    const usingClause = using.length ? ` using {${using.join(", ")}}` : "";
    const k = key === "f" ? "f" : key.slice(0, 1);
    await execAsync(
      `osascript -e 'tell application "System Events" to keystroke "${k.replace(/"/g, '\\"')}"${usingClause}'`,
    );
    return;
  }
  // linux xdotool: ctrl+f → ctrl+f
  const xd = parts
    .map((p) => {
      if (p === "cmd" || p === "command" || p === "meta") return "super";
      if (p === "control") return "ctrl";
      if (p === "escape") return "Escape";
      if (p === "enter" || p === "return") return "Return";
      if (p === "esc") return "Escape";
      return p;
    })
    .join("+");
  await execAsync(`xdotool key --clearmodifiers ${xd}`);
}

export interface WindowRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  title?: string;
}

/** Find main window rect for an app by process/name patterns. */
export async function findAppWindowRect(
  patterns: string[],
): Promise<WindowRect | null> {
  const os = osKind();
  if (os === "win32") {
    const names = patterns.map((p) => p.replace(/'/g, "''")).join("|");
    const ps2 = `
Add-Type @"
using System; using System.Runtime.InteropServices;
public class WR2 { [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; } }
"@
$p = Get-Process | Where-Object { $_.ProcessName -match '${names}' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { exit 1 }
$r = New-Object WR2+RECT
[void][WR2]::GetWindowRect($p.MainWindowHandle, [ref]$r)
Write-Output ("{0},{1},{2},{3}" -f $r.Left,$r.Top,$r.Right,$r.Bottom)
`;
    try {
      const { stdout } = await execAsync(ps2, { shell: "powershell.exe" });
      const m = stdout.trim().match(/(-?\d+),(-?\d+),(-?\d+),(-?\d+)/);
      if (!m) return null;
      return { left: +m[1]!, top: +m[2]!, right: +m[3]!, bottom: +m[4]! };
    } catch {
      return null;
    }
  }
  if (os === "darwin") {
    const appName = patterns[0] ?? "Telegram";
    const script = `
tell application "System Events"
  if not (exists process "${appName}") then return ""
  tell process "${appName}"
    set frontmost to true
    try
      set b to bounds of window 1
      return (item 1 of b as text) & "," & (item 2 of b as text) & "," & (item 3 of b as text) & "," & (item 4 of b as text)
    end try
  end tell
end tell
`;
    try {
      const { stdout } = await execAsync(`osascript -e ${JSON.stringify(script)}`);
      const m = stdout.trim().match(/(-?\d+),(-?\d+),(-?\d+),(-?\d+)/);
      if (!m) return null;
      // mac bounds are left, top, right, bottom already
      return { left: +m[1]!, top: +m[2]!, right: +m[3]!, bottom: +m[4]! };
    } catch {
      return null;
    }
  }
  // linux: wmctrl -lG
  try {
    const { stdout } = await execAsync("wmctrl -lG");
    const line = stdout
      .split("\n")
      .find((l) => patterns.some((p) => l.toLowerCase().includes(p.toLowerCase())));
    if (!line) {
      // try xdotool
      for (const p of patterns) {
        try {
          const { stdout: id } = await execAsync(
            `xdotool search --name --onlyvisible "${p}" | head -n1`,
          );
          const wid = id.trim();
          if (!wid) continue;
          const { stdout: geo } = await execAsync(`xdotool getwindowgeometry --shell ${wid}`);
          const X = Number(geo.match(/^X=(\d+)/m)?.[1] ?? 0);
          const Y = Number(geo.match(/^Y=(\d+)/m)?.[1] ?? 0);
          const W = Number(geo.match(/^WIDTH=(\d+)/m)?.[1] ?? 0);
          const H = Number(geo.match(/^HEIGHT=(\d+)/m)?.[1] ?? 0);
          if (W > 100 && H > 100) return { left: X, top: Y, right: X + W, bottom: Y + H };
        } catch {
          /* next */
        }
      }
      return null;
    }
    // wmctrl -lG: id desk x y w h host title
    const parts = line.trim().split(/\s+/);
    const x = Number(parts[2]);
    const y = Number(parts[3]);
    const w = Number(parts[4]);
    const h = Number(parts[5]);
    return { left: x, top: y, right: x + w, bottom: y + h, title: parts.slice(7).join(" ") };
  } catch {
    return null;
  }
}

export async function focusApp(patterns: string[]): Promise<boolean> {
  const os = osKind();
  if (os === "win32") {
    const names = patterns.map((p) => p.replace(/'/g, "''")).join("|");
    const ps = `
$p = Get-Process | Where-Object { $_.ProcessName -match '${names}' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($p) { $w = New-Object -ComObject WScript.Shell; $w.AppActivate($p.Id) | Out-Null; exit 0 } else { exit 1 }
`;
    try {
      await execAsync(ps, { shell: "powershell.exe" });
      return true;
    } catch {
      return false;
    }
  }
  if (os === "darwin") {
    for (const name of patterns) {
      try {
        await execAsync(`osascript -e 'tell application "${name}" to activate'`);
        return true;
      } catch {
        /* try next name */
      }
    }
    return false;
  }
  for (const name of patterns) {
    try {
      await execAsync(`wmctrl -a "${name}"`);
      return true;
    } catch {
      try {
        const { stdout } = await execAsync(
          `xdotool search --name --onlyvisible "${name}" | head -n1`,
        );
        if (stdout.trim()) {
          await execAsync(`xdotool windowactivate --sync ${stdout.trim()}`);
          return true;
        }
      } catch {
        /* next */
      }
    }
  }
  return false;
}
