/**
 * Hardened CDP browser agent: state, tabs, verify URL, popups, CAPTCHA,
 * scroll, recover. Used by multi-step missions that must not lie about location.
 */
import { exec, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { platform, tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import type { PreferredBrowser } from "./browser-nav.js";

const execAsync = promisify(exec);
const CDP_PORT = 9333;
const STATE_PATH = join(tmpdir(), "heyagent-browser-state.json");

export type BrowserBlocker =
  | "none"
  | "captcha"
  | "login"
  | "popup"
  | "wrong_url"
  | "dead"
  | "timeout";

export interface BrowserPageState {
  url: string;
  title: string;
  blocker: BrowserBlocker;
  blockerDetail?: string;
}

export interface BrowserMissionState {
  missionId: string;
  kind: string;
  step: number;
  steps: string[];
  lastUrl?: string;
  tabIds?: string[];
  cancelled?: boolean;
  updatedAt: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function resolveBrowserExes(preferred: PreferredBrowser): string[] {
  const os = platform();
  if (os === "darwin") {
    const chrome = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      join(homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    ];
    const edge = ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"];
    const yandex = ["/Applications/Yandex.app/Contents/MacOS/Yandex"];
    const brave = ["/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"];
    if (preferred === "yandex") return [...yandex, ...chrome, ...edge, ...brave];
    if (preferred === "edge") return [...edge, ...chrome, ...yandex];
    if (preferred === "chrome") return [...chrome, ...edge, ...yandex, ...brave];
    return [...chrome, ...edge, ...brave, ...yandex];
  }
  if (os === "linux") {
    const chrome = [
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/snap/bin/chromium",
    ];
    const edge = ["/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable"];
    const yandex = ["/usr/bin/yandex-browser", "/usr/bin/yandex-browser-stable"];
    if (preferred === "yandex") return [...yandex, ...chrome, ...edge];
    if (preferred === "edge") return [...edge, ...chrome, ...yandex];
    return [...chrome, ...edge, ...yandex];
  }
  const local = process.env.LOCALAPPDATA ?? "";
  const pf = process.env.ProgramFiles ?? "C:\\Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const yandex = [
    join(local, "Yandex", "YandexBrowser", "Application", "browser.exe"),
    join(pf, "Yandex", "YandexBrowser", "Application", "browser.exe"),
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
  if (preferred === "chrome") return [...chrome, ...edge, ...yandex];
  if (preferred === "edge") return [...edge, ...chrome, ...yandex];
  return [...chrome, ...edge, ...yandex];
}

async function cdpHttp<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}${path}`, init);
  if (!res.ok) throw new Error(`CDP HTTP ${res.status} ${path}`);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

async function waitForCdp(timeoutMs = 20000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await cdpHttp("/json/version");
      return;
    } catch {
      await sleep(300);
    }
  }
  throw new Error("CDP not ready");
}

type CdpTarget = {
  id: string;
  type: string;
  url: string;
  title?: string;
  webSocketDebuggerUrl?: string;
};

export class CdpSession {
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

  async send(method: string, params?: Record<string, unknown>, timeoutMs = 25000): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params ?? {} }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, timeoutMs);
    });
  }

  async navigate(url: string, settleMs = 1600): Promise<void> {
    await this.send("Page.enable");
    await this.send("Page.navigate", { url });
    await sleep(settleMs);
  }

  async evaluate<T = unknown>(expression: string): Promise<T> {
    await this.send("Runtime.enable");
    const result = (await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })) as { result?: { value?: T; description?: string }; exceptionDetails?: unknown };
    if (result.exceptionDetails) {
      throw new Error(`evaluate failed: ${JSON.stringify(result.exceptionDetails).slice(0, 200)}`);
    }
    return result.result?.value as T;
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
let cancelFlag = false;

export function requestBrowserMissionCancel(): void {
  cancelFlag = true;
}

export function resetBrowserMissionCancel(): void {
  cancelFlag = false;
}

export function isBrowserMissionCancelled(): boolean {
  return cancelFlag;
}

export function saveMissionState(state: BrowserMissionState): void {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
}

export function loadMissionState(): BrowserMissionState | null {
  try {
    if (!existsSync(STATE_PATH)) return null;
    return JSON.parse(readFileSync(STATE_PATH, "utf-8")) as BrowserMissionState;
  } catch {
    return null;
  }
}

async function killCdpPortHolders(): Promise<void> {
  const os = platform();
  if (os === "win32") {
    await execAsync(
      `Get-NetTCPConnection -LocalPort ${CDP_PORT} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`,
      { shell: "powershell.exe" },
    ).catch(() => undefined);
  } else {
    // lsof -ti :PORT | xargs kill
    await execAsync(
      `pids=$(lsof -tiTCP:${CDP_PORT} -sTCP:LISTEN 2>/dev/null); [ -n "$pids" ] && kill -9 $pids 2>/dev/null; true`,
      { shell: "/bin/sh" },
    ).catch(() => undefined);
  }
  await sleep(400);
}

/** Real profile (owner logins + open tabs) is DEFAULT. Guest only if explicitly opted out. */
export function shouldUseRealBrowserProfile(): boolean {
  if (process.env.HEYAGENT_BROWSER_GUEST === "1") return false;
  if (process.env.HEYAGENT_BROWSER_REAL_PROFILE === "0") return false;
  // "1", unset, or anything else → real
  return true;
}

function isJunkTabUrl(url: string): boolean {
  const u = (url || "").toLowerCase();
  return (
    !u ||
    u === "about:blank" ||
    u.startsWith("chrome://newtab") ||
    u.startsWith("chrome://new-tab") ||
    u.startsWith("edge://newtab") ||
    u.startsWith("browser://ntp") ||
    u.startsWith("chrome://ntp") ||
    u.startsWith("about:newtab")
  );
}

async function launchCdpBrowser(exe: string, firstUrl: string): Promise<void> {
  // DEFAULT = real User Data (logins + session). Guest temp profile ONLY when
  // HEYAGENT_BROWSER_GUEST=1 or HEYAGENT_BROWSER_REAL_PROFILE=0.
  const useReal = shouldUseRealBrowserProfile();
  const profile = useReal
    ? resolveRealUserDataDir(exe)
    : join(tmpdir(), "heyagent-cdp-profile");
  mkdirSync(profile, { recursive: true });
  await killCdpPortHolders();

  if (useReal) {
    // Chromium refuses a second instance on the same User Data — restart with CDP.
    await killBrowserProcessesForExe(exe);
    await sleep(900);
  }

  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
  ];
  const url = (firstUrl || "").trim();
  const openBlank = !url || url === "about:blank";
  if (useReal && openBlank) {
    // Restore the owner's tabs (Wikipedia, tests, …) — do NOT open a fresh blank window.
    args.push("--restore-last-session");
  } else if (url) {
    if (!useReal) args.push("--new-window");
    args.push(url);
  } else {
    args.push("about:blank");
  }

  launchedProc = spawn(exe, args, { detached: true, stdio: "ignore", windowsHide: false });
  launchedProc.unref();
  await waitForCdp(30000);
  if (useReal && openBlank) {
    // Session restore is async — give tabs time to reappear in CDP.
    await sleep(2000);
  }
}

function resolveRealUserDataDir(exe: string): string {
  const lower = exe.toLowerCase();
  const os = platform();
  if (os === "darwin") {
    const support = join(homedir(), "Library", "Application Support");
    if (lower.includes("yandex")) return join(support, "Yandex", "YandexBrowser");
    if (lower.includes("edge")) return join(support, "Microsoft Edge");
    if (lower.includes("brave")) return join(support, "BraveSoftware", "Brave-Browser");
    return join(support, "Google", "Chrome");
  }
  if (os === "linux") {
    const cfg = join(homedir(), ".config");
    if (lower.includes("yandex")) return join(cfg, "yandex-browser");
    if (lower.includes("edge")) return join(cfg, "microsoft-edge");
    if (lower.includes("chromium")) return join(cfg, "chromium");
    return join(cfg, "google-chrome");
  }
  const local = process.env.LOCALAPPDATA ?? "";
  if (lower.includes("yandex")) {
    return join(local, "Yandex", "YandexBrowser", "User Data");
  }
  if (lower.includes("msedge") || lower.includes("\\edge\\")) {
    return join(local, "Microsoft", "Edge", "User Data");
  }
  return join(local, "Google", "Chrome", "User Data");
}

async function killBrowserProcessesForExe(exe: string): Promise<void> {
  const lower = exe.toLowerCase();
  const os = platform();
  if (os === "win32") {
    // Kill by ExecutablePath so we don't nuke unrelated "browser.exe" apps blindly
    // beyond Yandex (which is named browser.exe under YandexBrowser\Application).
    let pathGlob = "";
    if (lower.includes("yandex")) pathGlob = "*Yandex*YandexBrowser*";
    else if (lower.includes("msedge") || lower.includes("\\edge\\")) pathGlob = "*Microsoft*Edge*";
    else if (lower.includes("chrome")) pathGlob = "*Google*Chrome*";
    else {
      const base = exe.split(/[/\\]/).pop()?.replace(/\.exe$/i, "") || "";
      if (!base) return;
      await execAsync(
        `Get-Process -Name ${JSON.stringify(base)} -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue`,
        { shell: "powershell.exe" },
      ).catch(() => undefined);
      return;
    }
    await execAsync(
      `Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -like ${JSON.stringify(pathGlob)} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
      { shell: "powershell.exe" },
    ).catch(() => undefined);
    return;
  }
  if (os === "darwin") {
    if (lower.includes("yandex")) {
      await execAsync(`pkill -f "Yandex" 2>/dev/null; true`).catch(() => undefined);
    } else if (lower.includes("edge")) {
      await execAsync(`pkill -f "Microsoft Edge" 2>/dev/null; true`).catch(() => undefined);
    } else {
      await execAsync(`pkill -f "Google Chrome" 2>/dev/null; true`).catch(() => undefined);
    }
    return;
  }
  // linux
  if (lower.includes("yandex")) {
    await execAsync(`pkill -f yandex-browser 2>/dev/null; true`).catch(() => undefined);
  } else if (lower.includes("edge")) {
    await execAsync(`pkill -f microsoft-edge 2>/dev/null; true`).catch(() => undefined);
  } else {
    await execAsync(
      `pkill -f google-chrome 2>/dev/null; pkill -f chromium 2>/dev/null; true`,
    ).catch(() => undefined);
  }
}

