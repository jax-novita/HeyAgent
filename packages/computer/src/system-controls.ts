/**
 * Direct Windows controls: volume, brightness, refresh rate, mobile hotspot.
 */
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { platform } from "node:os";
import { runElevatedCommand } from "./admin.js";
import { runPowerShellQuiet } from "./ps-quiet.js";

const execAsync = promisify(exec);

function winOnly(): string | null {
  return platform() === "win32" ? null : "ERROR: только Windows";
}

async function runPs(script: string, timeoutMs = 60_000): Promise<string> {
  const res = await runPowerShellQuiet(script, { timeoutMs });
  if (res.ok) return res.out;
  throw new Error(res.out || "PowerShell failed");
}

/** 0–100 master volume (+ optional mute). */
export async function setVolume(level: number, mute?: boolean): Promise<string> {
  const blocked = winOnly();
  if (blocked) return blocked;
  const pct = Math.max(0, Math.min(100, Math.round(level)));
  const doMute = mute === true ? "$true" : mute === false ? "$false" : "$null";
  const out = await runPs(`
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int RegisterControlChangeNotify(IntPtr p); int UnregisterControlChangeNotify(IntPtr p);
  int GetChannelCount(out uint pn); int SetMasterVolumeLevel(float f, Guid p);
  int SetMasterVolumeLevelScalar(float f, Guid p); int GetMasterVolumeLevel(out float pf);
  int GetMasterVolumeLevelScalar(out float pf); int SetChannelVolumeLevel(uint n, float f, Guid p);
  int SetChannelVolumeLevelScalar(uint n, float f, Guid p); int GetChannelVolumeLevel(uint n, out float pf);
  int GetChannelVolumeLevelScalar(uint n, out float pf); int SetMute([MarshalAs(UnmanagedType.Bool)] bool b, Guid p);
  int GetMute(out bool pb); int GetVolumeStepInfo(out uint pn, out uint p); int VolumeStepUp(Guid p); int VolumeStepDown(Guid p);
  int QueryHardwareSupport(out uint pd); int GetVolumeRange(out float pmin, out float pmax, out float pinc);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid id, uint cls, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object pp); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int EnumAudioEndpoints(int d, int s, out IntPtr p); int GetDefaultAudioEndpoint(int d, int r, out IMMDevice pp); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }
public class Vol {
  public static string Set(float scalar, bool? mute) {
    var en = (IMMDeviceEnumerator)(object)new MMDeviceEnumerator();
    IMMDevice dev; en.GetDefaultAudioEndpoint(0, 1, out dev);
    Guid iid = typeof(IAudioEndpointVolume).GUID;
    object epObj; dev.Activate(ref iid, 1, IntPtr.Zero, out epObj);
    var ep = (IAudioEndpointVolume)epObj;
    ep.SetMasterVolumeLevelScalar(scalar, Guid.Empty);
    if (mute.HasValue) ep.SetMute(mute.Value, Guid.Empty);
    float cur; bool m; ep.GetMasterVolumeLevelScalar(out cur); ep.GetMute(out m);
    return "OK volume=" + ((int)Math.Round(cur*100)) + " mute=" + m;
  }
}
"@
$mute = ${doMute}
[Vol]::Set(([float]${pct} / 100.0), $mute)
`);
  return out || `OK volume≈${pct}`;
}

export async function getVolume(): Promise<string> {
  const blocked = winOnly();
  if (blocked) return blocked;
  return runPs(`
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int RegisterControlChangeNotify(IntPtr p); int UnregisterControlChangeNotify(IntPtr p);
  int GetChannelCount(out uint pn); int SetMasterVolumeLevel(float f, Guid p);
  int SetMasterVolumeLevelScalar(float f, Guid p); int GetMasterVolumeLevel(out float pf);
  int GetMasterVolumeLevelScalar(out float pf); int SetChannelVolumeLevel(uint n, float f, Guid p);
  int SetChannelVolumeLevelScalar(uint n, float f, Guid p); int GetChannelVolumeLevel(uint n, out float pf);
  int GetChannelVolumeLevelScalar(uint n, out float pf); int SetMute([MarshalAs(UnmanagedType.Bool)] bool b, Guid p);
  int GetMute(out bool pb); int GetVolumeStepInfo(out uint pn, out uint p); int VolumeStepUp(Guid p); int VolumeStepDown(Guid p);
  int QueryHardwareSupport(out uint pd); int GetVolumeRange(out float a, out float b, out float c);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid id, uint cls, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object pp); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int EnumAudioEndpoints(int d, int s, out IntPtr p); int GetDefaultAudioEndpoint(int d, int r, out IMMDevice pp); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator {}
public class VolGet {
  public static string Get() {
    var en = (IMMDeviceEnumerator)(object)new MMDeviceEnumerator();
    IMMDevice dev; en.GetDefaultAudioEndpoint(0, 1, out dev);
    Guid iid = typeof(IAudioEndpointVolume).GUID;
    object epObj; dev.Activate(ref iid, 1, IntPtr.Zero, out epObj);
    var ep = (IAudioEndpointVolume)epObj;
    float cur; bool m; ep.GetMasterVolumeLevelScalar(out cur); ep.GetMute(out m);
    return "volume=" + ((int)Math.Round(cur*100)) + " mute=" + m;
  }
}
"@
[VolGet]::Get()
`);
}

