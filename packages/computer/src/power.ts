/**
 * Power tools — OpenClaw parity + HeyAgent extras (download, HTTP, archives,
 * processes, system, reports, code snippets).
 */
import {
  readFile as fsRead,
  writeFile as fsWrite,
  copyFile,
  rename,
  mkdir,
  readdir,
  stat,
  access,
} from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { platform, homedir, tmpdir, cpus, totalmem, freemem, hostname, arch } from "node:os";
import { join, basename, dirname, extname, resolve } from "node:path";
import { getHeyAgentHome, ensureDir } from "@heyagent/shared";
import { mkdir as mkdirFs } from "node:fs/promises";
import { runPowerShellQuiet } from "./ps-quiet.js";

const execAsync = promisify(exec);

export function desktopPath(): string {
  return join(homedir(), "Desktop");
}

export function documentsPath(): string {
  return join(homedir(), "Documents");
}

export function downloadsPath(): string {
  return join(homedir(), "Downloads");
}

export async function systemInfo(): Promise<string> {
  const lines = [
    `hostname: ${hostname()}`,
    `platform: ${platform()} ${arch()}`,
    `home: ${homedir()}`,
    `desktop: ${desktopPath()}`,
    `documents: ${documentsPath()}`,
    `downloads: ${downloadsPath()}`,
    `heyagent: ${getHeyAgentHome()}`,
    `cpus: ${cpus().length}`,
    `memory: ${Math.round(freemem() / 1e9)}GB free / ${Math.round(totalmem() / 1e9)}GB total`,
    `cwd: ${process.cwd()}`,
    `node: ${process.version}`,
  ];
  return lines.join("\n");
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function fileInfo(path: string): Promise<string> {
  const s = await stat(path);
  return JSON.stringify(
    {
      path: resolve(path),
      size: s.size,
      isFile: s.isFile(),
      isDirectory: s.isDirectory(),
      mtime: s.mtime.toISOString(),
      ext: extname(path),
    },
    null,
    2,
  );
}

export async function fileCopy(src: string, dest: string): Promise<string> {
  await ensureParent(dest);
  await copyFile(src, dest);
  return `Copied ${src} → ${dest}`;
}

export async function fileMove(src: string, dest: string): Promise<string> {
  await ensureParent(dest);
  await rename(src, dest);
  return `Moved ${src} → ${dest}`;
}

export async function fileMkdir(path: string): Promise<string> {
  await mkdir(path, { recursive: true });
  return `Created directory ${path}`;
}

export async function fileEdit(
  path: string,
  oldText: string,
  newText: string,
  replaceAll = false,
): Promise<string> {
  const raw = await fsRead(path, "utf-8");
  if (!raw.includes(oldText)) {
    return `No match for oldText in ${path}`;
  }
  const next = replaceAll ? raw.split(oldText).join(newText) : raw.replace(oldText, newText);
  await fsWrite(path, next, "utf-8");
  return `Edited ${path} (${raw.length} → ${next.length} chars)`;
}

export async function fileFind(
  root: string,
  pattern: string,
  max = 50,
): Promise<string> {
  const needle = pattern.toLowerCase();
  const hits: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (hits.length >= max || depth > 8) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (hits.length >= max) break;
      const name = e.name;
      if (name === "node_modules" || name === ".git" || name === "dist") continue;
      const full = join(dir, name);
      if (name.toLowerCase().includes(needle)) hits.push(full);
      if (e.isDirectory()) await walk(full, depth + 1);
    }
  }
  await walk(resolve(root || "."), 0);
  return hits.length ? hits.join("\n") : `No matches for "${pattern}" under ${root}`;
}

async function ensureParent(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

export async function downloadFile(
  url: string,
  destPath?: string,
): Promise<string> {
  const u = url.trim();
  if (!u) return "URL is empty";
  const res = await fetch(u, {
    redirect: "follow",
    headers: { "User-Agent": "HeyAgent/0.1 (local-agent)" },
  });
  if (!res.ok) return `Download failed: HTTP ${res.status}`;
  const nameFromUrl = basename(new URL(u).pathname) || `download-${Date.now()}`;
  const out =
    destPath?.trim() ||
    join(downloadsPath(), nameFromUrl.includes(".") ? nameFromUrl : `${nameFromUrl}.bin`);
  await ensureParent(out);
  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer());
    await fsWrite(out, buf);
  } else {
    const nodeStream = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
    await pipeline(nodeStream, createWriteStream(out));
  }
  const s = await stat(out);
  return `Downloaded ${s.size} bytes → ${out}`;
}

