/**
 * Reliable same-tab browser tours via Chromium DevTools Protocol (CDP).
 * Ctrl+L SendKeys is flaky (focus often stays on the terminal) — CDP is not.
 */
import { exec, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { platform, tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

const execAsync = promisify(exec);

export type PreferredBrowser = "yandex" | "chrome" | "edge" | "auto";

const CDP_PORT = 9333;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function resolveBrowserExes(preferred: PreferredBrowser): string[] {
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
  // Prefer Chrome/Edge for CDP reliability; Yandex first only when explicitly requested.
  if (preferred === "yandex") return [...yandex, ...chrome, ...edge];
  if (preferred === "chrome") return [...chrome, ...edge, ...yandex];
  if (preferred === "edge") return [...edge, ...chrome, ...yandex];
  return [...chrome, ...edge, ...yandex];
}

async function cdpHttp<T>(path: string): Promise<T> {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}${path}`);
  if (!res.ok) throw new Error(`CDP HTTP ${res.status} ${path}`);
  return (await res.json()) as T;
}

async function waitForCdp(timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await cdpHttp<{ Browser?: string }>("/json/version");
      return;
    } catch {
      await sleep(300);
    }
  }
  throw new Error("CDP not ready (browser did not open remote debugging port)");
}

type CdpTarget = {
  id: string;
  type: string;
  url: string;
  webSocketDebuggerUrl?: string;
  title?: string;
};

async function pickPageTarget(): Promise<CdpTarget> {
  const list = await cdpHttp<CdpTarget[]>("/json/list");
  const pages = list.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
  const nonEmpty =
    pages.find((p) => p.url && !p.url.startsWith("chrome://") && !p.url.startsWith("about:")) ??
    pages[0];
  if (!nonEmpty?.webSocketDebuggerUrl) {
    throw new Error("No CDP page target with websocket");
  }
  return nonEmpty;
}

class CdpSession {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.addEventListener("message", (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as {
          id?: number;
          result?: unknown;
          error?: { message?: string };
        };
        if (msg.id == null) return;
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message ?? "CDP error"));
        else p.resolve(msg.result);
      } catch {
        /* ignore */
      }
    });
  }

  static async connect(wsUrl: string): Promise<CdpSession> {
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", () => reject(new Error("CDP websocket failed")));
    });
    return new CdpSession(ws);
  }

  async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params: params ?? {} });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(payload);
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 20000);
    });
  }

  async navigate(url: string): Promise<void> {
    await this.send("Page.enable");
    await this.send("Page.navigate", { url });
    // Wait for load (best-effort)
    await sleep(1600);
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

let launchedProc: ChildProcess | null = null;

async function launchCdpBrowser(
  exe: string,
  firstUrl: string,
): Promise<string> {
  // Keep in sync with browser-agent: REAL profile by default.
  const useReal =
    process.env.HEYAGENT_BROWSER_GUEST !== "1" &&
    process.env.HEYAGENT_BROWSER_REAL_PROFILE !== "0";
  const profile = useReal
    ? resolveNavUserDataDir(exe)
    : join(tmpdir(), "heyagent-cdp-profile");
  try {
    mkdirSync(profile, { recursive: true });
  } catch {
    /* ignore */
  }

  if (platform() === "win32") {
    await execAsync(
      `Get-NetTCPConnection -LocalPort ${CDP_PORT} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`,
      { shell: "powershell.exe" },
    ).catch(() => undefined);
    await sleep(400);
  }

  if (useReal) {
    const lower = exe.toLowerCase();
    if (platform() === "win32") {
      let pathGlob = "*Google*Chrome*";
      if (lower.includes("yandex")) pathGlob = "*Yandex*YandexBrowser*";
      else if (lower.includes("msedge") || lower.includes("edge")) pathGlob = "*Microsoft*Edge*";
      await execAsync(
        `Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -like ${JSON.stringify(pathGlob)} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
        { shell: "powershell.exe" },
      ).catch(() => undefined);
      await sleep(800);
    }
  }

  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
  ];
  const url = (firstUrl || "").trim();
  if (useReal && (!url || url === "about:blank")) {
    args.push("--restore-last-session");
  } else {
    if (!useReal) args.push("--new-window");
    args.push(url || "about:blank");
  }

  launchedProc = spawn(exe, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  launchedProc.unref();

  await waitForCdp(20000);
  return exe;
}

