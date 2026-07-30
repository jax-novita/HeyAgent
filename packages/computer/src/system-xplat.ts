/**
 * System controls for macOS and Linux (volume, brightness, power, wifi, notifications…).
 * Windows stays in system-controls.ts / system-suite.ts.
 */
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { platform } from "node:os";
import { which } from "./platform-input.js";

const execAsync = promisify(exec);

export type XplatSystemAction =
  | "volume_set"
  | "volume_get"
  | "mute"
  | "unmute"
  | "brightness_set"
  | "brightness_delta"
  | "lock"
  | "sleep"
  | "hibernate"
  | "shutdown"
  | "restart"
  | "wifi_on"
  | "wifi_off"
  | "bt_on"
  | "bt_off"
  | "notify"
  | "open_settings"
  | "empty_trash"
  | "theme_dark"
  | "theme_light"
  | "help";

export interface XplatSystemParams {
  action: XplatSystemAction | string;
  level?: number;
  delta?: number;
  text?: string;
  page?: string;
}

function isDarwin(): boolean {
  return platform() === "darwin";
}
function isLinux(): boolean {
  return platform() === "linux";
}

async function sh(cmd: string): Promise<string> {
  const { stdout, stderr } = await execAsync(cmd, {
    shell: "/bin/sh",
    maxBuffer: 2e6,
    timeout: 30000,
  });
  return [stdout, stderr].filter(Boolean).join("\n").trim();
}

