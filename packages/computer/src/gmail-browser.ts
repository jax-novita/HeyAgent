/**
 * Drive Gmail through the real browser (new tab) + compose URL / keyboard.
 * No OAuth required for open/compose/reply UI actions.
 */
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { platform } from "node:os";
import { join } from "node:path";

const execAsync = promisify(exec);

const GMAIL_INBOX = "https://mail.google.com/mail/u/0/#inbox";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function pasteText(text: string): Promise<void> {
  if (platform() === "win32") {
    const b64 = Buffer.from(text, "utf8").toString("base64");
    await execAsync(
      `$t = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')); Set-Clipboard -Value $t; Start-Sleep -Milliseconds 200; Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("^v")`,
      { shell: "powershell.exe" },
    );
    return;
  }
  await execAsync(
    `printf %s ${JSON.stringify(text)} | xclip -selection clipboard; xdotool key ctrl+v`,
  ).catch(() => undefined);
}

async function hotkey(keys: string): Promise<void> {
  if (platform() !== "win32") {
    await execAsync(`xdotool key ${keys.replace(/\+/g, "+")}`).catch(() => undefined);
    return;
  }
  const map: Record<string, string> = {
    ctrl: "^",
    control: "^",
    alt: "%",
    shift: "+",
    enter: "{ENTER}",
    tab: "{TAB}",
    esc: "{ESC}",
    escape: "{ESC}",
    r: "r",
  };
  const parts = keys.toLowerCase().split("+").map((p) => p.trim());
  let seq = "";
  for (const p of parts) {
    seq += map[p] ?? (p.length === 1 ? p : `{${p.toUpperCase()}}`);
  }
  await execAsync(
    `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("${seq.replace(/"/g, '""')}")`,
    { shell: "powershell.exe" },
  );
}

export type MailBrowser = "yandex" | "chrome" | "edge" | "auto";

function resolveBrowserExes(preferred: MailBrowser): string[] {
  const local = process.env.LOCALAPPDATA ?? "";
  const pf = process.env.ProgramFiles ?? "C:\\Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const yandex = [
    join(local, "Yandex", "YandexBrowser", "Application", "browser.exe"),
    join(pf, "Yandex", "YandexBrowser", "Application", "browser.exe"),
    join(pf86, "Yandex", "YandexBrowser", "Application", "browser.exe"),
  ];
  const chrome = [
    join(pf, "Google", "Chrome", "Application", "chrome.exe"),
    join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
    join(local, "Google", "Chrome", "Application", "chrome.exe"),
  ];
  const edge = [
    join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
    join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
  ];
  if (preferred === "yandex") return [...yandex, ...chrome, ...edge];
  if (preferred === "chrome") return [...chrome, ...yandex, ...edge];
  if (preferred === "edge") return [...edge, ...yandex, ...chrome];
  // Default: Yandex first (separate Gmail accounts live there for this user)
  return [...yandex, ...chrome, ...edge];
}

async function openInBrowserNewTab(
  url: string,
  preferred: MailBrowser = "auto",
): Promise<string> {
  const os = platform();
  if (os === "win32") {
    const { existsSync } = await import("node:fs");
    for (const exe of resolveBrowserExes(preferred)) {
      if (!existsSync(exe)) continue;
      await execAsync(
        `Start-Process -FilePath '${exe.replace(/'/g, "''")}' -ArgumentList '${url.replace(/'/g, "''")}'`,
        { shell: "powershell.exe" },
      );
      const label = /yandex/i.test(exe)
        ? "Yandex Browser"
        : /chrome/i.test(exe)
          ? "Chrome"
          : /msedge|edge/i.test(exe)
            ? "Edge"
            : exe;
      return `Opened Gmail in ${label}: ${url}`;
    }
    await execAsync(`Start-Process '${url.replace(/'/g, "''")}'`, {
      shell: "powershell.exe",
    });
    return `Opened Gmail in default browser: ${url}`;
  }
  if (os === "darwin") {
    await execAsync(`open "${url}"`);
    return `Opened: ${url}`;
  }
  await execAsync(`xdg-open "${url}"`);
  return `Opened: ${url}`;
}

