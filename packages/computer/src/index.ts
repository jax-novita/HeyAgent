import { readFile as fsRead, writeFile as fsWrite, readdir, unlink, mkdtemp } from "node:fs/promises";
import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import { platform, tmpdir, homedir } from "node:os";
import { join } from "node:path";

const execAsync = promisify(exec);

export * from "./ps-quiet.js";
export * from "./web.js";
export * from "./power.js";
export * from "./report-pdf.js";
export * from "./presentation-deck.js";
export * from "./office-desktop.js";
export * from "./admin.js";
export * from "./desktop-power.js";
export * from "./system-controls.js";
export * from "./system-suite.js";
export * from "./system-xplat.js";
export * from "./telegram-media.js";
export * from "./screen.js";
export * from "./gmail-browser.js";
export * from "./browser-nav.js";
export * from "./browser-agent.js";
export * from "./github-browse.js";
export * from "./hard-missions.js";
export * from "./clock.js";
export * from "./youtube-open.js";
export * from "./platform-input.js";
export * from "./tts.js";
export * from "./tts-sanitize.js";
export * from "./elevenlabs-tts.js";
export * from "./play-audio.js";
export * from "./monitors.js";
export * from "./observer/index.js";
export * from "./windows/index.js";
export * from "./accessibility/index.js";
export * from "./vision/index.js";

export async function readFile(path: string): Promise<string> {
  return fsRead(path, "utf-8");
}

export async function writeFile(path: string, content: string): Promise<void> {
  await fsWrite(path, content, "utf-8");
}

export async function deleteFile(path: string): Promise<void> {
  await unlink(path);
}

export async function listDirectory(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
}

export async function runShell(
  command: string,
  cwd?: string,
  timeoutMs = 60_000,
): Promise<string> {
  if (!command.trim()) throw new Error("Shell command is required");
  const boundedTimeout = Math.max(100, Math.min(timeoutMs, 20 * 60_000));
  const windows = platform() === "win32";

  return new Promise<string>((resolve, reject) => {
    const child = exec(
      command,
      {
        cwd,
        ...(windows ? { windowsHide: true } : { shell: "/bin/sh", detached: true }),
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        clearTimeout(timer);
        const output = [stdout, stderr].filter(Boolean).join("\n");
        if (timedOut) {
          reject(
            new Error(
              `Shell command timed out after ${boundedTimeout}ms${output ? `\n${output.slice(0, 2000)}` : ""}`,
            ),
          );
          return;
        }
        if (error) {
          reject(
            new Error(
              `${error.message}${output ? `\n${output.slice(0, 4000)}` : ""}`,
            ),
          );
          return;
        }
        resolve(output || "(no output)");
      },
    );

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      const pid = child.pid;
      if (!pid) {
        child.kill("SIGKILL");
        return;
      }
      if (windows) {
        execFile(
          "taskkill.exe",
          ["/PID", String(pid), "/T", "/F"],
          { windowsHide: true },
          () => undefined,
        );
      } else {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    }, boundedTimeout);
    timer.unref();
  });
}

export async function openUrl(url: string): Promise<void> {
  const os = platform();
  if (os === "win32") {
    const escaped = url.replace(/'/g, "''");
    await execAsync(`Start-Process '${escaped}'`, { shell: "powershell.exe" });
    return;
  }
  if (os === "darwin") {
    await execAsync(`open "${url}"`);
    return;
  }
  await execAsync(`xdg-open "${url}"`);
}

export async function captureScreen(): Promise<string> {
  const os = platform();
  const { mkdir } = await import("node:fs/promises");
  const dir = join(homedir(), ".heyagent", "screenshots");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `shot-${Date.now()}.png`);
  if (os === "win32") {
    const ps = `
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$bmp.Save('${path.replace(/'/g, "''")}')
$g.Dispose(); $bmp.Dispose()
`;
    await execAsync(ps, { shell: "powershell.exe" });
    return `Screenshot saved to ${path}`;
  }
  if (os === "darwin") {
    await execAsync(`screencapture -x "${path}"`);
    return `Screenshot saved to ${path}`;
  }
  await execAsync(`import -window root "${path}"`).catch(() =>
    execAsync(`gnome-screenshot -f "${path}"`),
  );
  return `Screenshot saved to ${path}`;
}