async function listPages(): Promise<CdpTarget[]> {
  const list = await cdpHttp<CdpTarget[]>("/json/list");
  return (list ?? []).filter((t) => t.webSocketDebuggerUrl);
}

async function createBlankPage(url = "about:blank"): Promise<CdpTarget | null> {
  const encoded = encodeURIComponent(url);
  try {
    const created = await cdpHttp<CdpTarget>(`/json/new?${encoded}`, { method: "PUT" });
    if (created?.webSocketDebuggerUrl) return created;
  } catch {
    /* some Chromium builds want GET */
  }
  try {
    const created = await cdpHttp<CdpTarget>(`/json/new?${encoded}`);
    if (created?.webSocketDebuggerUrl) return created;
  } catch {
    return null;
  }
  return null;
}

function usablePages(pages: CdpTarget[]): CdpTarget[] {
  return pages.filter((t) => t.type === "page" || !t.type || t.type === "tab");
}

function pickBestPage(pages: CdpTarget[], preferQuery?: string): CdpTarget | undefined {
  const usable = usablePages(pages);
  if (preferQuery?.trim()) {
    const ranked = rankTabsByQuery(usable, preferQuery);
    if (ranked[0] && ranked[0].score >= 3) return ranked[0].page;
  }
  return (
    usable.find(
      (p) =>
        p.url &&
        !p.url.startsWith("chrome://") &&
        !p.url.startsWith("edge://") &&
        !p.url.startsWith("devtools://") &&
        !p.url.startsWith("about:blank"),
    ) ??
    usable.find((p) => p.url && !p.url.startsWith("devtools://")) ??
    usable[0] ??
    pages[0]
  );
}

/** Tokenize a user intent for matching open tab titles/URLs. */
export function tokenizeTabQuery(raw: string): string[] {
  const stop = new Set([
    "я",
    "ты",
    "он",
    "в",
    "на",
    "по",
    "и",
    "а",
    "уже",
    "открыл",
    "открыла",
    "открыли",
    "открыто",
    "пройди",
    "пройти",
    "сделай",
    "пожалуйста",
    "его",
    "её",
    "ее",
    "этот",
    "эту",
    "это",
    "браузер",
    "браузере",
    "браузера",
    "браузером",
    "яндекс",
    "который",
    "которая",
    "которое",
    "хром",
    "chrome",
    "edge",
    "вкладка",
    "вкладки",
    "вкладке",
    "вкладку",
    "сайт",
    "страница",
    "страницу",
    "мне",
    "для",
    "the",
    "a",
    "an",
    "open",
    "opened",
    "tab",
    "please",
    "take",
    "do",
  ]);
  return raw
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9\s\-_.]/gi, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !stop.has(w));
}

export function extractTabQueryFromMessage(message: string): string {
  const t = message.toLowerCase().replace(/ё/g, "е");
  // Drop «в яндекс браузере» / «в хроме» — that's WHERE, not the tab title
  const cleaned = t
    .replace(/\bв\s+(?:яндекс\s*)?(?:браузер\w*|chrome|edge|хром\w*|firefox)\b/gi, " ")
    .replace(/\b(?:яндекс\s*)?браузер\w*\b/gi, " ")
    .replace(/\bкоторый\s+я\s+открыл\w*\b/gi, " ")
    .replace(/\bчто\s+я\s+открыл\w*\b/gi, " ")
    .replace(/\bя\s+открыл\w*\b/gi, " ");

  const testTitle =
    cleaned.match(/(тест\s+по\s+[a-zа-я0-9\-\s]{2,40})/i)?.[1] ??
    cleaned.match(/((?:тест|опрос|квиз|quiz|exam)\s+[a-zа-я0-9\-\s]{2,40})/i)?.[1];
  if (testTitle) {
    const tokens = tokenizeTabQuery(testTitle);
    if (tokens.length) return tokens.join(" ");
  }

  const take = cleaned.match(/(?:пройд\w*|реши|заполни)\s+(.+)/i)?.[1];
  if (take) {
    const tokens = tokenizeTabQuery(take);
    if (tokens.length) return tokens.join(" ");
  }

  const opened = cleaned.match(/открыл(?:а|и|о)?\s+(.+)/i)?.[1];
  if (opened && !/^(яндекс|браузер|chrome|edge|хром)/i.test(opened.trim())) {
    const tokens = tokenizeTabQuery(opened);
    if (tokens.length) return tokens.join(" ");
  }

  const tokens = tokenizeTabQuery(cleaned);
  if (tokens.length) return tokens.join(" ");
  if (/тест|quiz|опрос|exam/i.test(t)) return "тест";
  return "тест";
}

export interface RankedTab {
  page: CdpTarget;
  score: number;
  reason: string;
}

/** Score open tabs against user query (title + URL). Higher = better. */
export function rankTabsByQuery(pages: CdpTarget[], query: string): RankedTab[] {
  const tokens = tokenizeTabQuery(query);
  const q = query.toLowerCase().replace(/ё/g, "е");
  const scored: RankedTab[] = [];
  for (const page of usablePages(pages)) {
    const title = (page.title || "").toLowerCase().replace(/ё/g, "е");
    const url = (page.url || "").toLowerCase();
    const hay = `${title} ${url}`;
    let score = 0;
    const hits: string[] = [];
    for (const tok of tokens) {
      if (title.includes(tok)) {
        score += 5;
        hits.push(`title:${tok}`);
      } else if (url.includes(tok)) {
        score += 3;
        hits.push(`url:${tok}`);
      } else if (tok.length >= 5 && hay.includes(tok.slice(0, Math.max(4, tok.length - 1)))) {
        score += 2;
        hits.push(`stem:${tok}`);
      }
    }
    if (/тест|test|quiz|опрос|exam|onlinetestpad|forms\.google|kahoot/i.test(hay)) {
      if (/тест|test|quiz|опрос|exam|пройд/i.test(q)) {
        score += 4;
        hits.push("quiz-site");
      }
    }
    // Penalize news feeds when looking for a task/test
    if (
      /тест|quiz|опрос|задани|матем/i.test(q) &&
      /(dzen\.ru|zen\.yandex|news\.yandex|youtube\.com\/feed|vk\.com\/feed)/i.test(url)
    ) {
      score -= 8;
      hits.push("penalty-feed");
    }
    if (!page.url || /^(chrome|edge|devtools|about):/i.test(page.url)) {
      score -= 20;
    }
    scored.push({ page, score, reason: hits.join(",") || "none" });
  }
  return scored.sort((a, b) => b.score - a.score);
}

async function activateTarget(id: string): Promise<void> {
  // Chromium HTTP activate (Chrome / Edge / Yandex)
  try {
    await cdpHttp(`/json/activate/${id}`);
  } catch {
    /* some builds 404 — fall through to CDP */
  }
}

