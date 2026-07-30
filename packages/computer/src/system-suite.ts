/**
 * Full Windows PC control suite — one dispatcher for “whatever the user asks”.
 * Prefer system.control(action, …) instead of inventing one-off tools forever.
 */
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { platform, homedir, cpus, totalmem, freemem, hostname } from "node:os";
import { join } from "node:path";
import { runPowerShellQuiet } from "./ps-quiet.js";
import { runElevatedCommand, adminStatusReport } from "./admin.js";
import { emptyRecycleBin } from "./power.js";
import { setWallpaper, openWindowsSettings, updateDrivers } from "./desktop-power.js";
import {
  setVolume,
  getVolume,
  setBrightness,
  getDisplayModes,
  setRefreshRate,
  setMobileHotspot,
} from "./system-controls.js";

const execAsync = promisify(exec);

async function ps(script: string, timeoutMs = 60_000): Promise<string> {
  const res = await runPowerShellQuiet(script, { timeoutMs });
  if (!res.ok) throw new Error(res.out || "PowerShell failed");
  return res.out;
}

export const SYSTEM_CONTROL_ACTIONS = [
  // audio
  "volume_get",
  "volume_set",
  "mute",
  "unmute",
  "media_play_pause",
  "media_next",
  "media_prev",
  // display
  "brightness_get",
  "brightness_set",
  "brightness_delta",
  "display_modes",
  "refresh_rate",
  "resolution",
  "night_light",
  "theme",
  "wallpaper",
  "monitor_off",
  // power / session
  "lock",
  "sleep",
  "hibernate",
  "shutdown",
  "restart",
  "logoff",
  "cancel_shutdown",
  // network
  "wifi_on",
  "wifi_off",
  "wifi_list",
  "wifi_connect",
  "airplane_on",
  "airplane_off",
  "hotspot_on",
  "hotspot_off",
  "bluetooth_on",
  "bluetooth_off",
  "flush_dns",
  // system hygiene
  "recycle_empty",
  "clear_temp",
  "disk_space",
  "battery",
  "system_info",
  // desktop / UI
  "open_settings",
  "open_task_manager",
  "open_control_panel",
  "focus_assist",
  "clipboard_get",
  "clipboard_set",
  "notification",
  // admin / drivers
  "admin_status",
  "update_drivers",
  "elevated_cmd",
  "help",
] as const;

export type SystemControlAction = (typeof SYSTEM_CONTROL_ACTIONS)[number];

export interface SystemControlParams {
  action: SystemControlAction;
  level?: number;
  delta?: number;
  mute?: boolean;
  hz?: number;
  width?: number;
  height?: number;
  enable?: boolean;
  path?: string;
  page?: string;
  ssid?: string;
  password?: string;
  text?: string;
  theme?: "dark" | "light";
  mode?: string;
  command?: string;
  seconds?: number;
}

export type SystemControlValidationResult =
  | { ok: true; value: SystemControlParams }
  | {
      ok: false;
      error: "INVALID_SYSTEM_CONTROL_COMMAND";
      reason: "missing_command" | "missing_action" | "invalid_action";
    };

const SYSTEM_CONTROL_ALIASES: Record<string, SystemControlAction> = {
  controls_help: "help",
  get_volume: "volume_get",
  set_volume: "volume_set",
  get_brightness: "brightness_get",
  set_brightness: "brightness_set",
  get_display_modes: "display_modes",
  set_refresh_rate: "refresh_rate",
  set_resolution: "resolution",
  set_wallpaper: "wallpaper",
  empty_recycle_bin: "recycle_empty",
};