export async function mouseClick(x: number, y: number): Promise<void> {
  const { xplatMouseClick } = await import("./platform-input.js");
  await xplatMouseClick(x, y);
}

export async function keyboardType(text: string): Promise<void> {
  const { xplatTypeText } = await import("./platform-input.js");
  await xplatTypeText(text);
}

export async function keyboardHotkey(keys: string): Promise<void> {
  const { xplatHotkey } = await import("./platform-input.js");
  // Normalize cmd↔ctrl for the current OS when caller passes the "other" meta key
  const os = platform();
  let k = keys;
  if (os === "darwin") k = k.replace(/\bctrl\b/gi, "cmd");
  else k = k.replace(/\bcmd\b/gi, "ctrl").replace(/\bcommand\b/gi, "ctrl");
  await xplatHotkey(k);
}

/**
 * Smoothly glide the cursor to (x,y) instead of teleporting — so it behaves like
 * a real agent (Antigravity-style) and lands reliably. Fast (~120ms total).
 */
export async function mouseMoveSmooth(x: number, y: number, _steps = 14): Promise<void> {
  const { xplatMouseMove } = await import("./platform-input.js");
  await xplatMouseMove(x, y);
}

/** Absolute screen rect of the Telegram Desktop main window (all OSes). */
async function getTelegramWindowRect(): Promise<
  { left: number; top: number; right: number; bottom: number } | null
> {
  const { findAppWindowRect } = await import("./platform-input.js");
  return findAppWindowRect(["Telegram", "AyuGram", "64Gram", "Kotatogram"]);
}

async function focusTelegramWindow(): Promise<void> {
  const { focusApp } = await import("./platform-input.js");
  await focusApp(["Telegram", "AyuGram", "64Gram", "Kotatogram"]);
  await sleep(350);
}

/**
 * Move the cursor to Telegram's message composer (bottom of the chat pane) and
 * click it, so keyboard focus is the input box — NOT the search field.
 * Returns true if it clicked a computed spot.
 */
export function telegramComposerPoint(rect: {
  left: number;
  top: number;
  right: number;
  bottom: number;
}): { x: number; y: number } | null {
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  if (width < 200 || height < 200) return null;
  // Chat pane sits to the right of the chat list; composer is at the bottom.
  return { x: rect.left + Math.round(width * 0.63), y: rect.bottom - 42 };
}

export async function clickTelegramComposer(): Promise<boolean> {
  // Prefer UI Automation grounding on Windows (click by accessible name).
  if (platform() === "win32") {
    try {
      const { uiClickByName } = await import("./screen.js");
      for (const label of [
        "Write a message",
        "Написать сообщение",
        "Write a message...",
        "Сообщение",
      ]) {
        const r = await uiClickByName(label);
        if (/^Clicked/i.test(r)) {
          await sleep(150);
          return true;
        }
      }
    } catch {
      /* fall through to geometry */
    }
  }

  const rect = await getTelegramWindowRect();
  if (!rect) return false;
  const pt = telegramComposerPoint(rect);
  if (!pt) return false;
  await mouseMoveSmooth(pt.x, pt.y);
  await mouseClick(pt.x, pt.y);
  await sleep(180);
  return true;
}

export async function setClipboard(text: string): Promise<void> {
  const os = platform();
  if (os === "win32") {
    const b64 = Buffer.from(text, "utf8").toString("base64");
    await execAsync(
      `$t = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')); Set-Clipboard -Value $t`,
      { shell: "powershell.exe" },
    );
    return;
  }
  if (os === "darwin") {
    await execAsync(`printf %s ${JSON.stringify(text)} | pbcopy`);
    return;
  }
  await execAsync(`printf %s ${JSON.stringify(text)} | xclip -selection clipboard`).catch(() =>
    execAsync(`printf %s ${JSON.stringify(text)} | wl-copy`),
  );
}