/** Wait until a debuggable tab exists; create one if CDP is up but empty. */
export async function waitForCdpPage(
  preferUrl?: string,
  timeoutMs = 20000,
): Promise<CdpTarget> {
  const start = Date.now();
  const restoreMode = preferUrl == null || preferUrl === "";
  let attemptedCreate = false;
  while (Date.now() - start < timeoutMs) {
    try {
      const pages = await listPages();
      // Prefer a restored real page over junk NTP/blank when restoring session
      const meaningful = usablePages(pages).filter((p) => !isJunkTabUrl(p.url || ""));
      const t =
        (restoreMode && meaningful.length ? pickBestPage(meaningful) : undefined) ??
        pickBestPage(pages, preferUrl || undefined);
      if (t?.webSocketDebuggerUrl) return t;
      if (!restoreMode && !attemptedCreate) {
        attemptedCreate = true;
        const created = await createBlankPage(preferUrl || "about:blank");
        if (created?.webSocketDebuggerUrl) {
          await sleep(400);
          return created;
        }
      } else if (!restoreMode && attemptedCreate) {
        if ((Date.now() - start) % 2000 < 500) {
          await createBlankPage(preferUrl || "about:blank");
        }
      }
    } catch {
      /* CDP flapping */
    }
    await sleep(350);
  }
  // Last resort: any page, or create blank
  try {
    const pages = await listPages();
    const any = pickBestPage(pages);
    if (any?.webSocketDebuggerUrl) return any;
    const created = await createBlankPage(preferUrl || "about:blank");
    if (created?.webSocketDebuggerUrl) return created;
  } catch {
    /* ignore */
  }
  throw new Error(
    "No CDP page — браузер не отдал вкладку для управления. Закрой лишние окна Chrome/Yandex с remote-debugging и сделай: hey gateway restart, затем повтори.",
  );
}

async function connectPage(target?: CdpTarget): Promise<{ session: CdpSession; target: CdpTarget }> {
  let t = target;
  if (!t) {
    const pages = await listPages().catch(() => [] as CdpTarget[]);
    const focusedId = loadMissionState()?.tabIds?.[0];
    if (focusedId) {
      t =
        usablePages(pages).find((p) => p.id === focusedId || p.id.startsWith(focusedId)) ??
        undefined;
    }
    if (!t) t = await waitForCdpPage();
  }
  if (!t?.webSocketDebuggerUrl) throw new Error("No CDP page");
  try {
    return { session: await CdpSession.connect(t.webSocketDebuggerUrl), target: t };
  } catch {
    // Stale websocket URL — refresh list / new tab once
    const pages = await listPages().catch(() => [] as CdpTarget[]);
    const focusedId = loadMissionState()?.tabIds?.[0];
    const fresh =
      (focusedId &&
        usablePages(pages).find((p) => p.id === focusedId || p.id.startsWith(focusedId))) ||
      (await waitForCdpPage(t.url || "about:blank", 8000));
    return { session: await CdpSession.connect(fresh.webSocketDebuggerUrl!), target: fresh };
  }
}

export async function withCdpPage<T>(
  preferred: PreferredBrowser,
  fn: (session: CdpSession) => Promise<T>,
  firstUrl = "about:blank",
): Promise<T> {
  await ensureBrowser(firstUrl, preferred);
  const { session } = await connectPage();
  try {
    return await fn(session);
  } finally {
    session.close();
  }
}

export async function ensureBrowser(
  firstUrl = "about:blank",
  preferred: PreferredBrowser = "auto",
): Promise<void> {
  const useReal = shouldUseRealBrowserProfile();
  const restoreOnly = useReal && (!firstUrl || firstUrl === "about:blank");

  let cdpUp = false;
  try {
    await cdpHttp("/json/version");
    cdpUp = true;
  } catch {
    /* launch */
  }

  // Guest CDP (empty ntp/blank) left over from an old run must not win over the real profile.
  if (cdpUp && useReal) {
    try {
      const pages = await listPages();
      const meaningful = usablePages(pages).filter((p) => !isJunkTabUrl(p.url || ""));
      if (!meaningful.length) {
        cdpUp = false;
        await killCdpPortHolders();
        await sleep(400);
      }
    } catch {
      cdpUp = false;
    }
  }

  if (!cdpUp) {
    const exes = resolveBrowserExes(preferred).filter((p) => existsSync(p));
    if (!exes.length) throw new Error("No Chrome/Edge/Yandex for CDP");
    let last: unknown;
    for (const exe of exes) {
      try {
        await launchCdpBrowser(exe, restoreOnly ? "" : firstUrl || "about:blank");
        cdpUp = true;
        break;
      } catch (err) {
        last = err;
      }
    }
    if (!cdpUp) throw last instanceof Error ? last : new Error(String(last));
  }

  // CDP may answer /json/version before any page exists — always wait/create
  try {
    await waitForCdpPage(restoreOnly ? undefined : firstUrl || "about:blank", 20000);
  } catch (err) {
    // Dead/half-open debugging port: kill and relaunch once
    await killCdpPortHolders();
    const exes = resolveBrowserExes(preferred).filter((p) => existsSync(p));
    if (!exes.length) throw err;
    await launchCdpBrowser(exes[0]!, restoreOnly ? "" : firstUrl || "about:blank");
    await waitForCdpPage(restoreOnly ? undefined : firstUrl || "about:blank", 20000);
  }
}

export async function recoverBrowser(
  preferred: PreferredBrowser = "auto",
  resumeUrl?: string,
): Promise<string> {
  const state = loadMissionState();
  const url = resumeUrl || state?.lastUrl || "about:blank";
  await ensureBrowser(url, preferred);
  const { session } = await connectPage();
  try {
    await session.navigate(url);
    const page = await readPageState(session);
    return `Browser recovered. Now at: ${page.url} (${page.title})`;
  } finally {
    session.close();
  }
}

export async function readPageState(session: CdpSession): Promise<BrowserPageState> {
  const info = await session.evaluate<{ url: string; title: string; body: string }>(`
(() => ({
  url: location.href,
  title: document.title || '',
  body: (document.body && document.body.innerText || '').slice(0, 4000)
}))()
`);
  const text = `${info.title}\n${info.body}`.toLowerCase();
  let blocker: BrowserBlocker = "none";
  let blockerDetail: string | undefined;

  if (
    /checking your browser|just a moment|cf-challenge|cloudflare|hcaptcha|recaptcha|verify you are human|attention required/i.test(
      text,
    ) ||
    /challenge-platform|cdn-cgi\/challenge/i.test(info.url)
  ) {
    blocker = "captcha";
    blockerDetail = "CAPTCHA / Cloudflare challenge detected";
  } else if (
    /log in|sign in|войти|авторизац|password|пароль/i.test(text) &&
    /login|signin|auth/i.test(info.url)
  ) {
    blocker = "login";
    blockerDetail = "Login wall detected";
  }

  return { url: info.url, title: info.title, blocker, blockerDetail };
}

export async function dismissPopups(session: CdpSession): Promise<string> {
  const clicked = await session.evaluate<string>(`
(() => {
  const texts = ['accept', 'agree', 'ok', 'got it', 'close', 'dismiss', 'понятно', 'принять', 'согласен', 'хорошо', 'закрыть', 'нет, спасибо', 'no thanks'];
  const nodes = Array.from(document.querySelectorAll('button, [role="button"], a, input[type="button"], input[type="submit"]'));
  for (const el of nodes) {
    const t = ((el.innerText || el.value || el.getAttribute('aria-label') || '') + '').trim().toLowerCase();
    if (!t || t.length > 40) continue;
    if (texts.some(x => t === x || t.includes(x))) {
      el.click();
      return t;
    }
  }
  // Escape common cookie/dialog overlays
  const dialog = document.querySelector('[role="dialog"], .modal, .cookie, #onetrust-banner-sdk');
  if (dialog) {
    const btn = dialog.querySelector('button');
    if (btn) { btn.click(); return 'dialog-button'; }
  }
  return '';
})()
`);
  if (clicked) {
    await sleep(600);
    return `Closed popup via click: ${clicked}`;
  }
  return "No obvious popup button found";
}

export async function browserNavigateVerified(
  url: string,
  preferred: PreferredBrowser = "auto",
  opts?: { expectIncludes?: string; settleMs?: number },
): Promise<BrowserPageState> {
  if (cancelFlag) throw new Error("CANCELLED");
  await ensureBrowser(url, preferred);
  const { session } = await connectPage();
  try {
    await session.navigate(url, opts?.settleMs ?? 1600);
    await dismissPopups(session);
    let page = await readPageState(session);
    if (page.blocker === "captcha") return page;
    if (opts?.expectIncludes && !page.url.toLowerCase().includes(opts.expectIncludes.toLowerCase())) {
      // one retry
      await session.navigate(url, opts.settleMs ?? 1800);
      page = await readPageState(session);
      if (!page.url.toLowerCase().includes(opts.expectIncludes.toLowerCase())) {
        return {
          ...page,
          blocker: "wrong_url",
          blockerDetail: `Expected URL containing "${opts.expectIncludes}", got ${page.url}`,
        };
      }
    }
    return page;
  } finally {
    session.close();
  }
}