function resolveNavUserDataDir(exe: string): string {
  const lower = exe.toLowerCase();
  const os = platform();
  if (os === "darwin") {
    const support = join(homedir(), "Library", "Application Support");
    if (lower.includes("yandex")) return join(support, "Yandex", "YandexBrowser");
    if (lower.includes("edge")) return join(support, "Microsoft Edge");
    return join(support, "Google", "Chrome");
  }
  if (os === "linux") {
    const cfg = join(homedir(), ".config");
    if (lower.includes("yandex")) return join(cfg, "yandex-browser");
    if (lower.includes("edge")) return join(cfg, "microsoft-edge");
    return join(cfg, "google-chrome");
  }
  const local = process.env.LOCALAPPDATA ?? "";
  if (lower.includes("yandex")) return join(local, "Yandex", "YandexBrowser", "User Data");
  if (lower.includes("msedge") || lower.includes("edge")) {
    return join(local, "Microsoft", "Edge", "User Data");
  }
  return join(local, "Google", "Chrome", "User Data");
}

async function ensureCdpPage(firstUrl: string, preferred: PreferredBrowser): Promise<CdpSession> {
  // Reuse existing CDP if still up
  try {
    await cdpHttp("/json/version");
    const target = await pickPageTarget();
    const session = await CdpSession.connect(target.webSocketDebuggerUrl!);
    await session.navigate(firstUrl);
    return session;
  } catch {
    /* launch fresh */
  }

  const exes = resolveBrowserExes(preferred).filter((p) => existsSync(p));
  if (!exes.length) {
    throw new Error("No Chrome/Edge/Yandex found for CDP navigation");
  }

  let lastErr: unknown;
  for (const exe of exes) {
    try {
      await launchCdpBrowser(exe, firstUrl);
      const target = await pickPageTarget();
      return await CdpSession.connect(target.webSocketDebuggerUrl!);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Open URL in a NEW window (legacy helper; prefer browserTourSameTab). */
export async function browserOpenNew(
  url: string,
  preferred: PreferredBrowser = "auto",
): Promise<string> {
  const session = await ensureCdpPage(url, preferred);
  session.close();
  return `CDP open: ${url}`;
}

export async function browserNavigateSameTab(
  url: string,
  _preferred: PreferredBrowser = "auto",
): Promise<void> {
  const target = await pickPageTarget();
  const session = await CdpSession.connect(target.webSocketDebuggerUrl!);
  try {
    await session.navigate(url);
  } finally {
    session.close();
  }
}

/**
 * Tour URLs in ONE tab via CDP Page.navigate (reliable).
 */
export async function browserTourSameTab(
  urls: string[],
  preferred: PreferredBrowser = "auto",
  settleMs = 1400,
): Promise<string> {
  const list = urls.map((u) => u.trim()).filter(Boolean);
  if (!list.length) return "ERROR: no URLs";

  const session = await ensureCdpPage(list[0]!, preferred);
  try {
    await sleep(Math.min(settleMs, 1200));
    for (let i = 1; i < list.length; i++) {
      await session.navigate(list[i]!);
      await sleep(Math.min(settleMs, 1400));
    }
  } finally {
    session.close();
  }

  return `Opened ${list.length} pages in ONE CDP tab. Final: ${list[list.length - 1]}`;
}

export async function focusPreferredBrowser(
  _preferred: PreferredBrowser = "auto",
): Promise<void> {
  // CDP owns the dedicated window; focus is optional.
  if (platform() !== "win32") return;
  await execAsync(
    `
$p = Get-Process chrome,msedge,browser -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($p) {
  Add-Type @"
using System; using System.Runtime.InteropServices;
public class F { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); }
"@
  [F]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
}
`,
    { shell: "powershell.exe" },
  ).catch(() => undefined);
}