export async function httpRequest(
  method: string,
  url: string,
  body?: string,
  headersJson?: string,
  maxChars = 20000,
): Promise<string> {
  const headers: Record<string, string> = {
    "User-Agent": "HeyAgent/0.1",
    Accept: "*/*",
  };
  if (headersJson) {
    try {
      Object.assign(headers, JSON.parse(headersJson) as Record<string, string>);
    } catch {
      /* ignore */
    }
  }
  const res = await fetch(url, {
    method: (method || "GET").toUpperCase(),
    headers,
    body: body && method.toUpperCase() !== "GET" ? body : undefined,
    redirect: "follow",
  });
  const text = await res.text();
  return [
    `HTTP ${res.status} ${res.statusText}`,
    `content-type: ${res.headers.get("content-type") ?? ""}`,
    text.slice(0, maxChars),
  ].join("\n");
}

export async function zipCreate(sourcePath: string, zipPath?: string): Promise<string> {
  const src = resolve(sourcePath);
  const out =
    zipPath?.trim() ||
    join(dirname(src), `${basename(src)}.zip`);
  const os = platform();
  if (os === "win32") {
    const ps = `Compress-Archive -Path '${src.replace(/'/g, "''")}' -DestinationPath '${out.replace(/'/g, "''")}' -Force`;
    await execAsync(ps, { shell: "powershell.exe" });
  } else {
    await execAsync(`cd "${dirname(src)}" && zip -r "${out}" "${basename(src)}"`);
  }
  return `Created archive ${out}`;
}

export async function zipExtract(zipPath: string, destDir?: string): Promise<string> {
  const z = resolve(zipPath);
  const dest = destDir?.trim() || join(dirname(z), basename(z, extname(z)));
  await mkdir(dest, { recursive: true });
  const os = platform();
  if (os === "win32") {
    const ps = `Expand-Archive -Path '${z.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`;
    await execAsync(ps, { shell: "powershell.exe" });
  } else {
    await execAsync(`unzip -o "${z}" -d "${dest}"`);
  }
  return `Extracted ${z} → ${dest}`;
}

export async function processList(filter?: string): Promise<string> {
  const os = platform();
  if (os === "win32") {
    const { stdout } = await execAsync(
      "Get-Process | Select-Object Id,ProcessName,CPU | Format-Table -AutoSize | Out-String -Width 200",
      { shell: "powershell.exe", maxBuffer: 5 * 1024 * 1024 },
    );
    const lines = stdout.split("\n");
    if (!filter) return lines.slice(0, 80).join("\n");
    const f = filter.toLowerCase();
    return lines.filter((l) => l.toLowerCase().includes(f)).slice(0, 80).join("\n") || "No matches";
  }
  const { stdout } = await execAsync("ps aux", { maxBuffer: 5 * 1024 * 1024 });
  if (!filter) return stdout.split("\n").slice(0, 80).join("\n");
  const f = filter.toLowerCase();
  return stdout
    .split("\n")
    .filter((l) => l.toLowerCase().includes(f))
    .slice(0, 80)
    .join("\n");
}

export async function processKill(pid: number): Promise<string> {
  const os = platform();
  if (os === "win32") {
    await execAsync(`Stop-Process -Id ${pid} -Force`, { shell: "powershell.exe" });
  } else {
    await execAsync(`kill ${pid}`);
  }
  return `Killed process ${pid}`;
}

export async function applicationSearch(query: string): Promise<string> {
  const q = query.trim();
  if (!q) return "ERROR: Название программы не указано.";
  if (platform() === "win32") {
    const manager = await detectWindowsPackageManager();
    if (manager === "winget") {
      const { stdout, stderr } = await execAsync(
        `winget search --query "${escapeCmdArg(q)}" --accept-source-agreements --disable-interactivity`,
        { timeout: 120_000, maxBuffer: 5e6, windowsHide: true },
      );
      return [stdout, stderr].filter(Boolean).join("\n").trim() || "Программы не найдены.";
    }
    if (manager === "choco") {
      const { stdout } = await execAsync(`choco search "${escapeCmdArg(q)}" --limit-output`, {
        timeout: 120_000,
        maxBuffer: 5e6,
        windowsHide: true,
      });
      return stdout.trim() || "Программы не найдены.";
    }
    if (manager === "scoop") {
      const { stdout } = await execAsync(`scoop search "${escapeCmdArg(q)}"`, {
        timeout: 120_000,
        maxBuffer: 5e6,
        windowsHide: true,
      });
      return stdout.trim() || "Программы не найдены.";
    }
    return "ERROR: Не найден менеджер программ (winget/choco/scoop).";
  }
  const command =
    platform() === "darwin"
      ? `brew search "${escapeCmdArg(q)}"`
      : `apt-cache search "${escapeCmdArg(q)}"`;
  const { stdout, stderr } = await execAsync(command, { timeout: 120_000, maxBuffer: 5e6 });
  return [stdout, stderr].filter(Boolean).join("\n").trim() || "Программы не найдены.";
}

