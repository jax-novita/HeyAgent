/**
 * Screen vision + UI Automation — so the agent can SEE and click like a human.
 */
import { readFile, readdir, mkdir, writeFile, unlink } from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { platform, homedir, tmpdir } from "node:os";
import { join } from "node:path";

const execAsync = promisify(exec);

export interface ScreenShot {
  path: string;
  visionPath: string;
  width: number;
  height: number;
  base64: string;
  mimeType: "image/png" | "image/jpeg";
}

export const VISION_MARKER = "HEYAGENT_VISION:";

function screenshotsDir(): string {
  return join(homedir(), ".heyagent", "screenshots");
}

async function runPsFile(script: string): Promise<string> {
  const file = join(tmpdir(), `heyagent-ps-${Date.now()}.ps1`);
  await writeFile(file, script, "utf-8");
  try {
    const { stdout } = await execAsync(
      `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${file}"`,
      { maxBuffer: 8e6, timeout: 60000 },
    );
    return stdout.trim();
  } finally {
    await unlink(file).catch(() => undefined);
  }
}

/** Capture primary screen, optionally downscale for vision models. */
export async function captureScreenVision(maxWidth = 1280): Promise<ScreenShot> {
  const os = platform();
  void maxWidth;
  await mkdir(screenshotsDir(), { recursive: true });
  const path = join(screenshotsDir(), `shot-${Date.now()}.png`);
  const visionPath = join(screenshotsDir(), `vision-${Date.now()}.jpg`);

  if (os === "win32") {
    const dimensions = await runPsFile([
      "Add-Type -AssemblyName System.Windows.Forms,System.Drawing",
      "$b = [System.Windows.Forms.SystemInformation]::VirtualScreen",
      "$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height",
      "$g = [System.Drawing.Graphics]::FromImage($bmp)",
      "$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)",
      `$bmp.Save('${visionPath.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Jpeg)`,
      "$g.Dispose(); $bmp.Dispose()",
      '[pscustomobject]@{ width = $b.Width; height = $b.Height } | ConvertTo-Json -Compress',
    ].join("\n"));
    const size = JSON.parse(dimensions) as { width?: number; height?: number };
    const buf = await readFile(visionPath);
    return {
      path: visionPath,
      visionPath,
      width: size.width ?? 0,
      height: size.height ?? 0,
      base64: buf.toString("base64"),
      mimeType: "image/jpeg",
    };
  }

  if (os === "darwin") {
    await execAsync(`screencapture -x "${path}"`);
  } else {
    await execAsync(`import -window root "${path}"`).catch(() =>
      execAsync(`gnome-screenshot -f "${path}"`),
    );
  }
  const buf = await readFile(path);
  return {
    path,
    visionPath: path,
    width: 0,
    height: 0,
    base64: buf.toString("base64"),
    mimeType: "image/png",
  };
}

export async function screenBounds(): Promise<string> {
  if (platform() === "win32") {
    const result = await runPsFile([
      "Add-Type -AssemblyName System.Windows.Forms",
      "[System.Windows.Forms.Screen]::AllScreens | ForEach-Object {",
      '  "$($_.DeviceName): x=$($_.Bounds.X) y=$($_.Bounds.Y) width=$($_.Bounds.Width) height=$($_.Bounds.Height)"',
      "}",
    ].join("\n")).catch(() => "");
    if (result) return result;
  }
  return "Screen bounds unavailable; screen.see still returns a usable image.";
}

/** OCR: prefer vision; light WinRT attempt, else hint. */
export async function screenOcr(): Promise<string> {
  const shot = await captureScreenVision(1600);
  if (platform() !== "win32") {
    return [
      `Screenshot ready: ${shot.path}`,
      "OCR non-Windows: use the attached vision via screen.see instead.",
    ].join("\n");
  }
  return [
    `Screen size: ${shot.width}x${shot.height}`,
    `Full screenshot: ${shot.path}`,
    `Vision image: ${shot.visionPath}`,
    "OCR tip: call screen.see — the vision model reads text from the image better than local OCR.",
    formatVisionToolResult(shot, "OCR fallback → vision image available."),
  ].join("\n");
}