export function validateSystemControlParams(
  input: unknown,
): SystemControlValidationResult {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    return {
      ok: false,
      error: "INVALID_SYSTEM_CONTROL_COMMAND",
      reason: "missing_command",
    };
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw.action !== "string" || !raw.action.trim()) {
    return {
      ok: false,
      error: "INVALID_SYSTEM_CONTROL_COMMAND",
      reason: "missing_action",
    };
  }
  const normalized = raw.action.trim().toLowerCase().replace(/[-\s]+/g, "_");
  const action =
    SYSTEM_CONTROL_ALIASES[normalized] ??
    SYSTEM_CONTROL_ACTIONS.find((candidate) => candidate === normalized);
  if (!action) {
    return {
      ok: false,
      error: "INVALID_SYSTEM_CONTROL_COMMAND",
      reason: "invalid_action",
    };
  }
  return {
    ok: true,
    value: { ...raw, action } as SystemControlParams,
  };
}

function mediaKey(vk: number): Promise<string> {
  return ps(`
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public class K { [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo); }
"@
[K]::keybd_event(${vk}, 0, 0, [UIntPtr]::Zero)
[K]::keybd_event(${vk}, 0, 2, [UIntPtr]::Zero)
'OK media key ${vk}'
`);
}

async function getBrightness(): Promise<number | null> {
  const res = await runPowerShellQuiet(`
$b = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction SilentlyContinue |
  Select-Object -First 1
if ($b) { [string]$b.CurrentBrightness } else { '' }
`);
  if (!res.ok || !res.out.trim()) return null;
  const n = Number(res.out.trim());
  return Number.isFinite(n) ? n : null;
}

async function setTheme(theme: "dark" | "light"): Promise<string> {
  const apps = theme === "dark" ? 0 : 1;
  const sys = theme === "dark" ? 0 : 1;
  await ps(`
New-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize' -Name AppsUseLightTheme -Value ${apps} -PropertyType DWord -Force | Out-Null
New-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize' -Name SystemUsesLightTheme -Value ${sys} -PropertyType DWord -Force | Out-Null
# broadcast setting change
RUNDLL32.EXE USER32.DLL,UpdatePerUserSystemParameters
'OK theme=${theme}'
`);
  return `Тема: ${theme === "dark" ? "тёмная" : "светлая"}`;
}

async function setNightLight(enable: boolean): Promise<string> {
  // Soft path: open settings + registry toggle best-effort
  await ps(`
$path = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CloudStore\\Store\\DefaultAccount\\Current\\default$windows.data.bluelightreduction.bluelightreductionstate\\windows.data.bluelightreduction.bluelightreductionstate'
# Fallback: open page — reliable UX
Start-Process 'ms-settings:nightlight'
'OK opened night light settings enable=${enable}'
`);
  return enable
    ? "Открыл параметры ночного света — включи переключатель (API Windows ограничен)."
    : "Открыл параметры ночного света — выключи переключатель.";
}

async function setAirplane(enable: boolean): Promise<string> {
  // Radio management often needs capability; use netsh + settings fallback
  try {
    if (enable) {
      await runElevatedCommand(`
Get-NetAdapter | Where-Object {$_.Status -eq 'Up' -and $_.HardwareInterface} | Disable-NetAdapter -Confirm:$false -ErrorAction SilentlyContinue
'OK airplane-ish adapters disabled'
`);
    } else {
      await runElevatedCommand(`
Get-NetAdapter | Where-Object {$_.Status -eq 'Disabled' -and $_.HardwareInterface} | Enable-NetAdapter -Confirm:$false -ErrorAction SilentlyContinue
'OK adapters enabled'
`);
    }
  } catch {
    /* ignore */
  }
  await execAsync(`Start-Process ms-settings:network-airplanemode`, {
    shell: "powershell.exe",
    windowsHide: true,
  }).catch(() => undefined);
  return enable
    ? "Режим полёта: открыл параметры (и попытался отключить адаптеры)."
    : "Выход из режима полёта: открыл параметры (и попытался включить адаптеры).";
}