/** 0–100 display brightness (laptop/WMI; desktops may fail). */
export async function setBrightness(level: number): Promise<string> {
  const blocked = winOnly();
  if (blocked) return blocked;
  const pct = Math.max(0, Math.min(100, Math.round(level)));
  const res = await runPowerShellQuiet(`
$m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop
$m.WmiSetBrightness(1, ${pct}) | Out-Null
$cur = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction SilentlyContinue
'OK brightness=' + ${pct} + $(if ($cur) { ' current=' + $cur.CurrentBrightness } else { '' })
`);
  if (res.ok && /OK brightness/i.test(res.out)) return res.out;

  await execAsync(`Start-Process ms-settings:display`, {
    shell: "powershell.exe",
    windowsHide: true,
  }).catch(() => undefined);
  return `Не удалось сменить яркость через WMI на этом мониторе. Открыл Параметры → Дисплей.`;
}

export async function getDisplayModes(): Promise<string> {
  const blocked = winOnly();
  if (blocked) return blocked;
  return runPs(`
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
public struct DEVMODE {
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
  public short SpecVersion; public short DriverVersion; public short Size; public short DriverExtra;
  public int Fields;
  public int PositionX; public int PositionY; public int DisplayOrientation; public int DisplayFixedOutput;
  public short Color; public short Duplex; public short YResolution; public short TTOption; public short Collate;
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string FormName;
  public short LogPixels; public int BitsPerPel; public int PelsWidth; public int PelsHeight;
  public int DisplayFlags; public int DisplayFrequency;
  public int ICMMethod; public int ICMIntent; public int MediaType; public int DitherType;
  public int Reserved1; public int Reserved2; public int PanningWidth; public int PanningHeight;
}
public class Disp {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern bool EnumDisplaySettings(string deviceName, int modeNum, ref DEVMODE devMode);
}
"@
function New-DM { $d = New-Object DEVMODE; $d.Size = [Runtime.InteropServices.Marshal]::SizeOf([type][DEVMODE]); return $d }
$dm = New-DM
if (-not [Disp]::EnumDisplaySettings([NullString]::Value, -1, [ref]$dm)) {
  # fallback QWORD from registry
  $path = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers\\Configuration'
  "CURRENT: (EnumDisplaySettings failed)"
} else {
  "CURRENT: $($dm.PelsWidth)x$($dm.PelsHeight) @$($dm.DisplayFrequency)Hz $($dm.BitsPerPel)bpp"
}
$modes = New-Object System.Collections.Generic.HashSet[string]
for ($i = 0; $i -lt 512; $i++) {
  $m = New-DM
  if (-not [Disp]::EnumDisplaySettings([NullString]::Value, $i, [ref]$m)) { break }
  if ($m.PelsWidth -gt 0 -and $m.DisplayFrequency -gt 0) {
    [void]$modes.Add("$($m.PelsWidth)x$($m.PelsHeight) @$($m.DisplayFrequency)Hz")
  }
}
"MODES:"
@($modes) | Sort-Object | Select-Object -First 60
`);
}

