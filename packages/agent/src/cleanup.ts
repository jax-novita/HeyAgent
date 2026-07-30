/** Shared cleanup for model-produced chat lines. */
export function cleanupLine(s: string): string {
  let t = (s ?? "")
    // Strip model chain-of-thought / reasoning leaks
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?think>/gi, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^\s*(Here's a thinking process|Thinking process|Reasoning)[\s\S]*?(?=\n\S)/gim, "")
    .replace(/^\s*(сообщение|message|ответ|reply)\s*[:\-–]\s*/i, "")
    .replace(/^["'«»`]+|["'«»`]+$/g, "")
    .trim();

  // If still multi-paragraph junk, keep the last short non-meta line
  if (t.length > 280 || /\n/.test(t)) {
    const lines = t
      .split(/\r?\n+/)
      .map((l) => l.trim())
      .filter(Boolean)
      .filter(
        (l) =>
          !/^(here'?s|analyze|deconstruct|draft|option|final|output|self-correction|note:|wait,|proceeds)/i.test(
            l,
          ) && !/^[\d.*\-•]+\s/.test(l) && l.length < 200,
      );
    const last = lines[lines.length - 1];
    if (last) t = last.replace(/^["'«»`]+|["'«»`]+$/g, "").trim();
  }

  // Hard cap — never dump a novel into Telegram
  if (t.length > 400) t = t.slice(0, 397) + "…";
  return t;
}