/** Bring preferred browser / Gmail window to foreground on Windows. */
export async function focusMailBrowser(preferred: MailBrowser = "auto"): Promise<void> {
  if (platform() !== "win32") return;
  const preferYandex = preferred === "yandex" || preferred === "auto";
  const names = preferYandex
    ? ["Яндекс", "Yandex", "Gmail", "Chrome", "Edge", "Mail"]
    : preferred === "chrome"
      ? ["Chrome", "Gmail", "Яндекс", "Yandex", "Edge", "Mail"]
      : ["Edge", "Gmail", "Яндекс", "Yandex", "Chrome", "Mail"];
  const namesPs = names.map((n) => `"${n}"`).join(", ");
  const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinFocus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
}
"@
$script:target = [IntPtr]::Zero
$names = @(${namesPs})
[WinFocus+EnumWindowsProc]$cb = {
  param($h, $l)
  if (-not [WinFocus]::IsWindowVisible($h)) { return $true }
  $sb = New-Object System.Text.StringBuilder 512
  [void][WinFocus]::GetWindowText($h, $sb, $sb.Capacity)
  $t = $sb.ToString()
  foreach ($n in $names) {
    if ($t -like "*$n*") { $script:target = $h; return $false }
  }
  return $true
}
[WinFocus]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
if ($script:target -ne [IntPtr]::Zero) {
  [WinFocus]::ShowWindowAsync($script:target, 9) | Out-Null
  Start-Sleep -Milliseconds 200
  [WinFocus]::SetForegroundWindow($script:target) | Out-Null
}
`;
  await execAsync(ps, { shell: "powershell.exe" }).catch(() => undefined);
}

export async function gmailBrowserOpen(opts?: {
  browser?: MailBrowser;
}): Promise<string> {
  const browser = opts?.browser ?? "auto";
  const msg = await openInBrowserNewTab(GMAIL_INBOX, browser);
  await sleep(2500);
  await focusMailBrowser(browser);
  return `${msg}\nGmail inbox opened in a new browser tab.`;
}

function buildComposeUrl(opts: {
  to?: string;
  subject?: string;
  body?: string;
}): string {
  const params = new URLSearchParams({ view: "cm", fs: "1" });
  if (opts.to?.trim()) params.set("to", opts.to.trim());
  if (opts.subject?.trim()) params.set("su", opts.subject.trim());
  if (opts.body?.trim()) params.set("body", opts.body.trim());
  return `https://mail.google.com/mail/?${params.toString()}`;
}

export async function gmailBrowserCompose(opts: {
  to: string;
  subject?: string;
  body?: string;
  send?: boolean;
  browser?: MailBrowser;
}): Promise<string> {
  const to = opts.to.trim();
  const browser = opts.browser ?? "auto";
  const url = buildComposeUrl({
    to: to || undefined,
    subject: opts.subject ?? "",
    body: opts.body ?? "",
  });
  const opened = await openInBrowserNewTab(url, browser);
  await sleep(3500);
  await focusMailBrowser(browser);
  await sleep(400);

  const who = to || "(получатель не указан — впиши в окне)";
  if (opts.send) {
    if (!to.includes("@")) {
      return `${opened}\nОкно написания открыто, но без адреса отправлять нельзя. Укажи email.`;
    }
    await hotkey("ctrl+enter");
    await sleep(1500);
    return `${opened}\nПисьмо для ${to} открыто и отправлено (Ctrl+Enter). Тема: ${opts.subject ?? "(без темы)"}`;
  }

  return `${opened}\nОкно «Написать» открыто для ${who}. Тема: ${opts.subject ?? "(без темы)"}. Ещё НЕ отправлено — скажи «отправь».`;
}

export async function gmailBrowserReply(opts: {
  body: string;
  send?: boolean;
  openInboxFirst?: boolean;
  browser?: MailBrowser;
}): Promise<string> {
  const body = opts.body?.trim();
  if (!body) return "ERROR: нужен текст ответа.";
  const browser = opts.browser ?? "auto";

  if (opts.openInboxFirst !== false) {
    await openInBrowserNewTab(GMAIL_INBOX, browser);
    await sleep(3000);
  }
  await focusMailBrowser(browser);
  await sleep(400);

  await hotkey("esc");
  await sleep(200);
  await hotkey("r");
  await sleep(1200);

  await pasteText(body);
  await sleep(400);

  if (opts.send) {
    await hotkey("ctrl+enter");
    await sleep(1200);
    return "Ответ вставлен и отправлен (Reply + Ctrl+Enter). Если фокус был не на письме — открой нужное письмо и повтори.";
  }

  return "Ответ вставлен в Gmail (клавиша r). Ещё НЕ отправлен — скажи «отправь».";
}

export async function gmailBrowserSendOpen(opts?: {
  browser?: MailBrowser;
}): Promise<string> {
  await focusMailBrowser(opts?.browser ?? "auto");
  await sleep(300);
  await hotkey("ctrl+enter");
  await sleep(1000);
  return "Отправлено через Ctrl+Enter в активном окне Gmail.";
}