export async function browserGetState(preferred: PreferredBrowser = "auto"): Promise<BrowserPageState> {
  try {
    await ensureBrowser("about:blank", preferred);
    const { session } = await connectPage();
    try {
      return await readPageState(session);
    } finally {
      session.close();
    }
  } catch (err) {
    return {
      url: "",
      title: "",
      blocker: "dead",
      blockerDetail: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function browserScroll(times = 3, preferred: PreferredBrowser = "auto"): Promise<string> {
  await ensureBrowser("about:blank", preferred);
  const { session } = await connectPage();
  try {
    for (let i = 0; i < times; i++) {
      if (cancelFlag) return "CANCELLED during scroll";
      await session.evaluate(`window.scrollBy(0, Math.max(600, window.innerHeight * 0.9))`);
      await sleep(700);
    }
    const page = await readPageState(session);
    return `Scrolled ${times}x. Now at ${page.url}`;
  } finally {
    session.close();
  }
}

export async function browserOpenTab(
  url: string,
  preferred: PreferredBrowser = "auto",
): Promise<string> {
  await ensureBrowser(url, preferred);
  const created = await cdpHttp<CdpTarget>(`/json/new?${encodeURIComponent(url)}`, {
    method: "PUT",
  }).catch(async () => {
    // some browsers want GET
    return cdpHttp<CdpTarget>(`/json/new?${encodeURIComponent(url)}`);
  });
  await sleep(1200);
  return `Opened tab ${created?.id ?? "?"}: ${url}`;
}

export async function browserListTabs(preferred: PreferredBrowser = "auto"): Promise<string> {
  await ensureBrowser("about:blank", preferred);
  const pages = await listPages();
  if (!pages.length) return "No tabs";
  return pages
    .map((p, i) => `${i + 1}. [${p.id.slice(0, 8)}] ${p.title || "(no title)"} — ${p.url}`)
    .join("\n");
}

export async function browserListTabsData(
  preferred: PreferredBrowser = "auto",
): Promise<Array<{ id: string; title: string; url: string }>> {
  await ensureBrowser("about:blank", preferred);
  const pages = await listPages();
  return usablePages(pages).map((p) => ({
    id: p.id,
    title: p.title || "",
    url: p.url || "",
  }));
}

/**
 * Find an already-open tab by title/URL keywords and bring it to front.
 * NEVER opens a new URL. Use when the owner says «я открыл …».
 */
export async function browserFocusTab(
  queryOrId: string,
  preferred: PreferredBrowser = "auto",
): Promise<string> {
  await ensureBrowser("about:blank", preferred);
  const pages = await listPages();
  if (!pages.length) {
    return "ERROR: нет вкладок в CDP. Запусти браузер с remote-debugging (hey gateway) и открой нужную страницу.";
  }

  const q = queryOrId.trim();
  let target =
    usablePages(pages).find((p) => p.id === q || p.id.startsWith(q)) ?? undefined;

  let rankNote = "";
  if (!target) {
    const ranked = rankTabsByQuery(pages, q);
    const best = ranked[0];
    if (!best || best.score < 3) {
      const listing = pages
        .map((p, i) => `${i + 1}. ${p.title || "(no title)"} — ${p.url}`)
        .join("\n");
      return [
        `ERROR: не нашёл вкладку по запросу «${q}» (лучший score=${best?.score ?? 0}).`,
        "Открытые вкладки:",
        listing,
        "Не открываю новую страницу — уточни название вкладки или URL.",
      ].join("\n");
    }
    target = best.page;
    rankNote = ` match=${best.score} (${best.reason})`;
  }

  await activateTarget(target.id);
  const { session } = await connectPage(target);
  try {
    await session.send("Page.bringToFront").catch(() => undefined);
    await sleep(500);
    const page = await readPageState(session);
    saveMissionState({
      missionId: "focus-tab",
      kind: "focus-tab",
      step: 1,
      steps: [q],
      lastUrl: page.url,
      tabIds: [target.id],
      updatedAt: new Date().toISOString(),
    });
    return `OK focused${rankNote}: ${page.title || "(no title)"} — ${page.url}`;
  } finally {
    session.close();
  }
}

/** Click a visible button/link/label by exact or substring text (DOM). */
export async function browserClickText(
  text: string,
  preferred: PreferredBrowser = "auto",
  opts?: { exclude?: string[] },
): Promise<string> {
  await ensureBrowser("about:blank", preferred);
  const { session } = await connectPage();
  try {
    const want = text.trim();
    if (!want) return "ERROR: empty click text";
    const exclude = (opts?.exclude ?? []).map((s) => s.toLowerCase());
    const ok = await session.evaluate<boolean>(
      `(() => {
  const want = ${JSON.stringify(want)}.toLowerCase();
  const exclude = ${JSON.stringify(exclude)};
  const nodes = Array.from(document.querySelectorAll(
    'a,button,input[type=button],input[type=submit],input[type=radio],input[type=checkbox],[role=button],label,span,div,li'
  ));
  let best = null;
  let bestLen = 1e9;
  for (const el of nodes) {
    const t = ((el.innerText || el.textContent || el.value || '') + '').replace(/\\s+/g, ' ').trim();
    if (!t || t.length > 160) continue;
    const tl = t.toLowerCase();
    if (exclude.some((e) => e && tl.includes(e))) continue;
    if (tl !== want && !tl.includes(want) && want.length >= 3 && !want.includes(tl)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    if (t.length < bestLen) { best = el; bestLen = t.length; }
  }
  if (!best) return false;
  best.scrollIntoView({ block: 'center', inline: 'nearest' });
  best.click();
  return true;
})()`,
    );
    await sleep(700);
    const page = await readPageState(session);
    return ok
      ? `OK clicked «${want}». Now: ${page.title} — ${page.url}`
      : `ERROR: не нашёл кликабельный текст «${want}» на ${page.url}`;
  } finally {
    session.close();
  }
}

export interface QuizSnapshot {
  url: string;
  title: string;
  progress: string;
  question: string;
  options: string[];
  /** Answer control count (radio or checkbox). */
  radioCount: number;
  /** true = checkboxes, several answers allowed */
  multiSelect: boolean;
  /** Free-text answer field (fill-in-the-blank). */
  textInput: boolean;
  /** Current value in the text field, if any. */
  textValue: string;
  /** CSS center of the text field for cursor focus. */
  textTarget?: { x: number; y: number; screenX: number; screenY: number };
  /** «Установите соответствие» — selects / mapping UI */
  matching: boolean;
  selectCount: number;
  selectTargets: Array<{ index: number; x: number; y: number; value: string; options: string[] }>;
  /** CSS viewport centers of each answer control. */
  targets: Array<{ index: number; x: number; y: number; hasImage: boolean }>;
  done: boolean;
  looksLikeQuiz: boolean;
  hasNext: boolean;
  hasFinish: boolean;
  /** Landing page with «Начать тест» */
  hasStart: boolean;
  /** True when answers are pictures / empty labels — need vision. */
  needsVision: boolean;
}

/** Structured read of a quiz/test page (options via radio/checkbox/labels). */
export async function browserReadQuiz(
  preferred: PreferredBrowser = "auto",
): Promise<QuizSnapshot> {
  await ensureBrowser("about:blank", preferred);
  const { session } = await connectPage();
  try {
    return await session.evaluate<QuizSnapshot>(`(() => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const body = norm(document.body && document.body.innerText || '');
  const url = location.href || '';
  const title = document.title || '';
  const progress =
    (body.match(/(\\d+\\s+из\\s+\\d+)/i) ||
      body.match(/\\b(\\d+\\s*\\/\\s*\\d+)\\b/) ||
      body.match(/вопрос\\s*(\\d+\\s*\\/\\s*\\d+)/i))?.[1] ||
    '';
  const done = /результат|тест заверш|спасибо за прохожд|your score|finished|набрано\\s*баллов|ваш\\s+результат/i.test(body);
  const hasNext = !!Array.from(document.querySelectorAll('a,button,[role=button],input,div,span')).find((el) =>
    /^(далее|next|продолжить|ответить|следующ)/i.test(norm(el.innerText || el.value || '').slice(0, 40))
  );
  const hasFinish = !!Array.from(document.querySelectorAll('a,button,[role=button],input')).find((el) =>
    /^(завершить|finish|отправить|закончить)/i.test(norm(el.innerText || el.value || ''))
  );
  const hasStart = !!Array.from(document.querySelectorAll('a,button,[role=button],input,div,span')).find((el) => {
    const t = norm(el.innerText || el.value || '');
    return /^(начать(\\s+тест)?|пройти(\\s+тест)?|start(\\s+test)?|старт)$/i.test(t) || /^начать\\s+тест$/i.test(t);
  });

  let radios = Array.from(document.querySelectorAll('input[type=radio]'));
  let checks = Array.from(document.querySelectorAll('input[type=checkbox]'));
  // Custom quiz UIs (testometrika etc.): clickable option rows without native radios
  const customOpts = Array.from(
    document.querySelectorAll(
      '[role=radio], [role=option], [class*="answer"], [class*="option"], [class*="variant"], [class*="choice"], [class*="quiz"] label, .test label, label'
    )
  ).filter((el) => {
    const t = norm(el.innerText || '');
    if (!t || t.length > 160) return false;
    if (/далее|завершить|начать|меню|реклам|автор|testometrika|онлайн/i.test(t)) return false;
    const r = el.getBoundingClientRect();
    return r.width > 20 && r.height > 12 && r.top > 60 && r.bottom < (window.innerHeight - 40);
  });
  // Deduplicate nested labels
  const customFlat = customOpts.filter((el, i, arr) => !arr.some((o, j) => j !== i && o.contains(el)));

  const multiSelect =
    checks.length >= 2 &&
    (radios.length < 2 ||
      /какие|отметьте все|выберите все|несколько|из предложенн/i.test(body.slice(0, 800)));
  let inputs = multiSelect || (checks.length >= 2 && radios.length === 0) ? checks : radios.length ? radios : checks;
  let usingCustom = false;
  if (inputs.length < 2 && customFlat.length >= 2) {
    inputs = customFlat;
    usingCustom = true;
  }

  const targets = inputs.map((input, i) => {
    const r = input.getBoundingClientRect();
    const lab = input.closest ? (input.closest('label') || (input.id ? document.querySelector('label[for="'+input.id+'"]') : null)) : null;
    const box = lab || input.parentElement || input;
    const br = (box.getBoundingClientRect ? box.getBoundingClientRect() : r);
    const hasImage = !!(box && box.querySelector && box.querySelector('img, svg, canvas, math, .katex, .MathJax'));
    let x, y;
    if (!usingCustom && r.width >= 3 && r.height >= 3) {
      x = Math.round(r.left + r.width / 2);
      y = Math.round(r.top + r.height / 2);
    } else {
      // click left circle area of the option row
      x = Math.round(br.left + 18);
      y = Math.round(br.top + Math.min(br.height / 2, 22));
    }
    return { index: i + 1, x, y, hasImage };
  });

  const options = [];
  const seen = new Set();
  const pushOpt = (raw) => {
    let t = norm(raw);
    t = t.replace(/^[a-dа-г]\\s*[).]\\s*/i, '').replace(/^\\d+\\s*[).]\\s*/, '');
    if (!t || t.length > 200) return;
    if (/^(далее|завершить|next|finish|начать|начать тест)$/i.test(t)) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    options.push(t);
  };

  for (const input of inputs) {
    if (usingCustom) {
      pushOpt(input.innerText || input.textContent);
      continue;
    }
    const id = input.id;
    let label = id ? document.querySelector('label[for="' + id + '"]') : null;
    if (!label) label = input.closest('label');
    let text = label ? (label.innerText || label.textContent) : '';
    if (!text && input.parentElement) text = input.parentElement.innerText;
    if (!norm(text) || norm(text).length < 1) {
      options.push('вариант ' + (options.length + 1));
      continue;
    }
    pushOpt(text);
  }
  if (options.length < 2) {
    for (const lab of customFlat) pushOpt(lab.innerText || lab.textContent);
  }
  if (inputs.length >= 2 && options.length < inputs.length) {
    while (options.length < inputs.length) options.push('вариант ' + (options.length + 1));
  }

  let question = '';
  const qEl =
    document.querySelector('.question, .q-text, .test-question, [class*="question"], [class*="Question"]') ||
    document.querySelector('h1, h2, h3');
  if (qEl) question = norm(qEl.innerText || '').slice(0, 500);
  if (!question || question.length < 10) {
    const lines = body.split(/\\n+/).map(norm).filter(Boolean);
    const pi = lines.findIndex((l) => /\\d+\\s+из\\s+\\d+|\\d+\\s*\\/\\s*\\d+/i.test(l));
    if (pi >= 0 && lines[pi + 1]) question = lines[pi + 1].slice(0, 500);
  }

  const radioCount = inputs.length;
  const imageHeavy = targets.filter((t) => t.hasImage).length >= Math.max(1, Math.floor(radioCount / 2));
  const textWeak = options.every((o) => /^(картинка|вариант)\\s+\\d+$/i.test(o)) || options.length < 2;
  const needsVision =
    usingCustom ||
    /testometrika|quizizz|kahoot|forms\\.google/i.test(url) ||
    (radioCount >= 2 && (imageHeavy || textWeak || /отметь|рисунок|фигур|ломан|картинк|наименьшее|наибольшее/i.test(question + body.slice(0, 400))));
  const multi =
    multiSelect ||
    /какие\\s+числа|отметьте\\s+все|выберите\\s+все|все\\s+верн|из\\s+предложенн/i.test(question + ' ' + body.slice(0, 500));

  // Fill-in-the-blank text fields (not radio/checkbox/button)
  const textFields = Array.from(document.querySelectorAll(
    'input[type=text], input[type=number], input:not([type]), textarea, input[type=search]'
  )).filter((el) => {
    const t = (el.type || 'text').toLowerCase();
    if (['radio','checkbox','button','submit','hidden','file','image'].includes(t)) return false;
    const r = el.getBoundingClientRect();
    return r.width > 20 && r.height > 10;
  });

  // Matching / correspondence: native <select> or small number inputs next to left labels
  const selects = Array.from(document.querySelectorAll('select')).filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 10 && r.height > 8;
  });
  const matchingHint = /соответств|установите\\s+соответ|соотнесите|параметр/i.test(question + ' ' + body.slice(0, 900));
  const smallNums = Array.from(document.querySelectorAll('input[type=number], input[type=text]')).filter((el) => {
    const t = (el.type || 'text').toLowerCase();
    if (['radio','checkbox','button','submit','hidden'].includes(t)) return false;
    const r = el.getBoundingClientRect();
    return r.width > 8 && r.width < 120 && r.height > 8 && r.height < 50;
  });
  const matching = matchingHint || (selects.length >= 2 && radioCount < 2) || (matchingHint && smallNums.length >= 2);

  let textInput = false;
  let textValue = '';
  let textTarget = undefined;
  // Prefer matching selects over treating number inputs as a single blank
  if (!matching && radioCount < 2 && textFields.length >= 1) {
    textInput = true;
    const el = textFields[0];
    textValue = String(el.value || '');
    const r = el.getBoundingClientRect();
    const cssX = Math.round(r.left + r.width / 2);
    const cssY = Math.round(r.top + r.height / 2);
    const leftPad = (window.outerWidth - window.innerWidth) / 2;
    const topChrome = window.outerHeight - window.innerHeight;
    textTarget = {
      x: cssX,
      y: cssY,
      screenX: Math.round(window.screenX + leftPad + cssX),
      screenY: Math.round(window.screenY + topChrome + cssY),
    };
  }

  const selectTargets = (selects.length >= 2 ? selects : smallNums).map((el, i) => {
    const r = el.getBoundingClientRect();
    const opts = el.tagName === 'SELECT'
      ? Array.from(el.options || []).map((o) => String(o.text || o.value || '').trim()).filter(Boolean)
      : ['1','2','3','4'];
    return {
      index: i + 1,
      x: Math.round(r.left + r.width / 2),
      y: Math.round(r.top + r.height / 2),
      value: String(el.value || ''),
      options: opts.slice(0, 12),
    };
  });

  const looksLikeQuiz =
    done ||
    options.length >= 2 ||
    radioCount >= 2 ||
    textInput ||
    matching ||
    !!progress ||
    hasStart ||
    /onlinetestpad|testometrika|forms\\.google|quiz|тест/i.test(url + ' ' + title) ||
    /\\d+\\s+из\\s+\\d+|\\d+\\s*\\/\\s*\\d+/i.test(body);

  return {
    url, title, progress, question, options, radioCount,
    multiSelect: multi, textInput, textValue, textTarget,
    matching, selectCount: selectTargets.length, selectTargets,
    targets, done, looksLikeQuiz, hasNext, hasFinish, hasStart, needsVision
  };
})()`);
  } finally {
    session.close();
  }
}

/** Click «Начать тест» / Start on landing pages (testometrika, etc.). */
export async function browserQuizClickStart(
  preferred: PreferredBrowser = "auto",
): Promise<string> {
  for (const label of [
    "Начать тест",
    "Начать",
    "Пройти тест",
    "Пройти",
    "Start test",
    "Start",
    "Старт",
    "Далее",
  ]) {
    const click = await browserClickText(label, preferred, {
      exclude: ["завершить", "finish", "регистр"],
    });
    if (click.startsWith("OK")) {
      await sleep(1200);
      return click;
    }
  }
  return "ERROR: кнопка «Начать тест» не найдена";
}

/** Select quiz option by 1-based index or by visible text. */
export async function browserSelectQuizOption(
  choice: number | string,
  preferred: PreferredBrowser = "auto",
): Promise<string> {
  // Prefer real cursor + CDP mouse on the radio CIRCLE (left), not the middle of long text.
  return browserSelectQuizOptionWithCursor(choice, preferred);
}

/**
 * Move cursor onto the answer circle and click — verifies input.checked before OK.
 */
export async function browserSelectQuizOptionWithCursor(
  choice: number | string,
  preferred: PreferredBrowser = "auto",
): Promise<string> {
  await ensureBrowser("about:blank", preferred);
  const { session } = await connectPage();
  try {
    await session.send("Page.bringToFront").catch(() => undefined);

    // 1) Resolve circle CSS coords + force-select helpers
    const hit = await session.evaluate<{
      ok: boolean;
      detail: string;
      cssX: number;
      cssY: number;
      screenX: number;
      screenY: number;
      idx: number;
    }>(`(() => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const choice = ${JSON.stringify(choice)};
  const radios = Array.from(document.querySelectorAll('input[type=radio]'));
  const checks = Array.from(document.querySelectorAll('input[type=checkbox]'));
  let inputs = (checks.length >= 2 && radios.length < 2) ? checks : (radios.length ? radios : checks);
  if (inputs.length < 2) {
    inputs = Array.from(document.querySelectorAll(
      '[role=radio], [role=option], [class*="answer"], [class*="option"], [class*="variant"], [class*="choice"], label'
    )).filter((el) => {
      const t = norm(el.innerText || '');
      if (!t || t.length > 160) return false;
      if (/далее|завершить|начать|меню|реклам|автор/i.test(t)) return false;
      const r = el.getBoundingClientRect();
      return r.width > 20 && r.height > 12 && r.top > 60;
    });
    // dedupe nested
    inputs = inputs.filter((el, i, arr) => !arr.some((o, j) => j !== i && o.contains(el)));
  }
  let idx = -1;
  if (typeof choice === 'number' || /^\\d+$/.test(String(choice))) {
    idx = Math.max(1, parseInt(String(choice), 10)) - 1;
  } else {
    const want = norm(String(choice));
    idx = inputs.findIndex((input) => {
      const lab = input.closest && (input.closest('label') || (input.id && document.querySelector('label[for="'+input.id+'"]')));
      const text = norm((lab && lab.innerText) || input.innerText || (input.parentElement && input.parentElement.innerText) || '');
      return text === want || text.includes(want) || (want.length > 2 && want.includes(text.slice(0, 40)));
    });
  }
  if (idx < 0 || !inputs[idx]) {
    return { ok: false, detail: 'option not found', cssX: 0, cssY: 0, screenX: 0, screenY: 0, idx: -1 };
  }

  const input = inputs[idx];
  input.scrollIntoView({ block: 'center', inline: 'nearest' });
  const lab = input.closest && (input.closest('label') || (input.id && document.querySelector('label[for="'+input.id+'"]')));
  const ir = input.getBoundingClientRect();
  const br = (lab || input.parentElement || input).getBoundingClientRect();
  let cssX, cssY;
  if (input.tagName === 'INPUT' && ir.width >= 3 && ir.height >= 3) {
    cssX = Math.round(ir.left + ir.width / 2);
    cssY = Math.round(ir.top + ir.height / 2);
  } else {
    cssX = Math.round(br.left + 18);
    cssY = Math.round(br.top + Math.min(br.height / 2, 22));
  }
  const leftPad = (window.outerWidth - window.innerWidth) / 2;
  const topChrome = window.outerHeight - window.innerHeight;
  return {
    ok: true,
    detail: (input.type || input.tagName || 'opt') + '#' + (idx + 1),
    cssX, cssY,
    screenX: Math.round(window.screenX + leftPad + cssX),
    screenY: Math.round(window.screenY + topChrome + cssY),
    idx: idx + 1,
  };
})()`);

    if (!hit.ok || hit.idx < 1) {
      return `ERROR: не нашёл кружок ответа (${hit.detail})`;
    }

    // 2) Visible OS cursor move + click (what the user asked for)
    try {
      await focusBrowserOsWindow(preferred);
      const { xplatMouseClick } = await import("./platform-input.js");
      await xplatMouseClick(hit.screenX, hit.screenY);
      await sleep(200);
    } catch {
      /* fall through to CDP */
    }

    // 3) CDP mouse on the circle (works even if OS coords are off / window occluded)
    await session.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: hit.cssX,
      y: hit.cssY,
    });
    await session.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: hit.cssX,
      y: hit.cssY,
      button: "left",
      clickCount: 1,
    });
    await session.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: hit.cssX,
      y: hit.cssY,
      button: "left",
      clickCount: 1,
    });
    await sleep(250);

    // 4) Nuclear DOM: check the radio + events (Online Test Pad often needs this)
    const verified = await session.evaluate<boolean>(
      `(() => {
  const radios = Array.from(document.querySelectorAll('input[type=radio]'));
  const checks = Array.from(document.querySelectorAll('input[type=checkbox]'));
  let inputs = (checks.length >= 2 && radios.length < 2) ? checks : (radios.length ? radios : checks);
  const idx = ${hit.idx - 1};
  if (inputs[idx]) {
    const input = inputs[idx];
    const lab = input.closest('label') || (input.id && document.querySelector('label[for="'+input.id+'"]'));
    try { input.click(); } catch(e) {}
    if (lab) { try { lab.click(); } catch(e) {} }
    input.checked = true;
    input.dispatchEvent(new Event('click', { bubbles: true }));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return !!input.checked || inputs.some((r) => r.checked);
  }
  // custom option rows (testometrika)
  const customs = Array.from(document.querySelectorAll(
    '[role=radio], [role=option], [class*="answer"], [class*="option"], [class*="variant"], [class*="choice"], label'
  )).filter((el) => {
    const t = ((el.innerText||'')+'').trim();
    if (!t || t.length > 160) return false;
    if (/далее|завершить|начать|меню|реклам/i.test(t)) return false;
    const r = el.getBoundingClientRect();
    return r.width > 20 && r.height > 12 && r.top > 60;
  }).filter((el, i, arr) => !arr.some((o, j) => j !== i && o.contains(el)));
  if (customs[idx]) {
    try { customs[idx].click(); } catch(e) {}
    return true;
  }
  return false;
})()`,
    );
    await sleep(200);

    if (!verified) {
      return `ERROR: кликнул кружок #${hit.idx} at css(${hit.cssX},${hit.cssY}) / screen(${hit.screenX},${hit.screenY}), но radio не checked`;
    }
    return `OK selected #${hit.idx} via cursor css(${hit.cssX},${hit.cssY}) screen(${hit.screenX},${hit.screenY})`;
  } finally {
    session.close();
  }
}