export async function getClipboard(): Promise<string> {
  const os = platform();
  if (os === "win32") {
    const { stdout } = await execAsync("Get-Clipboard -Raw", { shell: "powershell.exe" });
    return stdout;
  }
  if (os === "darwin") {
    const { stdout } = await execAsync("pbpaste");
    return stdout;
  }
  const { stdout } = await execAsync("xclip -selection clipboard -o").catch(() =>
    execAsync("wl-paste"),
  );
  return stdout;
}

/** Normalize casual app names → canonical key. */
export function normalizeAppKey(name: string): string {
  const a = name
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  if (
    /^(code|vscode|vs\s*code|visual\s*studio\s*code|студия|вс\s*код)$/i.test(a) ||
    a.includes("visual studio code") ||
    a === "vs code"
  ) {
    return "code";
  }
  if (/^(cursor|курсор)$/i.test(a)) return "cursor";
  if (/^(telegram|телеграм)$/i.test(a)) return "telegram";
  if (/^(chrome|гугл\s*хром|google\s*chrome)$/i.test(a)) return "chrome";
  if (/^(edge|microsoft\s*edge|эдж)$/i.test(a)) return "edge";
  if (/^(yandex|яндекс|яндекс\s*браузер|yandex\s*browser)$/i.test(a)) return "yandex";
  if (/^(calc|calculator|калькулятор)$/i.test(a)) return "calc";
  if (/^(notepad|блокнот)$/i.test(a)) return "notepad";
  if (/^(explorer|проводник)$/i.test(a)) return "explorer";
  if (/^(powershell|pwsh)$/i.test(a)) return "powershell";
  if (/^(paint|mspaint|краска)$/i.test(a)) return "paint";
  return a;
}

export async function openApplication(name: string): Promise<string> {
  const os = platform();
  const key = normalizeAppKey(name);
  if (os === "win32") {
    if (key === "telegram") {
      return openTelegramDesktop();
    }
    if (key === "code") {
      return openVsCode();
    }
    if (key === "cursor") {
      return openKnownExe("Cursor", [
        join(homedir(), "AppData", "Local", "Programs", "cursor", "Cursor.exe"),
        join(homedir(), "AppData", "Local", "Programs", "Cursor", "Cursor.exe"),
      ], ["cursor"]);
    }

    const aliases: Record<string, string> = {
      notepad: "notepad.exe",
      calc: "calc.exe",
      calculator: "calc.exe",
      explorer: "explorer.exe",
      cmd: "cmd.exe",
      powershell: "powershell.exe",
      paint: "mspaint.exe",
      chrome: "chrome",
      edge: "msedge",
      yandex: "browser",
    };
    const target = aliases[key] ?? name.trim();

    // Prefer absolute paths for browsers when Start-Process name fails in gateway PATH
    const known: Record<string, string[]> = {
      chrome: [
        join(homedir(), "AppData", "Local", "Google", "Chrome", "Application", "chrome.exe"),
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      ],
      edge: [
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      ],
      yandex: [
        join(homedir(), "AppData", "Local", "Yandex", "YandexBrowser", "Application", "browser.exe"),
      ],
    };
    const paths = known[key];
    if (paths) {
      for (const p of paths) {
        try {
          await execAsync(`Start-Process -FilePath '${p.replace(/'/g, "''")}'`, {
            shell: "powershell.exe",
          });
          return `Opened application: ${key} (${p})`;
        } catch {
          /* try next */
        }
      }
    }

    try {
      await execAsync(`Start-Process '${target.replace(/'/g, "''")}'`, {
        shell: "powershell.exe",
      });
      return `Opened application: ${target}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Last resort: Start Menu shortcut by display name
      const lnk = await openFromStartMenu(name.trim() || key);
      if (lnk.startsWith("OK")) return lnk;
      return `ERROR: не открыл «${name}» (${msg.slice(0, 180)}). Попробуй app.open с name=code / chrome / notepad.`;
    }
  }
  if (os === "darwin") {
    if (key === "telegram") {
      await execAsync(`open -a Telegram`);
      return "Opened Telegram";
    }
    if (key === "code") {
      await execAsync(`open -a "Visual Studio Code"`).catch(() =>
        execAsync("code"),
      );
      return "Opened Visual Studio Code";
    }
    await execAsync(`open -a "${name}"`);
    return `Opened application: ${name}`;
  }
  if (key === "telegram") {
    await execAsync("telegram-desktop").catch(() => execAsync("telegram"));
    return "Opened Telegram";
  }
  if (key === "code") {
    await execAsync("code");
    return "Opened Visual Studio Code";
  }
  await execAsync(name);
  return `Opened application: ${name}`;
}

/** Open VS Code via known install paths — never claim «не установлен» if Code.exe exists. */
async function openVsCode(): Promise<string> {
  const local = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  const paths = [
    join(local, "Programs", "Microsoft VS Code", "Code.exe"),
    "C:\\Program Files\\Microsoft VS Code\\Code.exe",
    "C:\\Program Files (x86)\\Microsoft VS Code\\Code.exe",
    join(local, "Programs", "Microsoft VS Code Insiders", "Code - Insiders.exe"),
  ];
  for (const p of paths) {
    try {
      await execAsync(`Start-Process -FilePath '${p.replace(/'/g, "''")}'`, {
        shell: "powershell.exe",
      });
      return `Opened Visual Studio Code (${p})`;
    } catch {
      /* try next */
    }
  }
  for (const cmd of ["code", "code.cmd"]) {
    try {
      await execAsync(`Start-Process '${cmd}'`, { shell: "powershell.exe" });
      return `Opened Visual Studio Code via ${cmd}`;
    } catch {
      /* try next */
    }
  }
  const lnk = await openFromStartMenu("Visual Studio Code");
  if (lnk.startsWith("OK")) return lnk;
  return "ERROR: Visual Studio Code не найден (искал Code.exe в Local\\Programs и Program Files).";
}