/** UI Automation tree for the focused window. */
export async function uiTree(maxElements = 80): Promise<string> {
  if (platform() !== "win32") {
    return "ui.tree is Windows UI Automation. Use screen.see + computer.click on other OS.";
  }
  const script = [
    "Add-Type -AssemblyName UIAutomationClient",
    "Add-Type -AssemblyName UIAutomationTypes",
    "$root = [System.Windows.Automation.AutomationElement]::FocusedElement",
    "if (-not $root) { $root = [System.Windows.Automation.AutomationElement]::RootElement }",
    "$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker",
    "$out = New-Object System.Collections.Generic.List[string]",
    "$win = $root",
    "while ($win) {",
    "  $ct = $win.Current.ControlType",
    "  if ($ct -eq [System.Windows.Automation.ControlType]::Window) { break }",
    "  $p = $walker.GetParent($win)",
    "  if (-not $p) { break }",
    "  $win = $p",
    "}",
    "if (-not $win) { $win = [System.Windows.Automation.AutomationElement]::RootElement }",
    '$out.Add("WINDOW: $($win.Current.Name)")',
    "$stack = New-Object System.Collections.Stack",
    "$stack.Push($win)",
    "$count = 0",
    `$max = ${maxElements}`,
    "while ($stack.Count -gt 0 -and $count -lt $max) {",
    "  $el = $stack.Pop()",
    "  try {",
    "    $c = $el.Current",
    "    $r = $c.BoundingRectangle",
    "    $name = (($c.Name) -replace '[\\r\\n]+',' ').Trim()",
    "    if ($name.Length -gt 80) { $name = $name.Substring(0,80) }",
    "    $interesting = $name -or ($c.ControlType -eq [System.Windows.Automation.ControlType]::Button) -or ($c.ControlType -eq [System.Windows.Automation.ControlType]::Edit) -or ($c.ControlType -eq [System.Windows.Automation.ControlType]::MenuItem) -or ($c.ControlType -eq [System.Windows.Automation.ControlType]::Hyperlink)",
    "    if ($interesting -and $r.Width -gt 0 -and $r.Height -gt 0) {",
    "      $cx = [int]($r.X + $r.Width/2)",
    "      $cy = [int]($r.Y + $r.Height/2)",
    "      $type = $c.ControlType.ProgrammaticName",
    '      $out.Add("$type | `"$name`" | click=($cx,$cy) | bounds=($([int]$r.X),$([int]$r.Y),$([int]$r.Width),$([int]$r.Height))")',
    "      $count++",
    "    }",
    "    $child = $walker.GetFirstChild($el)",
    "    while ($child) {",
    "      $stack.Push($child)",
    "      $child = $walker.GetNextSibling($child)",
    "    }",
    "  } catch {}",
    "}",
    "$out -join [Environment]::NewLine",
  ].join("\n");

  try {
    const stdout = await runPsFile(script);
    return stdout || "No UI elements found.";
  } catch (err) {
    return `ui.tree failed: ${err instanceof Error ? err.message : String(err)}. Use screen.see.`;
  }
}

export async function uiFind(nameQuery: string): Promise<string> {
  const tree = await uiTree(120);
  const q = nameQuery.toLowerCase();
  const hits = tree
    .split("\n")
    .filter((l) => l.toLowerCase().includes(q))
    .slice(0, 15);
  if (!hits.length) return `No UI element matching "${nameQuery}". Try screen.see.`;
  return hits.join("\n");
}

/**
 * UI grounding: find an element by NAME via UI Automation and click its center.
 * Reliable alternative to guessing pixel percentages. Retries via screen.see are
 * the caller's job if this returns a "no element" note.
 */
export async function uiClickByName(nameQuery: string): Promise<string> {
  if (platform() !== "win32") {
    return `ui.click_by_name is Windows-only. Use screen.see + computer.click for "${nameQuery}".`;
  }
  const hits = await uiFind(nameQuery);
  const m = hits.match(/click=\((-?\d+),\s*(-?\d+)\)/);
  if (!m) return `ui.click_by_name: no clickable element for "${nameQuery}".\n${hits}`;
  const x = Number(m[1]);
  const y = Number(m[2]);
  await runPsFile(
    [
      "Add-Type -AssemblyName System.Windows.Forms",
      `[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})`,
      "Add-Type @\"",
      "using System;",
      "using System.Runtime.InteropServices;",
      "public class UiClk { [DllImport(\"user32.dll\")] public static extern void mouse_event(int f, int x, int y, int d, int e); }",
      "\"@",
      "[UiClk]::mouse_event(0x0002, 0, 0, 0, 0); [UiClk]::mouse_event(0x0004, 0, 0, 0, 0)",
    ].join("\n"),
  );
  return `Clicked "${nameQuery}" at (${x},${y})`;
}

export async function mouseMove(x: number, y: number): Promise<string> {
  const { xplatMouseMove } = await import("./platform-input.js");
  await xplatMouseMove(x, y);
  return `Moved mouse to (${x},${y})`;
}

export async function mouseScroll(delta: number): Promise<string> {
  const { xplatMouseScroll } = await import("./platform-input.js");
  await xplatMouseScroll(delta);
  return `Scrolled ${delta}`;
}

export async function mouseDrag(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): Promise<string> {
  const { xplatMouseDrag } = await import("./platform-input.js");
  await xplatMouseDrag(x1, y1, x2, y2);
  return `Dragged (${x1},${y1})→(${x2},${y2})`;
}

export async function mouseDoubleClick(x: number, y: number): Promise<string> {
  const { xplatMouseDoubleClick } = await import("./platform-input.js");
  await xplatMouseDoubleClick(x, y);
  return `Double-clicked (${x},${y})`;
}

export function formatVisionToolResult(shot: ScreenShot, note?: string): string {
  return [
    note ?? "Screenshot captured for vision.",
    `Full resolution file: ${shot.path}`,
    `Vision image: ${shot.visionPath}`,
    `Screen: ${shot.width}x${shot.height}`,
    `Coordinate tip: click coords use FULL screen pixels (0,0 top-left → ${shot.width},${shot.height}).`,
    `${VISION_MARKER}${shot.visionPath}`,
    `VISION_PATH=${shot.visionPath}`,
    `VISION_MIME=${shot.mimeType}`,
  ].join("\n");
}

export async function findLatestVisionJpeg(fullPngPath: string): Promise<string> {
  const dir = screenshotsDir();
  try {
    const files = (await readdir(dir))
      .filter((f) => f.startsWith("vision-") && (f.endsWith(".jpg") || f.endsWith(".jpeg")))
      .sort()
      .reverse();
    if (files[0]) return join(dir, files[0]);
  } catch {
    /* fall through */
  }
  return fullPngPath;
}