export async function applicationInstall(
  packageNameOrId: string,
  exact = false,
): Promise<string> {
  const pkg = packageNameOrId.trim();
  if (!pkg) return "ERROR: Название или ID программы не указано.";

  if (platform() === "win32") {
    const manager = await detectWindowsPackageManager();
    if (!manager) return "ERROR: Не найден менеджер программ (winget/choco/scoop).";

    let command: string;
    if (manager === "winget") {
      const selector = exact || pkg.includes(".") ? "--id" : "--query";
      command = [
        "winget install",
        `${selector} "${escapeCmdArg(pkg)}"`,
        exact || selector === "--id" ? "--exact" : "",
        "--silent",
        "--accept-package-agreements",
        "--accept-source-agreements",
        "--disable-interactivity",
      ]
        .filter(Boolean)
        .join(" ");
    } else if (manager === "choco") {
      command = `choco install "${escapeCmdArg(pkg)}" -y --no-progress`;
    } else {
      command = `scoop install "${escapeCmdArg(pkg)}"`;
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: 20 * 60_000,
        maxBuffer: 10e6,
        windowsHide: true,
      });
      const output = [stdout, stderr].filter(Boolean).join("\n").trim();
      const verify =
        manager === "winget"
          ? await execAsync(
              `winget list --query "${escapeCmdArg(pkg)}" --accept-source-agreements --disable-interactivity`,
              { timeout: 120_000, maxBuffer: 3e6, windowsHide: true },
            ).catch(() => ({ stdout: "", stderr: "" }))
          : { stdout: output, stderr: "" };
      if (!verify.stdout.trim() && !/successfully installed|успешно установлен/i.test(output)) {
        return `ERROR: Установка завершилась без подтверждения. Вывод:\n${output.slice(-3000)}`;
      }
      return [
        `INSTALLED and verified: ${pkg}`,
        `Package manager: ${manager}`,
        output.slice(-2500),
      ].join("\n");
    } catch (err) {
      return `ERROR: Не удалось установить ${pkg}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  const command =
    platform() === "darwin"
      ? `brew install --cask "${escapeCmdArg(pkg)}" || brew install "${escapeCmdArg(pkg)}"`
      : `sudo apt-get update && sudo apt-get install -y "${escapeCmdArg(pkg)}"`;
  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: 20 * 60_000,
      maxBuffer: 10e6,
    });
    return `INSTALLED: ${pkg}\n${[stdout, stderr].filter(Boolean).join("\n").slice(-3000)}`;
  } catch (err) {
    return `ERROR: Не удалось установить ${pkg}: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function applicationUninstall(packageNameOrId: string): Promise<string> {
  const pkg = packageNameOrId.trim();
  if (!pkg) return "ERROR: Название или ID программы не указано.";
  if (platform() === "win32") {
    const manager = await detectWindowsPackageManager();
    if (!manager) return "ERROR: Не найден менеджер программ.";
    const command =
      manager === "winget"
        ? `winget uninstall --query "${escapeCmdArg(pkg)}" --silent --disable-interactivity`
        : manager === "choco"
          ? `choco uninstall "${escapeCmdArg(pkg)}" -y`
          : `scoop uninstall "${escapeCmdArg(pkg)}"`;
    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: 15 * 60_000,
        maxBuffer: 8e6,
        windowsHide: true,
      });
      return `UNINSTALLED: ${pkg}\n${[stdout, stderr].filter(Boolean).join("\n").slice(-2500)}`;
    } catch (err) {
      return `ERROR: Не удалось удалить ${pkg}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return "ERROR: app.uninstall пока поддерживает Windows.";
}

async function detectWindowsPackageManager(): Promise<"winget" | "choco" | "scoop" | null> {
  for (const name of ["winget", "choco", "scoop"] as const) {
    try {
      await execAsync(`where.exe ${name}`, { timeout: 10_000, windowsHide: true });
      return name;
    } catch {
      // try the next manager
    }
  }
  return null;
}

function escapeCmdArg(value: string): string {
  return value.replace(/"/g, '\\"');
}

export async function windowList(): Promise<string> {
  if (platform() !== "win32") {
    return "window.list is best supported on Windows. Use app.open / shell instead.";
  }
  const ps = `
Get-Process | Where-Object { $_.MainWindowTitle } |
  Select-Object Id, ProcessName, MainWindowTitle |
  Format-Table -AutoSize | Out-String -Width 220
`;
  const { stdout } = await execAsync(ps, { shell: "powershell.exe", maxBuffer: 2 * 1024 * 1024 });
  return stdout.trim() || "No windows with titles";
}

export async function windowFocus(titleSubstring: string): Promise<string> {
  if (platform() !== "win32") return "window.focus currently Windows-only";
  const ps = `
$w = New-Object -ComObject WScript.Shell
$hit = Get-Process | Where-Object { $_.MainWindowTitle -match '${titleSubstring.replace(/'/g, "''")}' } | Select-Object -First 1
if ($hit) { $w.AppActivate($hit.MainWindowTitle) | Out-Null; "Focused: $($hit.MainWindowTitle)" }
else { "No window matching: ${titleSubstring.replace(/'/g, "''")}" }
`;
  const { stdout } = await execAsync(ps, { shell: "powershell.exe" });
  return stdout.trim();
}

export async function writeReport(
  title: string,
  contentMarkdown: string,
  format: "md" | "html" | "txt" | "pdf" = "md",
  destDir?: string,
): Promise<string> {
  if (format === "pdf") {
    const { writeReportPdf, sectionsFromMarkdown } = await import("./report-pdf.js");
    const sections = sectionsFromMarkdown(contentMarkdown);
    const r = await writeReportPdf(title, sections, destDir);
    return r.message;
  }

  const safe = (title || "report").replace(/[^\w\- а-яА-ЯёЁ]+/gi, "_").slice(0, 60).trim() || "report";
  const dir = destDir?.trim() || join(documentsPath(), "HeyAgent-Reports");
  await ensureDir(dir, { mkdir: mkdirFs } as typeof import("node:fs/promises"));
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  let body = contentMarkdown;
  let ext = format;
  if (format === "html") {
    body = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font-family:Segoe UI,system-ui,sans-serif;max-width:800px;margin:2rem auto;padding:0 1rem;line-height:1.5;background:#f7f5f2}
.card{background:#fff;border-radius:12px;padding:1rem 1.25rem;margin:1rem 0;box-shadow:0 6px 20px rgba(0,0,0,.06)}
h1{color:#0f766e} h2{color:#134e4a;margin-top:0}</style>
</head><body><h1>${escapeHtml(title)}</h1>
${contentMarkdown
  .split(/\n(?=##\s+)/)
  .map((block) => {
    const m = block.match(/^##\s+(.+)\n([\s\S]*)$/);
    if (!m) return `<div class="card"><pre style="white-space:pre-wrap;font-family:inherit;background:transparent;padding:0;margin:0">${escapeHtml(block)}</pre></div>`;
    return `<div class="card"><h2>${escapeHtml(m[1]!.trim())}</h2><p>${escapeHtml(m[2]!.trim()).replace(/\n/g, "<br/>")}</p></div>`;
  })
  .join("\n")}
<p><small>Generated by HeyAgent ${stamp}</small></p></body></html>`;
  } else if (format === "txt") {
    ext = "txt";
  } else {
    body = `# ${title}\n\n${contentMarkdown}\n\n---\n_Generated by HeyAgent ${stamp}_\n`;
    ext = "md";
  }
  const path = join(dir, `${safe}-${stamp}.${ext}`);
  await fsWrite(path, body, "utf-8");
  return `Report written: ${path}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function codeRun(
  language: "node" | "python" | "powershell" | "bash",
  code: string,
): Promise<string> {
  const dir = join(tmpdir(), "heyagent-code");
  await mkdir(dir, { recursive: true });
  const id = Date.now().toString(36);
  try {
    if (language === "node") {
      const f = join(dir, `${id}.mjs`);
      await fsWrite(f, code, "utf-8");
      const { stdout, stderr } = await execAsync(`node "${f}"`, { timeout: 60_000, maxBuffer: 5e6 });
      return [stdout, stderr].filter(Boolean).join("\n") || "(no output)";
    }
    if (language === "python") {
      const f = join(dir, `${id}.py`);
      await fsWrite(f, code, "utf-8");
      const { stdout, stderr } = await execAsync(`python "${f}"`, { timeout: 60_000, maxBuffer: 5e6 }).catch(
        () => execAsync(`python3 "${f}"`, { timeout: 60_000, maxBuffer: 5e6 }),
      );
      return [stdout, stderr].filter(Boolean).join("\n") || "(no output)";
    }
    if (language === "powershell") {
      const f = join(dir, `${id}.ps1`);
      await fsWrite(f, code, "utf-8");
      const { stdout, stderr } = await execAsync(
        `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${f}"`,
        { timeout: 60_000, maxBuffer: 5e6 },
      );
      return [stdout, stderr].filter(Boolean).join("\n") || "(no output)";
    }
    const f = join(dir, `${id}.sh`);
    await fsWrite(f, code, "utf-8");
    const { stdout, stderr } = await execAsync(`bash "${f}"`, { timeout: 60_000, maxBuffer: 5e6 });
    return [stdout, stderr].filter(Boolean).join("\n") || "(no output)";
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function waitMs(ms: number): Promise<string> {
  const n = Math.min(Math.max(Number(ms) || 0, 0), 120_000);
  await new Promise((r) => setTimeout(r, n));
  return `Waited ${n}ms`;
}