export async function systemControlXplat(params: XplatSystemParams): Promise<string> {
  if (!isDarwin() && !isLinux()) {
    return "ERROR: systemControlXplat is for macOS/Linux only";
  }
  const a = String(params.action || "");
  try {
    switch (a) {
      case "volume_set":
        return setVolume(params.level ?? 50);
      case "volume_get":
        return getVolume();
      case "mute":
        return mute(true);
      case "unmute":
        return mute(false);
      case "brightness_set":
        return setBrightness(params.level ?? 50);
      case "brightness_delta":
        return brightnessDelta(params.delta ?? 10);
      case "lock":
        return lockScreen();
      case "sleep":
        return sleepMachine();
      case "hibernate":
        return hibernateMachine();
      case "shutdown":
        return power("shutdown");
      case "restart":
        return power("restart");
      case "wifi_on":
        return wifi(true);
      case "wifi_off":
        return wifi(false);
      case "bt_on":
        return bluetooth(true);
      case "bt_off":
        return bluetooth(false);
      case "notify":
        return notify(params.text || "HeyAgent");
      case "open_settings":
        return openSettings(params.page || "");
      case "empty_trash":
        return emptyTrash();
      case "theme_dark":
        return setTheme(true);
      case "theme_light":
        return setTheme(false);
      case "help":
        return [
          "macOS/Linux system.control actions:",
          "volume_set/get, mute/unmute, brightness_set/delta,",
          "lock, sleep, hibernate, shutdown, restart,",
          "wifi_on/off, bt_on/off, notify, open_settings,",
          "empty_trash, theme_dark/light",
        ].join("\n");
      default:
        return `ERROR: неизвестное действие «${a}» на ${platform()}`;
    }
  } catch (err) {
    return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function setVolume(level: number): Promise<string> {
  const v = Math.max(0, Math.min(100, Math.round(level)));
  if (isDarwin()) {
    // mac volume is 0–100 in osascript for output volume
    await sh(`osascript -e 'set volume output volume ${v}'`);
    return `volume=${v}`;
  }
  if (await which("wpctl")) {
    await sh(`wpctl set-volume @DEFAULT_AUDIO_SINK@ ${v / 100}`);
    return `volume=${v}`;
  }
  if (await which("pactl")) {
    await sh(`pactl set-sink-volume @DEFAULT_SINK@ ${v}%`);
    return `volume=${v}`;
  }
  if (await which("amixer")) {
    await sh(`amixer -q sset Master ${v}%`);
    return `volume=${v}`;
  }
  return "ERROR: no volume tool (wpctl/pactl/amixer)";
}

async function getVolume(): Promise<string> {
  if (isDarwin()) {
    const out = await sh(`osascript -e 'output volume of (get volume settings)'`);
    return `volume=${out.trim()}`;
  }
  if (await which("wpctl")) {
    const out = await sh(`wpctl get-volume @DEFAULT_AUDIO_SINK@`);
    const m = out.match(/([0-9.]+)/);
    return m ? `volume=${Math.round(Number(m[1]) * 100)}` : out;
  }
  if (await which("pactl")) {
    const out = await sh(`pactl get-sink-volume @DEFAULT_SINK@`);
    const m = out.match(/(\\d+)%/);
    return m ? `volume=${m[1]}` : out;
  }
  return "volume=unknown";
}

async function mute(on: boolean): Promise<string> {
  if (isDarwin()) {
    await sh(`osascript -e 'set volume output muted ${on}'`);
    return on ? "muted" : "unmuted";
  }
  if (await which("wpctl")) {
    await sh(`wpctl set-mute @DEFAULT_AUDIO_SINK@ ${on ? 1 : 0}`);
    return on ? "muted" : "unmuted";
  }
  if (await which("pactl")) {
    await sh(`pactl set-sink-mute @DEFAULT_SINK@ ${on ? 1 : 0}`);
    return on ? "muted" : "unmuted";
  }
  return "ERROR: no mute tool";
}

async function setBrightness(level: number): Promise<string> {
  const v = Math.max(0, Math.min(100, Math.round(level)));
  if (isDarwin()) {
    if (await which("brightness")) {
      await sh(`brightness ${v / 100}`);
      return `brightness=${v}`;
    }
    // Best-effort via AppleScript (often needs Assistive Access / not always available)
    return `WARNING: установи CLI «brightness» (brew install brightness). Запрошено ${v}%`;
  }
  if (await which("brightnessctl")) {
    await sh(`brightnessctl set ${v}%`);
    return `brightness=${v}`;
  }
  return "WARNING: brightnessctl не найден; яркость не изменена";
}

async function brightnessDelta(delta: number): Promise<string> {
  const d = Math.round(delta);
  if (isDarwin() && (await which("brightness"))) {
    // no get easily — approximate relative
    await sh(`brightness ${d > 0 ? `+${d / 100}` : `${d / 100}`}`).catch(async () => {
      await sh(`brightness 0.5`);
    });
    return `brightness_delta=${d}`;
  }
  if (await which("brightnessctl")) {
    const sign = d >= 0 ? `+${d}%` : `${d}%`;
    await sh(`brightnessctl set ${sign}`);
    return `brightness_delta=${d}`;
  }
  return await setBrightness(50 + d);
}

async function lockScreen(): Promise<string> {
  if (isDarwin()) {
    await sh(
      `osascript -e 'tell application "System Events" to keystroke "q" using {control down, command down}'`,
    ).catch(() => sh(`/System/Library/CoreServices/Menu\\ Extras/User.menu/Contents/Resources/CGSession -suspend`));
    return "locked";
  }
  await sh(`loginctl lock-session`).catch(() => sh(`gnome-screensaver-command -l`));
  return "locked";
}

async function sleepMachine(): Promise<string> {
  if (isDarwin()) {
    await sh(`pmset sleepnow`);
    return "sleep";
  }
  await sh(`systemctl suspend`).catch(() => sh(`loginctl suspend`));
  return "sleep";
}

async function hibernateMachine(): Promise<string> {
  if (isDarwin()) {
    await sh(`pmset sleepnow`);
    return "hibernate≈sleep (macOS)";
  }
  await sh(`systemctl hibernate`).catch(() => sh(`systemctl suspend`));
  return "hibernate";
}

async function power(kind: "shutdown" | "restart"): Promise<string> {
  if (isDarwin()) {
    await sh(kind === "shutdown" ? `osascript -e 'tell app "System Events" to shut down'` : `osascript -e 'tell app "System Events" to restart'`);
    return kind;
  }
  await sh(kind === "shutdown" ? `systemctl poweroff` : `systemctl reboot`);
  return kind;
}

async function wifi(on: boolean): Promise<string> {
  if (isDarwin()) {
    const device = (await sh(`networksetup -listallhardwareports | awk '/Wi-Fi|AirPort/{getline; print $2; exit}'`)).trim() || "en0";
    await sh(`networksetup -setairportpower ${device} ${on ? "on" : "off"}`);
    return `wifi=${on ? "on" : "off"}`;
  }
  if (await which("nmcli")) {
    await sh(`nmcli radio wifi ${on ? "on" : "off"}`);
    return `wifi=${on ? "on" : "off"}`;
  }
  await sh(`rfkill ${on ? "unblock" : "block"} wifi`);
  return `wifi=${on ? "on" : "off"}`;
}

async function bluetooth(on: boolean): Promise<string> {
  if (isDarwin()) {
    if (await which("blueutil")) {
      await sh(`blueutil --power ${on ? 1 : 0}`);
      return `bluetooth=${on ? "on" : "off"}`;
    }
    return "WARNING: brew install blueutil для Bluetooth";
  }
  if (await which("bluetoothctl")) {
    await sh(`bluetoothctl power ${on ? "on" : "off"}`);
    return `bluetooth=${on ? "on" : "off"}`;
  }
  await sh(`rfkill ${on ? "unblock" : "block"} bluetooth`);
  return `bluetooth=${on ? "on" : "off"}`;
}

async function notify(text: string): Promise<string> {
  const t = text.replace(/"/g, '\\"').slice(0, 200);
  if (isDarwin()) {
    await sh(`osascript -e 'display notification "${t}" with title "HeyAgent"'`);
    return "notified";
  }
  if (await which("notify-send")) {
    await sh(`notify-send "HeyAgent" "${t}"`);
    return "notified";
  }
  return "WARNING: notify-send не найден";
}

async function openSettings(page: string): Promise<string> {
  if (isDarwin()) {
    // deep links: x-apple.systempreferences:...
    const map: Record<string, string> = {
      wifi: "x-apple.systempreferences:com.apple.preference.network",
      bluetooth: "x-apple.systempreferences:com.apple.preference.bluetooth",
      display: "x-apple.systempreferences:com.apple.preference.displays",
      sound: "x-apple.systempreferences:com.apple.preference.sound",
    };
    const url = map[page.toLowerCase()] || "/System/Applications/System Settings.app";
    if (url.startsWith("x-apple")) await sh(`open "${url}"`);
    else await sh(`open -a "System Settings"`);
    return `opened settings ${page || "root"}`;
  }
  await sh(`xdg-open settings://`).catch(() =>
    sh(`gnome-control-center`).catch(() => sh(`systemsettings5`)),
  );
  return `opened settings ${page || "root"}`;
}

async function emptyTrash(): Promise<string> {
  if (isDarwin()) {
    await sh(`osascript -e 'tell application "Finder" to empty trash'`);
    return "Корзина очищена.";
  }
  await sh(`rm -rf "$HOME/.local/share/Trash/files/"* "$HOME/.local/share/Trash/info/"*`).catch(
    () => undefined,
  );
  return "Корзина очищена.";
}

async function setTheme(dark: boolean): Promise<string> {
  if (isDarwin()) {
    await sh(
      `osascript -e 'tell application "System Events" to tell appearance preferences to set dark mode to ${dark}'`,
    );
    return dark ? "theme=dark" : "theme=light";
  }
  // GNOME
  await sh(
    `gsettings set org.gnome.desktop.interface color-scheme '${dark ? "prefer-dark" : "prefer-light"}'`,
  ).catch(() =>
    sh(
      `gsettings set org.gnome.desktop.interface gtk-theme '${dark ? "Adwaita-dark" : "Adwaita"}'`,
    ),
  );
  return dark ? "theme=dark" : "theme=light";
}
