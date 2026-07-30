/**
 * Desktop / OS power tools: wallpaper, settings, drivers, simple image edits.
 */
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { platform } from "node:os";
import { join, resolve, extname, basename, dirname } from "node:path";
import { existsSync, copyFileSync } from "node:fs";
import { runElevatedCommand } from "./admin.js";

const execAsync = promisify(exec);

export async function setWallpaper(imagePath: string): Promise<string> {
  const p = resolve(imagePath);
  if (!existsSync(p)) return `ERROR: файл не найден: ${p}`;
  if (platform() !== "win32") {
    if (platform() === "darwin") {
      await execAsync(
        `osascript -e 'tell application "System Events" to tell every desktop to set picture to ${JSON.stringify(p)}'`,
      );
      return `Wallpaper set: ${p}`;
    }
    await execAsync(
      `gsettings set org.gnome.desktop.background picture-uri "file://${p}" 2>/dev/null || true`,
    );
    return `Wallpaper set (best-effort): ${p}`;
  }

  const ps = `
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public class Wallpaper {
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);
}
"@
$ok = [Wallpaper]::SystemParametersInfo(20, 0, ${JSON.stringify(p)}, 3)
if (-not $ok) { throw "SystemParametersInfo failed" }
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name Wallpaper -Value ${JSON.stringify(p)}
'OK wallpaper=' + ${JSON.stringify(p)}
`;
  const { stdout, stderr } = await execAsync(ps, {
    shell: "powershell.exe",
    timeout: 30_000,
    windowsHide: true,
  });
  return (stdout || stderr || `Wallpaper set: ${p}`).trim();
}

export async function openWindowsSettings(page = ""): Promise<string> {
  const map: Record<string, string> = {
    "": "ms-settings:",
    system: "ms-settings:about",
    display: "ms-settings:display",
    personalization: "ms-settings:personalization",
    wallpaper: "ms-settings:personalization-background",
    sound: "ms-settings:sound",
    network: "ms-settings:network",
    wifi: "ms-settings:network-wifi",
    bluetooth: "ms-settings:bluetooth",
    apps: "ms-settings:appsfeatures",
    update: "ms-settings:windowsupdate",
    privacy: "ms-settings:privacy",
    accounts: "ms-settings:yourinfo",
    time: "ms-settings:dateandtime",
    language: "ms-settings:regionlanguage",
    power: "ms-settings:powersleep",
  };
  const key = page.trim().toLowerCase();
  const uri = map[key] ?? (key.startsWith("ms-settings:") ? key : `ms-settings:${key}`);
  if (platform() === "win32") {
    await execAsync(`Start-Process ${JSON.stringify(uri)}`, { shell: "powershell.exe" });
    return `Opened settings: ${uri}`;
  }
  return "ERROR: Windows settings URI only on Windows";
}

export async function updateDrivers(): Promise<string> {
  if (platform() !== "win32") return "ERROR: driver update automation is Windows-only here";
  const logs: string[] = [];

  // 1) Open Windows Update (user-visible) + trigger scan via UsoClient if present
  try {
    await execAsync(`Start-Process "ms-settings:windowsupdate"`, {
      shell: "powershell.exe",
      windowsHide: true,
    });
    logs.push("Opened Windows Update settings");
  } catch (e) {
    logs.push(`settings: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const out = await runElevatedCommand(
      `
try { UsoClient StartInteractiveScan 2>$null; 'UsoClient OK' } catch { $_.Exception.Message }
try { Get-WindowsUpdate -ErrorAction SilentlyContinue | Select-Object -First 5 | Out-String } catch {}
try {
  pnputil /enum-devices /problem 2>$null | Select-Object -First 40
} catch {}
'DONE driver-update kickoff'
`,
      180_000,
    );
    logs.push(out);
  } catch (e) {
    logs.push(`elevated: ${e instanceof Error ? e.message : String(e)}`);
  }

  return [
    "Запущено обновление драйверов/Windows Update (best-effort).",
    "Проверь окно Параметры → Центр обновления Windows.",
    ...logs,
  ].join("\n");
}

/**
 * Simple image edit via System.Drawing: rotate / resize / save-as.
 * ops: rotate90|rotate180|rotate270|resize:WIDTHxHEIGHT|grayscale|copy
 */
export async function editImage(
  inputPath: string,
  opts: { op?: string; outputPath?: string } = {},
): Promise<string> {
  const src = resolve(inputPath);
  if (!existsSync(src)) return `ERROR: нет файла ${src}`;
  const op = (opts.op || "copy").toLowerCase();
  const out =
    opts.outputPath?.trim() ||
    join(dirname(src), `${basename(src, extname(src))}_edited${extname(src) || ".png"}`);

  if (platform() !== "win32") {
    copyFileSync(src, out);
    return `Copied (no System.Drawing): ${out}`;
  }

  const resize = op.match(/^resize:(\d+)x(\d+)$/i);
  const ps = `
Add-Type -AssemblyName System.Drawing
$src = ${JSON.stringify(src)}
$dst = ${JSON.stringify(out)}
$img = [System.Drawing.Image]::FromFile($src)
try {
  $op = ${JSON.stringify(op)}
  if ($op -eq 'rotate90') { $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipNone) }
  elseif ($op -eq 'rotate180') { $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate180FlipNone) }
  elseif ($op -eq 'rotate270') { $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate270FlipNone) }
  elseif ($op -match '^resize:(\\d+)x(\\d+)$') {
    $w = [int]$Matches[1]; $h = [int]$Matches[2]
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.DrawImage($img, 0, 0, $w, $h)
    $g.Dispose(); $img.Dispose(); $img = $bmp
  }
  elseif ($op -eq 'grayscale') {
    $w=$img.Width; $h=$img.Height
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    for ($y=0; $y -lt $h; $y++) {
      for ($x=0; $x -lt $w; $x++) {
        $c = $img.GetPixel($x,$y)
        $gray = [int](0.3*$c.R + 0.59*$c.G + 0.11*$c.B)
        $bmp.SetPixel($x,$y, [System.Drawing.Color]::FromArgb($c.A,$gray,$gray,$gray))
      }
    }
    $img.Dispose(); $img = $bmp
  }
  $fmt = [System.Drawing.Imaging.ImageFormat]::Png
  if ($dst -match '\\.jpe?g$') { $fmt = [System.Drawing.Imaging.ImageFormat]::Jpeg }
  elseif ($dst -match '\\.bmp$') { $fmt = [System.Drawing.Imaging.ImageFormat]::Bmp }
  $img.Save($dst, $fmt)
  'OK saved=' + $dst + ' size=' + $img.Width + 'x' + $img.Height
} finally { if ($img) { $img.Dispose() } }
`;
  void resize;
  const { stdout, stderr } = await execAsync(ps, {
    shell: "powershell.exe",
    timeout: 120_000,
    maxBuffer: 4e6,
    windowsHide: true,
  });
  return (stdout || stderr || `Saved ${out}`).trim();
}