/** True if any quiz radio/checkbox is checked OR text answer field is filled. */
export async function browserQuizHasSelection(
  preferred: PreferredBrowser = "auto",
): Promise<boolean> {
  await ensureBrowser("about:blank", preferred);
  const { session } = await connectPage();
  try {
    return await session.evaluate<boolean>(
      `(() => {
  const radios = Array.from(document.querySelectorAll('input[type=radio]'));
  const checks = Array.from(document.querySelectorAll('input[type=checkbox]'));
  if (radios.some((r) => r.checked) || checks.some((c) => c.checked)) return true;
  // Custom quiz UIs (testometrika etc.)
  const custom = Array.from(document.querySelectorAll(
    '[role=radio], [role=option], [aria-checked], [class*="answer"], [class*="option"], [class*="variant"], [class*="choice"], label'
  ));
  if (custom.some((el) => {
    const aria = (el.getAttribute('aria-checked') || '').toLowerCase();
    if (aria === 'true') return true;
    const cls = (el.className && String(el.className) || '').toLowerCase();
    if (/\\b(selected|active|checked|chosen|is-selected|is-checked|current)\\b/.test(cls)) return true;
    const data = (el.getAttribute('data-selected') || el.getAttribute('data-checked') || '').toLowerCase();
    if (data === 'true' || data === '1') return true;
    return false;
  })) return true;
  const texts = Array.from(document.querySelectorAll(
    'input[type=text], input[type=number], input:not([type]), textarea'
  )).filter((el) => {
    const t = (el.type || 'text').toLowerCase();
    return !['radio','checkbox','button','submit','hidden'].includes(t);
  });
  if (texts.some((el) => String(el.value || '').trim().length > 0)) return true;
  const selects = Array.from(document.querySelectorAll('select'));
  if (selects.length >= 2) {
    return selects.every((s) => String(s.value || '').trim().length > 0);
  }
  // matching via small number boxes
  if (/соответств/i.test(document.body && document.body.innerText || '')) {
    const small = Array.from(document.querySelectorAll('input[type=number], input[type=text]')).filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 8 && r.width < 120 && r.height > 8;
    });
    if (small.length >= 2) return small.every((el) => String(el.value || '').trim().length > 0);
  }
  return false;
})()`,
    );
  } finally {
    session.close();
  }
}

