/**
 * Strip URLs / errors / paths before TTS so cloud (ElevenLabs) tokens aren't wasted.
 */
export function prepareTextForTts(raw: string): { text: string; skip: boolean; reason?: string } {
  let t = String(raw ?? "");

  // Drop fenced code / json-ish blocks
  t = t.replace(/```[\s\S]*?```/g, " ");
  t = t.replace(/^\s*ERROR:.*$/gim, " ");
  t = t.replace(/^\s*FAIL:.*$/gim, " ");
  t = t.replace(/\bERROR:\s*[^\n]*/gi, " ");
  t = t.replace(/\bFAIL(?:ED)?:\s*[^\n]*/gi, " ");
  t = t.replace(/Done\.\s*Ran:\s*[^\n]*/gi, " ");
  t = t.replace(/\(tools?:\s*[^)]+\)/gi, " ");

  // URLs and telegram links
  t = t.replace(/https?:\/\/\S+/gi, " ");
  t = t.replace(/\bwww\.\S+/gi, " ");
  t = t.replace(/\bt\.me\/\S+/gi, " ");

  // Absolute paths
  t = t.replace(/[A-Za-z]:\\[^\s]+/g, " ");
  t = t.replace(/\/(?:Users|home|var|tmp|Users)\/\S+/g, " ");
  t = t.replace(/\bpath:\s*\S+/gi, " ");

  // Markdown noise
  t = t.replace(/^#{1,6}\s+/gm, "");
  t = t.replace(/[*_`~]+/g, "");
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // Stack-ish lines
  t = t.replace(/^\s*at\s+\S+.*$/gim, " ");
  t = t.replace(/\{[\s\S]{40,}\}/g, " ");

  t = t.replace(/\s+/g, " ").trim();
  if (t.length > 700) t = `${t.slice(0, 700).trim()}…`;

  if (t.length < 8) {
    return { text: "", skip: true, reason: "empty_after_sanitize" };
  }
  if (/^(ok|done|error|fail|null|undefined)[.!]?$/i.test(t)) {
    return { text: "", skip: true, reason: "noise_only" };
  }
  return { text: t, skip: false };
}