/** Set refresh rate (Hz), optionally keep current resolution. */
export async function setRefreshRate(hz: number, width?: number, height?: number): Promise<string> {
  const blocked = winOnly();
  if (blocked) return blocked;
  const freq = Math.round(hz);
  const w = width != null ? Math.round(width) : 0;
  const h = height != null ? Math.round(height) : 0;
  return runPs(`
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
public struct DEVMODE {
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
  public short SpecVersion; public short DriverVersion; public short Size; public short DriverExtra;
  public int Fields;
  public int PositionX; public int PositionY; public int DisplayOrientation; public int DisplayFixedOutput;
  public short Color; public short Duplex; public short YResolution; public short TTOption; public short Collate;
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string FormName;
  public short LogPixels; public int BitsPerPel; public int PelsWidth; public int PelsHeight;
  public int DisplayFlags; public int DisplayFrequency;
  public int ICMMethod; public int ICMIntent; public int MediaType; public int DitherType;
  public int Reserved1; public int Reserved2; public int PanningWidth; public int PanningHeight;
}
public class Disp {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern bool EnumDisplaySettings(string deviceName, int modeNum, ref DEVMODE devMode);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int ChangeDisplaySettings(ref DEVMODE devMode, int flags);
  public const int CDS_UPDATEREGISTRY = 0x01; public const int CDS_TEST = 0x02;
  public const int DM_PELSWIDTH = 0x80000; public const int DM_PELSHEIGHT = 0x100000; public const int DM_DISPLAYFREQUENCY = 0x400000;
}
"@
function New-DM { $d = New-Object DEVMODE; $d.Size = [Runtime.InteropServices.Marshal]::SizeOf([type][DEVMODE]); return $d }
$dm = New-DM
if (-not [Disp]::EnumDisplaySettings([NullString]::Value, -1, [ref]$dm)) { throw 'EnumDisplaySettings current failed' }
$wantW = ${w}; $wantH = ${h}; $wantHz = ${freq}
if ($wantW -gt 0) { $dm.PelsWidth = $wantW }
if ($wantH -gt 0) { $dm.PelsHeight = $wantH }
$dm.DisplayFrequency = $wantHz
$dm.Fields = [Disp]::DM_PELSWIDTH -bor [Disp]::DM_PELSHEIGHT -bor [Disp]::DM_DISPLAYFREQUENCY
$test = [Disp]::ChangeDisplaySettings([ref]$dm, [Disp]::CDS_TEST)
if ($test -ne 0) { throw "Mode not supported (test=$test): $($dm.PelsWidth)x$($dm.PelsHeight)@$wantHz" }
$r = [Disp]::ChangeDisplaySettings([ref]$dm, [Disp]::CDS_UPDATEREGISTRY)
if ($r -ne 0) { throw "ChangeDisplaySettings failed code=$r" }
$cur = New-DM
[void][Disp]::EnumDisplaySettings([NullString]::Value, -1, [ref]$cur)
"OK display=$($cur.PelsWidth)x$($cur.PelsHeight) @$($cur.DisplayFrequency)Hz"
`);
}

/** Enable/disable Windows Mobile Hotspot (requires radio + often admin). */
export async function setMobileHotspot(enable: boolean, ssid?: string, password?: string): Promise<string> {
  const blocked = winOnly();
  if (blocked) return blocked;
  const on = enable ? "$true" : "$false";

  // Best-effort WinRT tethering + settings fallback
  const script = `
$ErrorActionPreference = 'Stop'
$enable = ${on}
try {
  [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager,Windows.Networking.NetworkOperators,ContentType=WindowsRuntime] | Out-Null
  $profile = [Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime]::GetInternetConnectionProfile()
  if (-not $profile) { throw 'No internet connection profile' }
  $tm = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($profile)
  if ($enable) {
    $cfg = $tm.GetCurrentAccessPointConfiguration()
${ssid ? `    $cfg.Ssid = ${JSON.stringify(ssid)}` : ""}
${password ? `    $cfg.Passphrase = ${JSON.stringify(password)}` : ""}
    if (${ssid || password ? "$true" : "$false"}) { $tm.ConfigureAccessPointAsync($cfg).AsTask().Wait() }
    $op = $tm.StartTetheringAsync().AsTask(); $op.Wait(); $res = $op.Result
    "OK hotspot START status=$($res.Status)"
  } else {
    $op = $tm.StopTetheringAsync().AsTask(); $op.Wait(); $res = $op.Result
    "OK hotspot STOP status=$($res.Status)"
  }
} catch {
  Start-Process 'ms-settings:network-mobilehotspot' | Out-Null
  "ERROR WinRT hotspot: $($_.Exception.Message). Opened Mobile Hotspot settings."
}
`;
  let out = await runPs(script, 90_000);
  if (/ERROR WinRT/i.test(out) && enable) {
    // Legacy hostednetwork (often disabled on modern Win11)
    try {
      const elev = await runElevatedCommand(
        `
netsh wlan set hostednetwork mode=allow ${ssid ? `ssid=${JSON.stringify(ssid)}` : ""} ${password ? `key=${JSON.stringify(password)}` : ""}
netsh wlan start hostednetwork
'OK netsh hostednetwork attempted'
`,
        60_000,
      );
      out += `\n${elev}`;
    } catch (e) {
      out += `\nnetsh: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return out;
}

export async function systemControlsHelp(): Promise<string> {
  return [
    "Доступные системные контроли:",
    "- system.set_volume / system.get_volume — громкость 0–100, mute",
    "- system.set_brightness — яркость 0–100 (часто только ноутбуки)",
    "- system.get_display_modes / system.set_refresh_rate — герцовка/режим экрана",
    "- system.set_hotspot — мобильный хотспот on/off",
    "- system.update_drivers — драйверы / Windows Update",
    "- system.set_wallpaper, system.open_settings, system.empty_recycle_bin",
  ].join("\n");
}