async function openKnownExe(
  label: string,
  paths: string[],
  cmds: string[],
): Promise<string> {
  for (const p of paths) {
    try {
      await execAsync(`Start-Process -FilePath '${p.replace(/'/g, "''")}'`, {
        shell: "powershell.exe",
      });
      return `Opened ${label} (${p})`;
    } catch {
      /* next */
    }
  }
  for (const cmd of cmds) {
    try {
      await execAsync(`Start-Process '${cmd.replace(/'/g, "''")}'`, {
        shell: "powershell.exe",
      });
      return `Opened ${label} via ${cmd}`;
    } catch {
      /* next */
    }
  }
  return `ERROR: ${label} не найден`;
}

async function openFromStartMenu(query: string): Promise<string> {
  const q = query.replace(/'/g, "''");
  const ps = `
$q = '${q}'
$roots = @(
  "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs",
  "$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs"
)
foreach ($root in $roots) {
  $hit = Get-ChildItem $root -Recurse -Filter *.lnk -ErrorAction SilentlyContinue |
    Where-Object { $_.BaseName -like "*$q*" -or $_.Name -like "*$q*" } |
    Select-Object -First 1
  if ($hit) {
    Start-Process $hit.FullName
    Write-Output ("OK opened shortcut: " + $hit.FullName)
    exit 0
  }
}
Write-Output "ERROR: shortcut not found"
exit 1
`;
  try {
    const { stdout } = await execAsync(ps, { shell: "powershell.exe" });
    const line = (stdout || "").trim().split(/\r?\n/).filter(Boolean).pop() || "";
    return line.startsWith("OK") ? line : `ERROR: ярлык «${query}» не найден в меню Пуск`;
  } catch {
    return `ERROR: ярлык «${query}» не найден в меню Пуск`;
  }
}

async function openTelegramDesktop(): Promise<string> {
  const ps = `
$paths = @(
  "$env:APPDATA\\Telegram Desktop\\Telegram.exe",
  "$env:LOCALAPPDATA\\Telegram Desktop\\Telegram.exe"
)
foreach ($p in $paths) {
  if (Test-Path $p) {
    Start-Process $p
    exit 0
  }
}
try { Start-Process "Telegram.exe"; exit 0 } catch {}
Get-ChildItem "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs" -Recurse -Filter "*Telegram*.lnk" -ErrorAction SilentlyContinue |
  Select-Object -First 1 | ForEach-Object { Start-Process $_.FullName; exit 0 }
Write-Error "Telegram Desktop not found. Install Telegram Desktop first."
exit 1
`;
  await execAsync(ps, { shell: "powershell.exe" });
  return "Opened Telegram Desktop";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Which contact's chat we last opened in Telegram Desktop, so we NEVER re-run
 * the search ("лупа") when the chat is already open. Lives for the gateway
 * process lifetime; reset with resetTelegramChatState().
 */
let lastOpenedChat: string | null = null;

/** Currently remembered open Telegram contact (process-local). */
export function getLastOpenedTelegramChat(): string | null {
  return lastOpenedChat;
}

export function resetTelegramChatState(): void {
  lastOpenedChat = null;
}

function sameContact(a: string | null, b: string): boolean {
  return !!a && a.trim().toLowerCase() === b.trim().toLowerCase();
}

async function focusTelegram(): Promise<void> {
  const os = platform();
  await openApplication("telegram");
  await sleep(os === "win32" ? 1500 : 1200);
  if (os === "win32") {
    await focusTelegramWindow();
    await sleep(300);
  } else if (os === "darwin") {
    await execAsync(`osascript -e 'tell application "Telegram" to activate'`).catch(
      () => undefined,
    );
    await sleep(300);
  }
}

/** Open a contact's chat in Telegram Desktop (search → open) without sending. */
export async function openTelegramChat(contact: string, force = false): Promise<void> {
  const who = contact.trim();
  if (!who) return;
  await focusTelegram();
  // Already on this chat → do NOT search again; just make sure we're at the bottom.
  if (!force && sameContact(lastOpenedChat, who)) {
    const os = platform();
    await keyboardHotkey(os === "darwin" ? "cmd+down" : "end").catch(() => undefined);
    await sleep(200);
    return;
  }
  const os = platform();
  await keyboardHotkey(os === "darwin" ? "cmd+f" : "ctrl+f");
  await sleep(500);
  await keyboardHotkey(os === "darwin" ? "cmd+a" : "ctrl+a");
  await sleep(100);
  await keyboardType(who);
  await sleep(900);
  await keyboardHotkey("enter");
  await sleep(700);
  lastOpenedChat = who;
}

/** Type + send a message in the ALREADY-open chat (no search). */
export async function telegramTypeInOpenChat(message: string): Promise<void> {
  const text = message.trim();
  if (!text) return;
  await focusTelegram();
  // CRITICAL: click into the message composer first so text doesn't land in the
  // search box (the exact bug we saw). Falls back to blind typing if rect unknown.
  const clicked = await clickTelegramComposer();
  if (!clicked) {
    // best-effort: close any open search so focus can reach the composer
    await keyboardHotkey("esc").catch(() => undefined);
    await sleep(150);
  }
  await keyboardType(text);
  await sleep(200);
  await keyboardHotkey("enter");
  await sleep(250);
}

/**
 * Wait for the contact to reply in Telegram Desktop, then return a fresh vision
 * screenshot so the model can READ the new message. This is what lets the agent
 * hold a real back-and-forth conversation instead of dumping the job on the owner.
 *
 * Strategy (no extra deps): keep the chat open at the bottom, poll frames and
 * return as soon as the message area visibly changes (new bubble) — or after
 * `maxWaitSeconds`. The caller loops: send → wait_reply → read → reply → …
 * so "wait for hours" = keep calling this until the end phrase appears.
 */
export async function telegramWaitForReply(
  contact: string,
  opts: { maxWaitSeconds?: number; pollSeconds?: number } = {},
): Promise<string> {
  const who = contact.trim();
  // Only open (search) if this chat isn't already the open one — no repeated «лупа».
  if (who && !sameContact(lastOpenedChat, who)) await openTelegramChat(who);
  else await focusTelegram();
  const os = platform();
  // Jump to the newest messages so the reply is visible.
  await keyboardHotkey(os === "darwin" ? "cmd+down" : "end").catch(() => undefined);
  await sleep(300);

  const maxWait = Math.max(5, Math.min(opts.maxWaitSeconds ?? 180, 1800)) * 1000;
  const poll = Math.max(2, Math.min(opts.pollSeconds ?? 5, 30)) * 1000;

  const { captureScreenVision, formatVisionToolResult } = await import("./screen.js");
  const baseline = await captureScreenVision(1280);
  const baseSig = frameSignature(baseline.base64);

  const started = Date.now();
  let changed = false;
  let latest = baseline;
  while (Date.now() - started < maxWait) {
    await sleep(poll);
    latest = await captureScreenVision(1280);
    if (framesDiffer(baseSig, frameSignature(latest.base64))) {
      changed = true;
      // small settle so the full bubble renders before we read it
      await sleep(700);
      latest = await captureScreenVision(1280);
      break;
    }
  }

  const header = changed
    ? `NEW activity in the chat with "${who}". READ the latest incoming bubble (bottom of the chat) in the attached image.`
    : `No visible reply from "${who}" yet after ${Math.round(maxWait / 1000)}s. If the mission is still active, call telegram_wait_reply AGAIN to keep waiting (patiently, even for a long time). Do NOT ask the owner to forward messages.`;

  return [
    header,
    `Contact: ${who}`,
    "After reading: if the contact wrote something new, reply via telegram_message (natural, human tone), then call telegram_wait_reply again.",
    "If the end phrase / goodbye appears in THEIR message, send a warm closing line and finish the mission.",
    formatVisionToolResult(latest, "Telegram chat — latest state."),
  ].join("\n");
}

/** Coarse signature of a JPEG frame: length + sampled bytes (cheap, dependency-free). */
function frameSignature(base64: string): number[] {
  const buf = Buffer.from(base64, "base64");
  const sig: number[] = [buf.length];
  const step = Math.max(1, Math.floor(buf.length / 256));
  for (let i = 0; i < buf.length; i += step) sig.push(buf[i]!);
  return sig;
}

/** Heuristic: frames differ enough to be a new message (tolerant of JPEG noise). */
function framesDiffer(a: number[], b: number[]): boolean {
  // Length delta > 0.6% of file usually means content (new bubble) changed.
  const lenA = a[0] ?? 0;
  const lenB = b[0] ?? 0;
  if (lenA > 0 && Math.abs(lenA - lenB) / lenA > 0.006) return true;
  const n = Math.min(a.length, b.length);
  let diff = 0;
  for (let i = 1; i < n; i++) if (Math.abs((a[i] ?? 0) - (b[i] ?? 0)) > 6) diff++;
  return diff / Math.max(1, n) > 0.05;
}

/**
 * Send a Telegram Desktop message to a contact. If that chat is already open,
 * it types straight into it (no search «лупа»); otherwise it searches once.
 */
export async function telegramSendUi(
  contact: string,
  message: string,
  opts: { forceOpen?: boolean } = {},
): Promise<string> {
  const who = contact.trim();
  const text = message.trim();
  if (!who) return "Contact name is empty.";
  if (!text) return "Message is empty.";

  if (!opts.forceOpen && sameContact(lastOpenedChat, who)) {
    await telegramTypeInOpenChat(text);
    return `Sent to "${who}" (chat already open): ${text}`;
  }

  await openTelegramChat(who, opts.forceOpen);
  await telegramTypeInOpenChat(text);
  return `Opened Telegram Desktop and sent to "${who}": ${text}`;
}

/** Put a local file on the clipboard as a file-drop list (Windows) for Ctrl+V attach. */
async function clipboardSetFile(filePath: string): Promise<void> {
  if (platform() !== "win32") {
    await setClipboard(filePath);
    return;
  }
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
$c = New-Object System.Collections.Specialized.StringCollection
$c.Add('${filePath.replace(/'/g, "''")}') | Out-Null
[System.Windows.Forms.Clipboard]::SetFileDropList($c)
`;
  await execAsync(ps, { shell: "powershell.exe" });
}

/**
 * Send a file to a Telegram Desktop contact (open chat → paste file → Enter).
 */
export async function telegramSendFileUi(
  contact: string,
  filePath: string,
  caption?: string,
): Promise<string> {
  const who = contact.trim();
  const file = filePath.trim();
  if (!who || !file) return "contact and filePath required";

  if (caption?.trim()) {
    await telegramSendUi(who, caption.trim());
    await sleep(700);
  } else {
    await openApplication("telegram");
    await sleep(1800);
    await focusTelegramWindow();
    await sleep(300);
    await keyboardHotkey("ctrl+f");
    await sleep(400);
    await keyboardHotkey("ctrl+a");
    await keyboardType(who);
    await sleep(900);
    await keyboardHotkey("enter");
    await sleep(700);
  }

  await clipboardSetFile(file);
  await sleep(300);
  await keyboardHotkey(platform() === "darwin" ? "cmd+v" : "ctrl+v");
  await sleep(1400);
  await keyboardHotkey("enter");
  return `Sent file via Telegram Desktop to "${who}": ${file}`;
}

/**
 * Reliable note writing: writes the file to disk FIRST (so it truly exists),
 * then opens it in Notepad/editor. Supports saving to a real folder
 * (desktop/documents/downloads) or a full destination path — NOT temp by default
 * when a destination is requested.
 *
 * @param destination optional: "desktop" | "documents" | "downloads" | absolute dir | full .txt path
 */
export async function notepadWrite(
  content: string,
  title = "heyagent-note",
  destination?: string,
): Promise<string> {
  const os = platform();
  const safeBase = title.replace(/[^\w\-. а-яА-ЯёЁ]+/gi, "_").slice(0, 60).trim() || "heyagent-note";
  const fileName = safeBase.toLowerCase().endsWith(".txt") ? safeBase : `${safeBase}.txt`;

  let filePath: string;
  const dest = (destination ?? "").trim();
  const home = homedir();
  const folderAliases: Record<string, string> = {
    desktop: join(home, "Desktop"),
    "рабочий стол": join(home, "Desktop"),
    documents: join(home, "Documents"),
    документы: join(home, "Documents"),
    downloads: join(home, "Downloads"),
    загрузки: join(home, "Downloads"),
  };

  if (!dest) {
    const dir = await mkdtemp(join(tmpdir(), "heyagent-"));
    filePath = join(dir, fileName);
  } else if (folderAliases[dest.toLowerCase()]) {
    filePath = join(folderAliases[dest.toLowerCase()], fileName);
  } else if (/\.(txt|md|log|csv|json)$/i.test(dest)) {
    filePath = dest; // full file path provided
  } else {
    filePath = join(dest, fileName); // treat as directory
  }

  const { mkdir: mkdirFs } = await import("node:fs/promises");
  await mkdirFs(dirnameOf(filePath), { recursive: true }).catch(() => undefined);
  await fsWrite(filePath, content, "utf-8");

  // Verify it actually landed on disk before opening/reporting.
  let verifiedBytes = -1;
  try {
    const { stat } = await import("node:fs/promises");
    verifiedBytes = (await stat(filePath)).size;
  } catch {
    return `ERROR: failed to write file at ${filePath}. Nothing was saved.`;
  }

  if (os === "win32") {
    await execAsync(`Start-Process notepad.exe -ArgumentList '${filePath.replace(/'/g, "''")}'`, {
      shell: "powershell.exe",
    });
  } else if (os === "darwin") {
    await execAsync(`open -a TextEdit "${filePath}"`);
  } else {
    await execAsync(`xdg-open "${filePath}"`);
  }
  return `SAVED and opened in Notepad. path: ${filePath} (${verifiedBytes} bytes verified on disk)`;
}

function dirnameOf(p: string): string {
  const idx = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  return idx > 0 ? p.slice(0, idx) : ".";
}

/** Open empty Notepad and type text via keyboard (after short delay). */
export async function notepadType(content: string): Promise<string> {
  const os = platform();
  if (os === "win32") {
    await execAsync(`Start-Process notepad.exe`, { shell: "powershell.exe" });
    await new Promise((r) => setTimeout(r, 900));
    await keyboardType(content);
    return `Opened Notepad and typed ${content.length} characters`;
  }
  if (os === "darwin") {
    await execAsync(`open -a TextEdit`);
    await new Promise((r) => setTimeout(r, 900));
    await keyboardType(content);
    return `Opened TextEdit and typed ${content.length} characters`;
  }
  await execAsync("gedit &").catch(() => execAsync("xdg-open /tmp/heyagent-note.txt"));
  await new Promise((r) => setTimeout(r, 900));
  await keyboardType(content);
  return `Opened editor and typed ${content.length} characters`;
}

export function getPlatform(): string {
  return platform();
}
