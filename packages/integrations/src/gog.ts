/**
 * OpenClaw-style Google Workspace bridge via `gog` (gogcli).
 * OpenClaw does not own Google OAuth — it uses gog for tokens + API.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const WINGET_GOG = join(
  process.env.LOCALAPPDATA ?? "",
  "Microsoft",
  "WinGet",
  "Packages",
  "steipete.gogcli_Microsoft.Winget.Source_8wekyb3d8bbwe",
  "gog.exe",
);

export function resolveGogBinary(): string | null {
  if (process.env.GOG_BIN && existsSync(process.env.GOG_BIN)) return process.env.GOG_BIN;
  if (process.platform === "win32" && existsSync(WINGET_GOG)) return WINGET_GOG;
  // PATH lookup is done at exec time via shell-less spawn of "gog" / "gog.exe"
  return process.platform === "win32" ? "gog.exe" : "gog";
}

export async function gogAvailable(): Promise<boolean> {
  const bin = resolveGogBinary();
  if (!bin) return false;
  if (bin.includes("\\") || bin.includes("/")) return existsSync(bin);
  try {
    const r = await runGog(["--version"], { timeoutMs: 8_000 });
    return r.code === 0;
  } catch {
    return false;
  }
}

export interface GogRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runGog(
  args: string[],
  opts: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<GogRunResult> {
  const bin = resolveGogBinary();
  if (!bin) {
    return Promise.resolve({
      code: 127,
      stdout: "",
      stderr: "gog not found. Install: winget install steipete.gogcli",
    });
  }
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      env: { ...process.env, ...opts.env },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ code: 124, stdout, stderr: stderr || "gog timeout" });
    }, opts.timeoutMs ?? 120_000);
    child.stdout.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export async function gogAuthList(): Promise<string> {
  const r = await runGog(["auth", "list", "--json"], { timeoutMs: 15_000 });
  if (r.code !== 0) return r.stderr || r.stdout || "gog auth list failed";
  return r.stdout.trim() || r.stderr.trim();
}

export async function gogHasAccount(): Promise<boolean> {
  const r = await runGog(["auth", "list", "--json"], { timeoutMs: 15_000 });
  if (r.code !== 0) return false;
  const text = `${r.stdout}${r.stderr}`;
  if (!text.trim()) return false;
  try {
    const parsed = JSON.parse(r.stdout || "[]") as unknown;
    if (Array.isArray(parsed)) return parsed.length > 0;
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      if (Array.isArray(obj.accounts)) return obj.accounts.length > 0;
      if (Array.isArray(obj.result)) return obj.result.length > 0;
    }
  } catch {
    // plain text fallback
  }
  return /@/.test(text) && !/no accounts|empty/i.test(text);
}

export async function gogSetCredentials(credentialsPath: string): Promise<string> {
  const r = await runGog(["auth", "credentials", "set", credentialsPath], {
    timeoutMs: 30_000,
  });
  if (r.code !== 0) {
    return `ERROR: ${r.stderr || r.stdout || "gog auth credentials set failed"}`;
  }
  return r.stdout.trim() || r.stderr.trim() || "OAuth client credentials stored in gog.";
}

export async function gogAuthAdd(
  email: string,
  services = "gmail,calendar,drive,contacts,docs,sheets",
  opts: { listenAddr?: string } = {},
): Promise<string> {
  const listen = opts.listenAddr ?? "127.0.0.1:19876";
  const r = await runGog(
    [
      "auth",
      "add",
      email,
      "--services",
      services,
      "--force-consent",
      "--gmail-scope",
      "readonly",
      "--listen-addr",
      listen,
    ],
    { timeoutMs: 10 * 60_000 },
  );
  if (r.code !== 0) {
    return `ERROR: ${r.stderr || r.stdout || "gog auth add failed"}`;
  }
  return r.stdout.trim() || r.stderr.trim() || `Google account ${email} authorized via gog.`;
}

/** OpenClaw-compatible inbox summary via gog. */
export async function gogGmailSummary(limit = 10, unreadOnly = false): Promise<string> {
  const pageSize = Math.max(1, Math.min(Number(limit) || 10, 25));
  const query = unreadOnly ? "in:inbox is:unread" : "in:inbox";
  const r = await runGog(
    ["gmail", "messages", "search", query, "--max", String(pageSize), "--json"],
    { timeoutMs: 60_000 },
  );
  if (r.code !== 0) {
    // fallback to thread search
    const r2 = await runGog(["gmail", "search", query, "--max", String(pageSize), "--json"], {
      timeoutMs: 60_000,
    });
    if (r2.code !== 0) {
      return [
        "ERROR: gog не смог прочитать Gmail.",
        r.stderr || r.stdout || r2.stderr || r2.stdout,
        "Подключи Gmail отдельно: npx hey connect gmail",
      ].join("\n");
    }
    return formatGogMailJson(r2.stdout, pageSize);
  }
  return formatGogMailJson(r.stdout, pageSize);
}

function formatGogMailJson(raw: string, limit: number): string {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return raw.trim() || "Пустой ответ gog.";
  }

  const rows = extractMailRows(data).slice(0, limit);
  if (rows.length === 0) {
    return "Входящих писем не найдено.";
  }

  const lines = rows.map((row, i) => {
    const from = row.from || row.From || row.sender || "неизвестно";
    const subject = row.subject || row.Subject || "(без темы)";
    const date = row.date || row.Date || row.internalDate || "";
    const snippet = cleanSnippet(String(row.snippet || row.Snippet || row.preview || ""));
    return [
      `${i + 1}. От: ${from}`,
      `   Тема: ${subject}`,
      date ? `   Дата: ${date}` : null,
      snippet ? `   Кратко: ${snippet}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  });

  return [`Последние письма (${rows.length}):`, ...lines].join("\n\n");
}

function extractMailRows(data: unknown): Array<Record<string, string>> {
  if (Array.isArray(data)) {
    return data.filter((x) => x && typeof x === "object") as Array<Record<string, string>>;
  }
  if (!data || typeof data !== "object") return [];
  const obj = data as Record<string, unknown>;
  for (const key of ["messages", "threads", "result", "results", "items", "data"]) {
    const v = obj[key];
    if (Array.isArray(v)) {
      return v.filter((x) => x && typeof x === "object") as Array<Record<string, string>>;
    }
  }
  return [];
}

function cleanSnippet(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 180);
}

export function gogHomeHint(): string {
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "gogcli");
  }
  return join(homedir(), ".config", "gogcli");
}
