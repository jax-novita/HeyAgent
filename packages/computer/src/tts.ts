/**
 * Agent → user voice: ElevenLabs (same as Telegram), then play on speakers.
 * OS SAPI/say kept only as emergency fallback when explicitly requested.
 */
import { exec, spawn } from "node:child_process";
import { promisify } from "node:util";
import { platform } from "node:os";
import { which } from "./platform-input.js";
import { prepareTextForTts } from "./tts-sanitize.js";
import { synthesizeAgentReplyAudio } from "./elevenlabs-tts.js";
import { playAudioFileSilent } from "./play-audio.js";

export { prepareTextForTts } from "./tts-sanitize.js";
export { synthesizeAgentReplyAudio } from "./elevenlabs-tts.js";
export { playAudioFileSilent } from "./play-audio.js";

const execAsync = promisify(exec);

/**
 * CLI / desktop: ElevenLabs TTS → speakers (no Video/Music app window).
 */
export async function speakAgentReply(
  text: string,
  opts: { wait?: boolean } = {},
): Promise<string> {
  const audio = await synthesizeAgentReplyAudio(text);
  if ("skip" in audio) {
    return `skip:${audio.reason}`;
  }
  return playAudioFileSilent(audio.path, { wait: opts.wait === true });
}

export async function speak(text: string, opts: { lang?: string } = {}): Promise<string> {
  const r = await speakAgentReply(text, { wait: true });
  if (!r.startsWith("skip:") && !r.startsWith("ERROR")) return r;
  return speakSilent(text, { ...opts, wait: true });
}

/**
 * Legacy OS TTS (SAPI/say). Prefer speakAgentReply — ElevenLabs.
 */
export async function speakSilent(
  text: string,
  opts: { lang?: string; wait?: boolean } = {},
): Promise<string> {
  const prepared = prepareTextForTts(text);
  if (prepared.skip || !prepared.text) return `skip:${prepared.reason || "empty"}`;
  const t = prepared.text.slice(0, 280);
  const os = platform();
  const wait = opts.wait !== false;

  try {
    if (os === "win32") {
      const escaped = t.replace(/'/g, "''");
      const ps = [
        "Add-Type -AssemblyName System.Speech",
        "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer",
        "$s.Rate=1",
        `$s.Speak('${escaped}')`,
      ].join("; ");
      if (wait) {
        await execAsync(ps, {
          shell: "powershell.exe",
          timeout: 90_000,
          windowsHide: true,
        });
      } else {
        spawn("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", ps], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        }).unref();
      }
      return `spoke: ${t}`;
    }
    if (os === "darwin") {
      const voice = opts.lang?.startsWith("ru") ? "Milena" : "";
      const args = voice ? ["-v", voice, t] : [t];
      if (wait) {
        await execAsync(`say ${voice ? `-v ${voice} ` : ""}${JSON.stringify(t)}`, {
          timeout: 90_000,
        }).catch(() => execAsync(`say ${JSON.stringify(t)}`));
      } else {
        spawn("say", args, { detached: true, stdio: "ignore" }).unref();
      }
      return `spoke: ${t}`;
    }
    const bin =
      ((await which("espeak-ng")) && "espeak-ng") ||
      ((await which("spd-say")) && "spd-say") ||
      ((await which("espeak")) && "espeak") ||
      null;
    if (!bin) return "WARNING: no TTS engine (espeak-ng / spd-say / say)";
    const lang = opts.lang?.startsWith("ru") ? "ru" : "en";
    const args = bin === "espeak-ng" || bin === "espeak" ? ["-v", lang, t] : [t];
    if (wait) {
      await execAsync(
        bin === "spd-say" ? `spd-say ${JSON.stringify(t)}` : `${bin} -v ${lang} ${JSON.stringify(t)}`,
      );
    } else {
      spawn(bin, args, { detached: true, stdio: "ignore" }).unref();
    }
    return `spoke: ${t}`;
  } catch (err) {
    return `ERROR TTS: ${err instanceof Error ? err.message : String(err)}`;
  }
}