export async function openPath(path: string): Promise<string> {
  const p = resolve(path);
  const os = platform();
  if (os === "win32") {
    await execAsync(`Start-Process '${p.replace(/'/g, "''")}'`, { shell: "powershell.exe" });
  } else if (os === "darwin") {
    await execAsync(`open "${p}"`);
  } else {
    await execAsync(`xdg-open "${p}"`);
  }
  return `Opened ${p}`;
}

/** Empty the Recycle Bin / Trash — real OS call, not a GUI suggestion. */
export async function emptyRecycleBin(): Promise<string> {
  const os = platform();
  if (os === "win32") {
    const attempts: { name: string; script: string }[] = [
      {
        name: "SHEmptyRecycleBin",
        script: `
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public class Recycle {
  [DllImport("shell32.dll", CharSet=CharSet.Unicode)]
  public static extern int SHEmptyRecycleBin(IntPtr hwnd, string pszRootPath, uint dwFlags);
}
"@
$r = [Recycle]::SHEmptyRecycleBin([IntPtr]::Zero, $null, 0x7)
if ($r -eq 0 -or $r -eq -2147418113 -or $r -eq -2147024894) { 'OK' } else { throw "HRESULT=$r" }
`,
      },
      {
        name: "Shell.Application COM",
        script: `
$shell = New-Object -ComObject Shell.Application
$bin = $shell.NameSpace(0xA)
if (-not $bin) { throw 'no recycle namespace' }
foreach ($i in @($bin.Items())) {
  try { Remove-Item -LiteralPath $i.Path -Recurse -Force -ErrorAction Stop } catch {}
}
try { $bin.Self.InvokeVerb('Empty Recycle Bin') } catch {}
try { $bin.Self.InvokeVerb('Очистить корзину') } catch {}
'OK'
`,
      },
      {
        name: "Clear-RecycleBin",
        script: `Clear-RecycleBin -Force -ErrorAction SilentlyContinue; 'OK'`,
      },
    ];

    for (const a of attempts) {
      const res = await runPowerShellQuiet(a.script, { timeoutMs: 60_000 });
      if (res.ok && /\bOK\b/i.test(res.out)) {
        return `Корзина очищена.`;
      }
    }

    const check = await runPowerShellQuiet(
      `$bin=(New-Object -ComObject Shell.Application).NameSpace(0xA); if($bin){@($bin.Items()).Count}else{-1}`,
      { timeoutMs: 15_000 },
    );
    if (check.ok && Number(check.out.trim()) === 0) {
      return "Корзина очищена.";
    }

    return "ERROR: не удалось очистить корзину.";
  }
  if (os === "darwin") {
    await execAsync(`osascript -e 'tell application "Finder" to empty trash'`);
    return "Trash emptied (macOS Finder).";
  }
  const trash = join(homedir(), ".local/share/Trash");
  await execAsync(
    `rm -rf "${trash}/files"/* "${trash}/info"/* 2>/dev/null; mkdir -p "${trash}/files" "${trash}/info"; echo OK`,
  ).catch(async () => {
    await execAsync("gio trash --empty 2>/dev/null || true");
  });
  return "Trash emptied (Linux).";
}

export async function gitStatus(cwd?: string): Promise<string> {
  const { stdout, stderr } = await execAsync("git status -sb", {
    cwd: cwd || process.cwd(),
    maxBuffer: 2e6,
  }).catch((e: Error) => ({ stdout: "", stderr: e.message }));
  return [stdout, stderr].filter(Boolean).join("\n");
}

export async function gitDiff(cwd?: string): Promise<string> {
  const { stdout, stderr } = await execAsync("git diff --stat HEAD", {
    cwd: cwd || process.cwd(),
    maxBuffer: 2e6,
  }).catch((e: Error) => ({ stdout: "", stderr: e.message }));
  return [stdout, stderr].filter(Boolean).join("\n").slice(0, 15000);
}