async function setWifi(enable: boolean): Promise<string> {
  const verb = enable ? "on" : "off";
  const res = await runPowerShellQuiet(`netsh interface set interface name="Wi-Fi" admin=${verb}; 'OK wifi ${verb}'`);
  if (res.ok) return `Wi‑Fi ${enable ? "включён" : "выключен"}.`;
  // try alternate interface names
  const res2 = await runPowerShellQuiet(`
$a = Get-NetAdapter | Where-Object { $_.Name -match 'Wi-?Fi|Wireless|WLAN' } | Select-Object -First 1
if (-not $a) { throw 'no wifi adapter' }
if (${enable ? "$true" : "$false"}) { Enable-NetAdapter -Name $a.Name -Confirm:$false } else { Disable-NetAdapter -Name $a.Name -Confirm:$false }
'OK adapter=' + $a.Name
`);
  if (res2.ok) return res2.out;
  await execAsync(`Start-Process ms-settings:network-wifi`, {
    shell: "powershell.exe",
    windowsHide: true,
  }).catch(() => undefined);
  return `Не удалось переключить Wi‑Fi автоматически (${res2.out}). Открыл параметры Wi‑Fi.`;
}

async function setBluetooth(enable: boolean): Promise<string> {
  const res = await runPowerShellQuiet(`
$b = Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $b) { throw 'no bluetooth device' }
if (${enable ? "$true" : "$false"}) {
  Enable-PnpDevice -InstanceId $b.InstanceId -Confirm:$false
} else {
  Disable-PnpDevice -InstanceId $b.InstanceId -Confirm:$false
}
'OK bluetooth ${enable ? "on" : "off"}'
`);
  if (res.ok) return res.out;
  await execAsync(`Start-Process ms-settings:bluetooth`, {
    shell: "powershell.exe",
    windowsHide: true,
  }).catch(() => undefined);
  return `Bluetooth: открыл параметры (авто-переключение: ${res.out}).`;
}

async function clearTemp(): Promise<string> {
  const res = await runPowerShellQuiet(`
$paths = @($env:TEMP, "$env:WINDIR\\Temp", "$env:LOCALAPPDATA\\Temp")
$n = 0
foreach ($p in $paths) {
  if (Test-Path $p) {
    Get-ChildItem -LiteralPath $p -Force -ErrorAction SilentlyContinue | ForEach-Object {
      try { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction Stop; $n++ } catch {}
    }
  }
}
'OK cleared≈' + $n + ' items from temp'
`);
  return res.ok ? res.out : `ERROR: ${res.out}`;
}

async function diskSpace(): Promise<string> {
  return ps(`
Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {
  $free = [math]::Round($_.FreeSpace/1GB,1)
  $size = [math]::Round($_.Size/1GB,1)
  "$($_.DeviceID) free=$free GB / $size GB"
}
`);
}

async function batteryStatus(): Promise<string> {
  return ps(`
$b = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue
if (-not $b) { 'No battery (desktop?)' }
else {
  $b | ForEach-Object { "charge=$($_.EstimatedChargeRemaining)% status=$($_.BatteryStatus) name=$($_.Name)" }
}
`);
}

async function focusAssist(mode: string): Promise<string> {
  // 0 off, 1 priority, 2 alarms only — registry best-effort + settings
  const map: Record<string, number> = {
    off: 0,
    priority: 1,
    alarms: 2,
    on: 2,
  };
  const v = map[mode.toLowerCase()] ?? 1;
  await ps(`
New-Item -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CloudStore' -Force | Out-Null
Start-Process 'ms-settings:quiethours'
'OK focus assist target=${v} (opened settings)'
`);
  return `Фокусировка внимания: открыл параметры (режим ≈ ${mode}).`;
}

async function clipboardGet(): Promise<string> {
  return ps(`
Add-Type -AssemblyName System.Windows.Forms
$t = [System.Windows.Forms.Clipboard]::GetText()
if ([string]::IsNullOrEmpty($t)) { '(clipboard empty)' } else { $t.Substring(0, [Math]::Min(4000, $t.Length)) }
`);
}

async function clipboardSet(text: string): Promise<string> {
  const b64 = Buffer.from(text, "utf8").toString("base64");
  await ps(`
Add-Type -AssemblyName System.Windows.Forms
$bytes = [Convert]::FromBase64String('${b64}')
$text = [Text.Encoding]::UTF8.GetString($bytes)
[System.Windows.Forms.Clipboard]::SetText($text)
'OK clipboard set chars=' + $text.Length
`);
  return "Текст скопирован в буфер обмена.";
}

