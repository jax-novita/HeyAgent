/**
 * Quiet PowerShell runner — success returns stdout only (no stderr dumps in chat).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { platform } from "node:os";

const execFileAsync = promisify(execFile);

export async function runPowerShellQuiet(
  script: string,
  opts?: { timeoutMs?: number },
): Promise<{ ok: boolean; out: string }> {
  if (platform() !== "win32") {
    return { ok: false, out: "ERROR: только Windows" };
  }
  const timeoutMs = opts?.timeoutMs ?? 60_000;
  const file = join(tmpdir(), `heyagent-psq-${Date.now()}-${Math.random().toString(36).slice(2)}.ps1`);
  const wrapped = [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    "$WarningPreference = 'SilentlyContinue'",
    "try {",
    script,
    "  exit 0",
    "} catch {",
    "  [Console]::Out.WriteLine(('__PS_ERR__:' + $_.Exception.Message))",
    "  exit 1",
    "}",
  ].join("\n");
  writeFileSync(file, wrapped, "utf-8");
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file],
      {
        timeout: timeoutMs,
        maxBuffer: 4e6,
        windowsHide: true,
        encoding: "utf8",
      },
    );
    const out = String(stdout || "").trim();
    if (out.startsWith("__PS_ERR__:")) {
      return { ok: false, out: out.slice("__PS_ERR__:".length).trim() };
    }
    return { ok: true, out: out || "OK" };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const mixed = `${e.stdout || ""}\n${e.stderr || ""}`.trim();
    const line =
      mixed.match(/__PS_ERR__:(.+)/)?.[1]?.trim() ||
      mixed.split(/\r?\n/).find((l) => l.trim()) ||
      e.message ||
      String(err);
    // One short line — never full CategoryInfo dump for the chat
    return { ok: false, out: line.replace(/\s+/g, " ").slice(0, 240) };
  } finally {
    try {
      unlinkSync(file);
    } catch {
      /* ignore */
    }
  }
}