/**
 * Focus the quiz textbox and type an answer (fill-in-the-blank).
 * Uses cursor click + CDP insertText + DOM value fallback.
 */
export async function browserQuizFillText(
  answer: string,
  preferred: PreferredBrowser = "auto",
): Promise<string> {
  const text = String(answer ?? "").trim();
  if (!text) return "ERROR: empty text answer";
  await ensureBrowser("about:blank", preferred);
  const { session } = await connectPage();
  try {
    await session.send("Page.bringToFront").catch(() => undefined);
    const hit = await session.evaluate<{
      ok: boolean;
      cssX: number;
      cssY: number;
      screenX: number;
      screenY: number;
    }>(`(() => {
  const fields = Array.from(document.querySelectorAll(
    'input[type=text], input[type=number], input:not([type]), textarea, input[type=search]'
  )).filter((el) => {
    const t = (el.type || 'text').toLowerCase();
    if (['radio','checkbox','button','submit','hidden','file','image'].includes(t)) return false;
    const r = el.getBoundingClientRect();
    return r.width > 20 && r.height > 10;
  });
  if (!fields.length) return { ok: false, cssX: 0, cssY: 0, screenX: 0, screenY: 0 };
  const el = fields[0];
  el.scrollIntoView({ block: 'center', inline: 'nearest' });
  const r = el.getBoundingClientRect();
  const cssX = Math.round(r.left + r.width / 2);
  const cssY = Math.round(r.top + r.height / 2);
  const leftPad = (window.outerWidth - window.innerWidth) / 2;
  const topChrome = window.outerHeight - window.innerHeight;
  return {
    ok: true,
    cssX, cssY,
    screenX: Math.round(window.screenX + leftPad + cssX),
    screenY: Math.round(window.screenY + topChrome + cssY),
  };
})()`);

    if (!hit.ok) return "ERROR: на странице нет текстового поля ответа";

    // Visible cursor → click field
    try {
      await focusBrowserOsWindow(preferred);
      const { xplatMouseClick } = await import("./platform-input.js");
      await xplatMouseClick(hit.screenX, hit.screenY);
      await sleep(150);
    } catch {
      /* CDP below */
    }

    await session.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: hit.cssX,
      y: hit.cssY,
      button: "left",
      clickCount: 1,
    });
    await session.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: hit.cssX,
      y: hit.cssY,
      button: "left",
      clickCount: 1,
    });
    await sleep(120);

    // Select-all + clear, then type
    await session.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      modifiers: 2,
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
    }).catch(() => undefined);
    await session.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      modifiers: 2,
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
    }).catch(() => undefined);
    await session.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Backspace",
      code: "Backspace",
      windowsVirtualKeyCode: 8,
    }).catch(() => undefined);
    await session.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Backspace",
      code: "Backspace",
      windowsVirtualKeyCode: 8,
    }).catch(() => undefined);

    await session.send("Input.insertText", { text }).catch(() => undefined);

    // Nuclear DOM set (React/OTP often need input+change events)
    const ok = await session.evaluate<boolean>(
      `(() => {
  const want = ${JSON.stringify(text)};
  const fields = Array.from(document.querySelectorAll(
    'input[type=text], input[type=number], input:not([type]), textarea, input[type=search]'
  )).filter((el) => {
    const t = (el.type || 'text').toLowerCase();
    return !['radio','checkbox','button','submit','hidden','file'].includes(t);
  });
  const el = fields[0];
  if (!el) return false;
  el.focus();
  const proto = el.tagName === 'TEXTAREA'
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc && desc.set) desc.set.call(el, want);
  else el.value = want;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  return String(el.value || '').trim() === want;
})()`,
    );

    // OS keyboard backup if still empty
    if (!ok) {
      try {
        const { xplatTypeText } = await import("./platform-input.js");
        await xplatTypeText(text);
      } catch {
        /* optional */
      }
      await session.evaluate(
        `(() => {
  const want = ${JSON.stringify(text)};
  const el = document.querySelector('input[type=text], input[type=number], input:not([type]), textarea');
  if (!el) return;
  el.focus();
  el.value = want;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
})()`,
      );
    }

    await sleep(200);
    const finalOk = await session.evaluate<boolean>(
      `(() => {
  const want = ${JSON.stringify(text)};
  const fields = Array.from(document.querySelectorAll(
    'input[type=text], input[type=number], input:not([type]), textarea'
  ));
  return fields.some((el) => String(el.value || '').trim() === want);
})()`,
    );

    return finalOk
      ? `OK typed «${text}» into textbox`
      : `ERROR: не удалось вписать «${text}» в текстовое поле`;
  } finally {
    session.close();
  }
}

