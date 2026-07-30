/**
 * Play a local audio file on PC speakers without opening a media-player UI.
 */
import { spawn, exec } from "node:child_process";
import { promisify } from "node:util";
import { platform } from "node:os";
import { pathToFileURL } from "node:url";
import { which } from "./platform-input.js";

const execAsync = promisify(exec);

export async function playAudioFileSilent(
  filePath: string,
  opts?: { wait?: boolean },
): Promise<string> {
  const wait = opts?.wait !== false;
  const os = platform();

  try {
    if (os === "win32") {
      const uri = pathToFileURL(filePath).href.replace(/'/g, "''");
      const ps = [
        "Add-Type -AssemblyName PresentationCore",
        `$p = New-Object System.Windows.Media.MediaPlayer`,
        `$p.Open([Uri]'${uri}')`,
        "$p.Volume = 1",
        "$p.Play()",
        "$sw = [Diagnostics.Stopwatch]::StartNew()",
        "while ($p.NaturalDuration.HasTimeSpan -eq $false -and $sw.Elapsed.TotalSeconds -lt 8) { Start-Sleep -Milliseconds 50 }",
        "if ($p.NaturalDuration.HasTimeSpan) {",
        "  $dur = $p.NaturalDuration.TimeSpan.TotalMilliseconds",
        "  while ($p.Position.TotalMilliseconds + 80 -lt $dur -and $sw.Elapsed.TotalSeconds -lt 120) { Start-Sleep -Milliseconds 120 }",
        "}",
        "$p.Close()",
      ].join("; ");
      if (wait) {
        await execAsync(ps, {
          shell: "powershell.exe",
          timeout: 130_000,
          windowsHide: true,
        });
      } else {
        spawn("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", ps], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        }).unref();
      }
      return `played:${filePath}`;
    }

    if (os === "darwin") {
      if (wait) {
        await execAsync(`afplay ${JSON.stringify(filePath)}`, { timeout: 130_000 });
      } else {
        spawn("afplay", [filePath], { detached: true, stdio: "ignore" }).unref();
      }
      return `played:${filePath}`;
    }

    if (await which("ffplay")) {
      const args = ["-nodisp", "-autoexit", "-loglevel", "quiet", filePath];
      if (wait) {
        await execAsync(`ffplay ${args.map((a) => JSON.stringify(a)).join(" ")}`, {
          timeout: 130_000,
        });
      } else {
        spawn("ffplay", args, { detached: true, stdio: "ignore" }).unref();
      }
      return `played:${filePath}`;
    }

    if (await which("paplay")) {
      if (wait) await execAsync(`paplay ${JSON.stringify(filePath)}`);
      else spawn("paplay", [filePath], { detached: true, stdio: "ignore" }).unref();
      return `played:${filePath}`;
    }

    return "ERROR: no silent audio player (ffplay/paplay/afplay)";
  } catch (err) {
    return `ERROR play: ${err instanceof Error ? err.message : String(err)}`;
  }
}