async function sendNotification(text: string): Promise<string> {
  const safe = text.replace(/'/g, "''").slice(0, 200);
  await ps(`
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
# fallback balloon via NotifyIcon if toast APIs awkward in PS
Add-Type -AssemblyName System.Windows.Forms
$n = New-Object System.Windows.Forms.NotifyIcon
$n.Icon = [System.Drawing.SystemIcons]::Information
$n.Visible = $true
$n.ShowBalloonTip(3000, 'HeyAgent', '${safe}', [System.Windows.Forms.ToolTipIcon]::Info)
Start-Sleep -Milliseconds 500
$n.Dispose()
'OK notification'
`);
  return "Уведомление показано.";
}

/**
 * Universal PC control entrypoint.
 */
export async function systemControl(params: SystemControlParams): Promise<string> {
  if (platform() !== "win32") {
    const { systemControlXplat } = await import("./system-xplat.js");
    // Map a few Windows-only action aliases to portable ones
    const action = String(params.action || "")
      .trim()
      .toLowerCase()
      .replace(/[-\s]+/g, "_");
    const mapped =
      action === "recycle_empty"
        ? "empty_trash"
        : action === "bluetooth_on"
          ? "bt_on"
          : action === "bluetooth_off"
            ? "bt_off"
            : action === "controls_help"
              ? "help"
              : action;
    return systemControlXplat({
      action: mapped,
      level: params.level,
      delta: params.delta,
      text: params.text,
      page: params.page,
    });
  }

  const action = String(params.action || "")
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, "_");

  try {
    switch (action) {
      case "help":
      case "controls_help":
        return systemControlHelp();

      case "volume_get":
      case "get_volume":
        return getVolume();
      case "volume_set":
      case "set_volume":
        return setVolume(Number(params.level ?? 50), params.mute);
      case "mute":
        return setVolume(Number(params.level ?? 0), true);
      case "unmute":
        return setVolume(Number(params.level ?? 40), false);
      case "media_play_pause":
        return mediaKey(0xb3);
      case "media_next":
        return mediaKey(0xb0);
      case "media_prev":
        return mediaKey(0xb1);

      case "brightness_get": {
        const b = await getBrightness();
        return b == null ? "Яркость недоступна через WMI (часто внешний монитор)." : `brightness=${b}`;
      }
      case "brightness_set":
      case "set_brightness":
        return setBrightness(Number(params.level ?? 50));
      case "brightness_delta": {
        const cur = (await getBrightness()) ?? 50;
        const next = Math.max(0, Math.min(100, cur + Number(params.delta ?? 0)));
        return setBrightness(next);
      }
      case "display_modes":
      case "get_display_modes":
        return getDisplayModes();
      case "refresh_rate":
      case "set_refresh_rate":
        return setRefreshRate(
          Number(params.hz ?? 60),
          params.width != null ? Number(params.width) : undefined,
          params.height != null ? Number(params.height) : undefined,
        );
      case "resolution":
      case "set_resolution": {
        const modes = await getDisplayModes();
        const w = Number(params.width);
        const h = Number(params.height);
        const hz = Number(params.hz ?? 60);
        if (!w || !h) return `ERROR: нужны width и height.\n${modes}`;
        return setRefreshRate(hz, w, h);
      }
      case "night_light":
        return setNightLight(params.enable !== false);
      case "theme":
        return setTheme(params.theme === "light" ? "light" : "dark");
      case "wallpaper":
      case "set_wallpaper":
        if (!params.path) return "ERROR: нужен path к картинке";
        return setWallpaper(params.path);
      case "monitor_off":
        await ps(`
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public class M { [DllImport("user32.dll")] public static extern int SendMessage(int hWnd, int hMsg, int wParam, int lParam); }
"@
[M]::SendMessage(0xffff, 0x112, 0xf170, 2) | Out-Null
'OK monitor off'
`);
        return "Монитор выключен (разбуди мышью/клавишей).";

      case "lock":
        await ps(`rundll32.exe user32.dll,LockWorkStation; 'OK locked'`);
        return "Экран заблокирован.";
      case "sleep":
        await ps(`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::SetSuspendState([System.Windows.Forms.PowerState]::Suspend, $false, $false) | Out-Null
'OK sleep'
`);
        return "Сон.";
      case "hibernate":
        await runElevatedCommand(`shutdown /h`);
        return "Гибернация.";
      case "shutdown": {
        const sec = Math.max(0, Number(params.seconds ?? 5));
        await ps(`shutdown /s /t ${sec}; 'OK shutdown in ${sec}s'`);
        return `Выключение через ${sec} с. Отмена: system.control action=cancel_shutdown`;
      }
      case "restart": {
        const sec = Math.max(0, Number(params.seconds ?? 5));
        await ps(`shutdown /r /t ${sec}; 'OK restart in ${sec}s'`);
        return `Перезагрузка через ${sec} с. Отмена: cancel_shutdown`;
      }
      case "logoff":
        await ps(`shutdown /l; 'OK logoff'`);
        return "Выход из учётной записи.";
      case "cancel_shutdown":
        await ps(`shutdown /a; 'OK cancelled'`);
        return "Выключение/перезагрузка отменены.";

      case "wifi_on":
        return setWifi(true);
      case "wifi_off":
        return setWifi(false);
      case "wifi_list":
        return ps(`netsh wlan show networks mode=bssid | Select-Object -First 80`);
      case "wifi_connect":
        if (!params.ssid) return "ERROR: нужен ssid";
        return ps(`netsh wlan connect name="${String(params.ssid).replace(/"/g, "")}"; 'OK connect requested'`);
      case "airplane_on":
        return setAirplane(true);
      case "airplane_off":
        return setAirplane(false);
      case "hotspot_on":
        return setMobileHotspot(true, params.ssid, params.password);
      case "hotspot_off":
        return setMobileHotspot(false);
      case "bluetooth_on":
        return setBluetooth(true);
      case "bluetooth_off":
        return setBluetooth(false);
      case "flush_dns":
        return (await runElevatedCommand(`ipconfig /flushdns`)) || "OK flushdns";

      case "recycle_empty":
      case "empty_recycle_bin":
        return emptyRecycleBin();
      case "clear_temp":
        return clearTemp();
      case "disk_space":
        return diskSpace();
      case "battery":
        return batteryStatus();
      case "system_info":
        return [
          `host=${hostname()}`,
          `user=${process.env.USERNAME}`,
          `cpus=${cpus().length}`,
          `ram_free_gb=${Math.round(freemem() / 1e9)}/${Math.round(totalmem() / 1e9)}`,
          `home=${homedir()}`,
          `desktop=${join(homedir(), "Desktop")}`,
          await adminStatusReport(),
        ].join("\n");

      case "open_settings":
        return openWindowsSettings(params.page || "");
      case "open_task_manager":
        await execAsync(`Start-Process taskmgr`, { shell: "powershell.exe", windowsHide: true });
        return "Диспетчер задач открыт.";
      case "open_control_panel":
        await execAsync(`Start-Process control`, { shell: "powershell.exe", windowsHide: true });
        return "Панель управления открыта.";
      case "focus_assist":
        return focusAssist(params.mode || "priority");
      case "clipboard_get":
        return clipboardGet();
      case "clipboard_set":
        if (params.text == null) return "ERROR: нужен text";
        return clipboardSet(String(params.text));
      case "notification":
        return sendNotification(String(params.text || "HeyAgent"));

      case "admin_status":
        return adminStatusReport();
      case "update_drivers":
        return updateDrivers();
      case "elevated_cmd":
        if (!params.command) return "ERROR: нужен command";
        return runElevatedCommand(String(params.command));

      default:
        return [
          `ERROR: неизвестное действие «${action}».`,
          systemControlHelp(),
        ].join("\n");
    }
  } catch (err) {
    return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export function systemControlHelp(): string {
  return [
    "system.control — полный контроль ПК. action=",
    "AUDIO: volume_get|volume_set|mute|unmute|media_play_pause|media_next|media_prev",
    "DISPLAY: brightness_get|brightness_set|brightness_delta|display_modes|refresh_rate|resolution|night_light|theme|wallpaper|monitor_off",
    "POWER: lock|sleep|hibernate|shutdown|restart|logoff|cancel_shutdown",
    "NET: wifi_on|wifi_off|wifi_list|wifi_connect|airplane_on|airplane_off|hotspot_on|hotspot_off|bluetooth_on|bluetooth_off|flush_dns",
    "SYS: recycle_empty|clear_temp|disk_space|battery|system_info|admin_status|update_drivers|elevated_cmd",
    "UI: open_settings|open_task_manager|open_control_panel|focus_assist|clipboard_get|clipboard_set|notification",
    "Параметры: level, delta, hz, width, height, enable, path, page, ssid, password, text, theme, mode, command, seconds",
  ].join("\n");
}

/** Map free-form Russian/English user text → system.control call when obvious. */
export function detectSystemControlIntent(
  text: string,
): SystemControlParams | null {
  const t = text.toLowerCase().replace(/ё/g, "е").trim();

  // brightness relative
  const brDown = t.match(/(понизь|уменьши|сделай\s+тише|снизь).{0,20}ярк.{0,20}?(\d{1,3})/);
  if (brDown || /(понизь|уменьши).{0,15}ярк/.test(t)) {
    const n = Number(brDown?.[2] ?? 10);
    return { action: "brightness_delta", delta: -Math.abs(n || 10) };
  }
  const brUp = t.match(/(увелич|повысь|прибав).{0,20}ярк.{0,20}?(\d{1,3})/);
  if (brUp || /(увелич|повысь).{0,15}ярк/.test(t)) {
    const n = Number(brUp?.[2] ?? 10);
    return { action: "brightness_delta", delta: Math.abs(n || 10) };
  }
  const brSet = t.match(/ярк\w*.{0,12}(\d{1,3})\s*%?/);
  if (/(поставь|установи|сделай).{0,15}ярк/.test(t) && brSet) {
    return { action: "brightness_set", level: Number(brSet[1]) };
  }

  if (/громк|звук|volume|mute|беззвуч/.test(t)) {
    if (/выключ|мут|mute|беззвуч/.test(t)) return { action: "mute" };
    if (/включи.{0,10}звук|unmute|сними\s*мут/.test(t)) return { action: "unmute" };
    const m = t.match(/(\d{1,3})\s*%?/);
    if (/(поставь|установи|сделай|громкость).{0,20}\d/.test(t) && m) {
      return { action: "volume_set", level: Number(m[1]) };
    }
    if (/увелич|повысь|прибав|громче/.test(t)) return { action: "volume_set", level: 70 };
    if (/уменьш|понизь|тише/.test(t)) return { action: "volume_set", level: 20 };
    if (/какая|сколько|текущ/.test(t)) return { action: "volume_get" };
  }

  if (/очист.{0,15}корзин|empty.{0,10}recycle|опустош.{0,10}корзин/.test(t)) {
    return { action: "recycle_empty" };
  }
  if (/заблокир|lock\s*(screen|pc|computer)|блокировк\w*\s*экран/.test(t)) return { action: "lock" };
  if (/\bсон\b|sleep|спящ/.test(t) && /(перевед|увед|сделай|компьютер|пк|ноут)/.test(t)) {
    return { action: "sleep" };
  }
  if (/гиберн/.test(t)) return { action: "hibernate" };
  if (/выключ(и|ение).{0,15}(комп|пк|ноут|компьютер)|shutdown/.test(t)) {
    return { action: "shutdown", seconds: 10 };
  }
  if (/перезагруз|restart|reboot/.test(t) && /(комп|пк|ноут|windows|систем)/.test(t)) {
    return { action: "restart", seconds: 10 };
  }
  if (/отмен.{0,15}(выключ|перезагруз|shutdown)/.test(t)) return { action: "cancel_shutdown" };

  if (/хотспот|точка\s*доступ|mobile\s*hotspot/.test(t)) {
    return { action: /выключ|отключ|stop|off/.test(t) ? "hotspot_off" : "hotspot_on" };
  }
  if (/wi-?fi|вайч?фай|вай-фай/.test(t)) {
    if (/список|сет(и|ь)|scan|покажи/.test(t)) return { action: "wifi_list" };
    if (/выключ|отключ|off/.test(t)) return { action: "wifi_off" };
    if (/включ|on/.test(t)) return { action: "wifi_on" };
  }
  if (/bluetooth|блютус|синезуб/.test(t)) {
    return { action: /выключ|отключ|off/.test(t) ? "bluetooth_off" : "bluetooth_on" };
  }
  if (/режим\s*пол[её]т|airplane/.test(t)) {
    return { action: /выключ|отключ|off/.test(t) ? "airplane_off" : "airplane_on" };
  }

  if (/герц|гц|\bhz\b|частот\w*\s*обнов|refresh\s*rate/.test(t)) {
    const hz = Number(t.match(/(\d{2,3})\s*(гц|hz)?/i)?.[1] ?? 60);
    return { action: "refresh_rate", hz };
  }
  if (/разрешен(ие|ия)\s*экран|resolution|поставь\s*\d{3,4}\s*[xх×]\s*\d{3,4}/.test(t)) {
    const m = t.match(/(\d{3,4})\s*[xх×]\s*(\d{3,4})/);
    if (m) return { action: "resolution", width: Number(m[1]), height: Number(m[2]), hz: 60 };
  }

  if (/темн(ая|ую)\s*тем|dark\s*mode|т[её]мн(ый|ую)\s*режим/.test(t)) return { action: "theme", theme: "dark" };
  if (/светл(ая|ую)\s*тем|light\s*mode/.test(t)) return { action: "theme", theme: "light" };
  if (/ночн\w*\s*свет|night\s*light|синий\s*фильтр/.test(t)) {
    return { action: "night_light", enable: !/выключ|отключ/.test(t) };
  }
  if (/обо(и|ев)|wallpaper/.test(t) && /(поставь|смен|установ)/.test(t)) {
    // need path — let LLM tool call with path; only detect if path-like present
    const p = text.match(/[A-Za-z]:\\[^\s"']+|\.png|\.jpg|\.jpeg|\.bmp/i);
    if (p && /\\/.test(text)) {
      const pathMatch = text.match(/([A-Za-z]:\\[^\r\n"']+\.(?:png|jpe?g|bmp|webp))/i);
      if (pathMatch) return { action: "wallpaper", path: pathMatch[1] };
    }
    return null; // let LLM ask / find file
  }

  if (/выключ(и)?\s*монитор|monitor\s*off|потуш(и)?\s*экран/.test(t)) return { action: "monitor_off" };
  if (/очист.{0,15}temp|очист.{0,15}временн|clear\s*temp/.test(t)) return { action: "clear_temp" };
  if (/место\s*на\s*диске|disk\s*space|сколько\s*места/.test(t)) return { action: "disk_space" };
  if (/заряд|батаре|battery/.test(t)) return { action: "battery" };
  if (/flush\s*dns|сброс\s*dns|очист\w*\s*dns/.test(t)) return { action: "flush_dns" };
  if (/диспетчер\s*задач|task\s*manager/.test(t)) return { action: "open_task_manager" };
  if (/панел\w*\s*управлен|control\s*panel/.test(t)) return { action: "open_control_panel" };
  if (/обнов(и|ление).{0,15}драйвер|update\s*driver/.test(t)) return { action: "update_drivers" };
  if (/пауз[аы]|play\s*pause|play\/pause|следующ\w*\s*трек|предыдущ\w*\s*трек/.test(t)) {
    if (/следующ|next/.test(t)) return { action: "media_next" };
    if (/предыдущ|prev|прошл/.test(t)) return { action: "media_prev" };
    return { action: "media_play_pause" };
  }

  return null;
}