/**
 * Set matching/<select> values by 1-based index → option value/text.
 * values like ["4","1","2","3"] for four rows.
 */
export async function browserQuizSetSelects(
  values: Array<string | number>,
  preferred: PreferredBrowser = "auto",
): Promise<string> {
  await ensureBrowser("about:blank", preferred);
  const { session } = await connectPage();
  try {
    const result = await session.evaluate<{ ok: number; total: number; detail: string }>(
      `(() => {
  const want = ${JSON.stringify(values.map(String))};
  let controls = Array.from(document.querySelectorAll('select')).filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 10 && r.height > 8;
  });
  // Online Test Pad sometimes uses tiny number inputs instead of <select>
  if (controls.length < 2) {
    controls = Array.from(document.querySelectorAll('input[type=number], input[type=text]')).filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 8 && r.width < 120 && r.height > 8;
    });
  }
  let ok = 0;
  const notes = [];
  for (let i = 0; i < Math.min(want.length, controls.length); i++) {
    const sel = controls[i];
    const v = String(want[i] || '').trim();
    if (!v) continue;
    if (sel.tagName === 'SELECT') {
      let set = false;
      const opts = Array.from(sel.options || []);
      for (const o of opts) {
        if (String(o.value) === v || String(o.text).trim() === v) {
          sel.value = o.value;
          set = true;
          break;
        }
      }
      if (!set) {
        const numOpts = opts.filter((o) => /^\\d+$/.test(String(o.text || o.value).trim()));
        const idx = parseInt(v, 10) - 1;
        if (numOpts[idx]) { sel.value = numOpts[idx].value; set = true; }
        else if (opts[parseInt(v, 10)]) { sel.selectedIndex = parseInt(v, 10); set = true; }
      }
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      if (set && String(sel.value || '').length) { ok++; notes.push((i+1)+'='+sel.value); }
      else notes.push((i+1)+'=FAIL');
    } else {
      sel.focus();
      const proto = window.HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(sel, v); else sel.value = v;
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      if (String(sel.value || '').trim() === v) { ok++; notes.push((i+1)+'='+v); }
      else notes.push((i+1)+'=FAIL');
    }
  }
  return { ok, total: controls.length, detail: notes.join(', ') };
})()`,
    );
    return result.ok >= Math.max(1, Math.min(values.length, result.total))
      ? `OK selects ${result.ok}/${result.total}: ${result.detail}`
      : `ERROR: selects ${result.ok}/${result.total}: ${result.detail}`;
  } finally {
    session.close();
  }
}

export type VisionPageAction =
  | { op: "click"; x: number; y: number }
  | { op: "click_text"; text: string }
  | { op: "type"; text: string }
  | { op: "select"; index: number; value: string | number }
  | { op: "selects"; values: Array<string | number> }
  | { op: "option"; index: number }
  | { op: "next" };

