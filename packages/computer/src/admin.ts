/**
 * Elevation / admin helpers for full PC control (OpenClaw-style).
 */
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { platform } from "node:os";
import { writeFileSync, unlinkSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const execAsync = promisify(exec);

export async function isElevatedAdmin(): Promise<boolean> {
  if (platform() !== "win32") {
    try {
      return typeof process.getuid === "function" ? process.getuid() === 0 : false;
    } catch {
      return false;
    }
  }
  try {
    const { stdout } = await execAsync(
      `powershell -NoProfile -Command "[bool](([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))"`,
      { windowsHide: true },
    );
    return /True/i.test(stdout.trim());
  } catch {
    return false;
  }
}

export async function adminStatusReport(): Promise<string> {
  const elevated = await isElevatedAdmin();
  return [
    `elevatedAdmin: ${elevated}`,
    `platform: ${platform()}`,
    `pid: ${process.pid}`,
    `user: ${process.env.USERNAME || process.env.USER || "?"}`,
    elevated
      ? "Полные права администратора активны."
      : "НЕТ прав администратора. Запусти: npx hey gateway start --admin  (подтверди UAC).",
  ].join("\n");
}

/**
 * Re-launch current node process elevated (Windows UAC). Returns true if relaunch started (caller should exit).
 */
export async function relaunchElevated(extraArgs: string[] = []): Promise<boolean> {
  if (platform() !== "win32") return false;
  if (await isElevatedAdmin()) return false;

  const node = process.execPath;
  const args = [...process.argv.slice(1), ...extraArgs].filter((a) => a !== "--admin");

  const script = `
$ErrorActionPreference = 'Stop'
$p = Start-Process -FilePath ${JSON.stringify(node)} -ArgumentList @(${args.map((a) => JSON.stringify(a)).join(",")}) -Verb RunAs -PassThru
Write-Output ("STARTED_PID=" + $p.Id)
`;
  const scriptPath = join(tmpdir(), `heyagent-elevate-${Date.now()}.ps1`);
  writeFileSync(scriptPath, script, "utf-8");
  try {
    const { stdout } = await execAsync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`,
      { windowsHide: false },
    );
    return /STARTED_PID=/i.test(stdout);
  } catch (err) {
    throw new Error(
      `Не удалось запросить UAC/админа: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    try {
      unlinkSync(scriptPath);
    } catch {
      /* ignore */
    }
  }
}

/** Run a command elevated via UAC (separate process). */
export async function runElevatedCommand(command: string, timeoutMs = 120_000): Promise<string> {
  if (platform() !== "win32") {
    const { stdout, stderr } = await execAsync(command, {
      timeout: timeoutMs,
      maxBuffer: 4e6,
      shell: "/bin/bash",
    });
    return [stdout, stderr].filter(Boolean).join("\n").slice(0, 20000);
  }

  if (await isElevatedAdmin()) {
    const { stdout, stderr } = await execAsync(command, {
      shell: "powershell.exe",
      timeout: timeoutMs,
      maxBuffer: 4e6,
      windowsHide: true,
    });
    return [stdout, stderr].filter(Boolean).join("\n").slice(0, 20000);
  }

  const outFile = join(tmpdir(), `heyagent-elev-out-${Date.now()}.txt`);
  const ps1 = join(tmpdir(), `heyagent-elev-cmd-${Date.now()}.ps1`);
  const wrapper = `
$ErrorActionPreference = 'Continue'
try {
  ${command}
} catch {
  $_ | Out-String
} | Out-File -FilePath ${JSON.stringify(outFile)} -Encoding utf8
`;
  writeFileSync(ps1, wrapper, "utf-8");
  try {
    await execAsync(
      `powershell -NoProfile -Command "Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${ps1.replace(/'/g, "''")}' -Verb RunAs -Wait"`,
      { timeout: timeoutMs + 30_000, windowsHide: false },
    );
    try {
      return readFileSync(outFile, "utf-8").slice(0, 20000) || "OK (empty output)";
    } catch {
      return "Elevated process finished (no output file — возможно UAC отклонён).";
    }
  } finally {
    try {
      unlinkSync(ps1);
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(outFile);
    } catch {
      /* ignore */
    }
  }
}