/** Execute a batch of vision-decided page actions (CDP mouse / type / select). */
export async function browserExecuteVisionActions(
  actions: VisionPageAction[],
  preferred: PreferredBrowser = "auto",
  opts?: { allowNext?: boolean },
): Promise<string[]> {
  const allowNext = opts?.allowNext === true;
  const logs: string[] = [];
  for (const a of actions) {
    if (a.op === "next") {
      if (!allowNext) {
        logs.push("BLOCKED next — сначала выбери ответ (answer-before-next gate)");
        continue;
      }
      logs.push(await browserQuizAdvance(preferred, false, true));
      continue;
    }
    if (a.op === "click") {
      logs.push(await browserClickCss(a.x, a.y, preferred));
    } else if (a.op === "click_text") {
      const t = String(a.text || "");
      if (!allowNext && /^(далее|next|продолжить|ответить|завершить|finish)$/i.test(t.trim())) {
        logs.push(`BLOCKED click_text «${t}» — нельзя жать Далее до выбора ответа`);
        continue;
      }
      logs.push(await browserClickText(t, preferred, { exclude: ["завершить"] }));
    } else if (a.op === "type") {
      logs.push(await browserQuizFillText(a.text, preferred));
    } else if (a.op === "select") {
      logs.push(await browserQuizSetSelects(
        // pad previous empties so index maps correctly — set only this index by reading current
        await (async () => {
          const snap = await browserReadQuiz(preferred);
          const vals = (snap.selectTargets || []).map((s) => s.value || "");
          const i = Math.max(1, Number(a.index)) - 1;
          while (vals.length <= i) vals.push("");
          vals[i] = String(a.value);
          return vals;
        })(),
        preferred,
      ));
    } else if (a.op === "selects") {
      logs.push(await browserQuizSetSelects(a.values, preferred));
    } else if (a.op === "option") {
      logs.push(await browserSelectQuizOptionWithCursor(a.index, preferred));
    }
    await sleep(280);
  }
  return logs;
}

/** Click Далее/Next on quiz — never Завершить (unless allowFinish). */
export async function browserQuizAdvance(
  preferred: PreferredBrowser = "auto",
  allowFinish = false,
  requireSelection = false,
): Promise<string> {
  if (requireSelection) {
    const has = await browserQuizHasSelection(preferred);
    if (!has) {
      return "ERROR: нельзя Далее — нет выбранного ответа (radio/checkbox/текст пуст)";
    }
  }
  const labels = allowFinish
    ? ["Далее", "Next", "Ответить", "Продолжить", "Завершить", "Finish"]
    : ["Далее", "Next", "Ответить", "Продолжить"];
  for (const label of labels) {
    const click = await browserClickText(label, preferred, {
      exclude: allowFinish ? [] : ["завершить", "finish"],
    });
    if (click.startsWith("OK")) return click;
  }
  return "ERROR: нет кнопки Далее";
}

/**
 * Capture the CURRENT page via CDP (ignores terminal overlay on top of the OS window).
 * Returns a JPEG path for vision models.
 */
export async function browserCapturePageImage(
  preferred: PreferredBrowser = "auto",
): Promise<{ path: string; width: number; height: number; mimeType: string }> {
  await ensureBrowser("about:blank", preferred);
  const { session } = await connectPage();
  try {
    await session.send("Page.enable");
    await session.send("Page.bringToFront").catch(() => undefined);
    const shot = (await session.send("Page.captureScreenshot", {
      format: "jpeg",
      quality: 80,
      fromSurface: true,
    })) as { data?: string };
    if (!shot?.data) throw new Error("Page.captureScreenshot returned empty");
    const dir = join(homedir(), ".heyagent", "screenshots");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `page-${Date.now()}.jpg`);
    writeFileSync(path, Buffer.from(shot.data, "base64"));
    const metrics = await session
      .evaluate<{ w: number; h: number }>(
        `(() => ({ w: window.innerWidth || 1280, h: window.innerHeight || 720 }))()`,
      )
      .catch(() => ({ w: 1280, h: 720 }));
    return { path, width: metrics.w, height: metrics.h, mimeType: "image/jpeg" };
  } finally {
    session.close();
  }
}

/** Click inside the page at CSS viewport coordinates (CDP mouse — works under other windows). */
export async function browserClickCss(
  x: number,
  y: number,
  preferred: PreferredBrowser = "auto",
): Promise<string> {
  await ensureBrowser("about:blank", preferred);
  const { session } = await connectPage();
  try {
    const xi = Math.round(x);
    const yi = Math.round(y);
    await session.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: xi,
      y: yi,
    });
    await session.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: xi,
      y: yi,
      button: "left",
      clickCount: 1,
    });
    await session.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: xi,
      y: yi,
      button: "left",
      clickCount: 1,
    });
    await sleep(350);
    return `OK CDP-clicked at css(${xi},${yi})`;
  } finally {
    session.close();
  }
}

/** Bring the real browser OS window to the foreground (for desktop mouse / screen.see). */
export async function focusBrowserOsWindow(
  preferred: PreferredBrowser = "auto",
): Promise<string> {
  const { focusApp } = await import("./platform-input.js");
  const patterns =
    preferred === "yandex"
      ? ["browser", "Yandex"]
      : preferred === "edge"
        ? ["msedge", "MicrosoftEdge"]
        : preferred === "chrome"
          ? ["chrome"]
          : ["browser", "chrome", "msedge", "Yandex"];
  const ok = await focusApp(patterns);
  await sleep(400);
  return ok ? `OK focused browser (${patterns.join("|")})` : "WARNING: could not focus browser window";
}

/**
 * See the page (CDP screenshot) + click a quiz option by index via real cursor on the circle.
 */
export async function browserVisionSelectOption(
  index: number,
  preferred: PreferredBrowser = "auto",
): Promise<string> {
  return browserSelectQuizOptionWithCursor(index, preferred);
}

/** Read main visible page text for the focused/best CDP tab. */
export async function browserReadPageText(
  preferred: PreferredBrowser = "auto",
  maxChars = 6000,
): Promise<string> {
  await ensureBrowser("about:blank", preferred);
  const { session } = await connectPage();
  try {
    const info = await session.evaluate<{ url: string; title: string; body: string }>(
      `(() => ({
  url: location.href,
  title: document.title || '',
  body: (document.body && document.body.innerText || '').slice(0, ${Math.max(500, maxChars)})
}))()`,
    );
    return `URL: ${info.url}\nTitle: ${info.title}\n\n${info.body}`;
  } finally {
    session.close();
  }
}

/**
 * Focus a tab matching the query, then optionally click «Далее» / start.
 * Does not invent a new search — fails with tab list if nothing matches.
 */
export async function browserUseOpenTab(
  query: string,
  preferred: PreferredBrowser = "auto",
): Promise<string> {
  const focus = await browserFocusTab(query, preferred);
  if (focus.startsWith("ERROR")) return focus;
  const lines = [focus];
  // Common intro CTAs on quiz platforms
  for (const label of ["Далее", "Начать", "Start", "Next", "Приступить"]) {
    const click = await browserClickText(label, preferred);
    if (click.startsWith("OK")) {
      lines.push(click);
      break;
    }
  }
  const text = await browserReadPageText(preferred, 3500);
  lines.push("--- page ---");
  lines.push(text.slice(0, 2500));
  return lines.join("\n");
}

export async function browserEval(
  expression: string,
  preferred: PreferredBrowser = "auto",
): Promise<string> {
  await ensureBrowser("about:blank", preferred);
  const { session } = await connectPage();
  try {
    const value = await session.evaluate(expression);
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } finally {
    session.close();
  }
}

/** Same-tab tour with URL verification after each hop. */
export async function browserTourVerified(
  urls: string[],
  preferred: PreferredBrowser = "auto",
  settleMs = 1400,
): Promise<string> {
  resetBrowserMissionCancel();
  const list = urls.map((u) => u.trim()).filter(Boolean);
  if (!list.length) return "ERROR: no URLs";
  const lines: string[] = [];
  await ensureBrowser(list[0]!, preferred);
  const { session } = await connectPage();
  try {
    for (let i = 0; i < list.length; i++) {
      if (cancelFlag) {
        lines.push(`CANCELLED at step ${i + 1}/${list.length}`);
        break;
      }
      const want = list[i]!;
      await session.navigate(want, settleMs);
      await dismissPopups(session);
      const page = await readPageState(session);
      if (page.blocker === "captcha") {
        lines.push(`STOP: CAPTCHA at step ${i + 1}: ${page.url}`);
        lines.push("Не могу продолжить — требуется человек (CAPTCHA).");
        break;
      }
      const ok =
        page.url.includes(new URL(want).hostname) ||
        page.url.replace(/\/$/, "").startsWith(want.replace(/\/$/, "").slice(0, 40));
      lines.push(
        `${i + 1}. ${ok ? "OK" : "WARN"} want=${want} got=${page.url} title=${page.title.slice(0, 80)}`,
      );
      saveMissionState({
        missionId: "tour",
        kind: "tour",
        step: i + 1,
        steps: list,
        lastUrl: page.url,
        updatedAt: new Date().toISOString(),
        cancelled: cancelFlag,
      });
    }
  } finally {
    session.close();
  }
  return lines.join("\n");
}
