import type { VerifyResult, Verdict, WorldSnapshot } from "./types.js";

export type VerifierName =
  | "chat_open"
  | "composer_focused"
  | "message_sent"
  | "reply_received"
  | "browser_url_ok"
  | "system_ok"
  | "end_phrase_or_continue"
  | "not_search_bar"
  | "tool_ok";

export interface VerifyContext {
  name: VerifierName;
  world?: WorldSnapshot;
  expectedContact?: string;
  expectedUrlTopic?: string;
  lastSentMessage?: string;
  lastSeenReply?: string;
  endPhrase?: string;
  /** Raw tool / harness output to inspect. */
  evidence?: string;
  /** True when search bar contains the message text (failure mode). */
  searchBarLooksLikeMessage?: boolean;
}

/** Pure verifiers — no I/O. Callers supply world/evidence. */
export function verify(ctx: VerifyContext): VerifyResult {
  switch (ctx.name) {
    case "chat_open":
      return verdict(
        ctx.world?.telegram?.chatOpen &&
          (!ctx.expectedContact ||
            ctx.world.telegram.chatOpen.toLowerCase().includes(ctx.expectedContact.toLowerCase()))
          ? "pass"
          : ctx.world?.telegram?.chatOpen
            ? "fail"
            : "unknown",
        ctx.world?.telegram?.chatOpen
          ? `Open chat: ${ctx.world.telegram.chatOpen}`
          : "Chat open state unknown",
      );

    case "composer_focused":
    case "not_search_bar":
      if (ctx.searchBarLooksLikeMessage) {
        return verdict("fail", "Focus is in SEARCH bar — message would go to the lupa, not the chat");
      }
      if (ctx.world?.telegram?.searchBarText && ctx.lastSentMessage) {
        if (ctx.world.telegram.searchBarText.includes(ctx.lastSentMessage.slice(0, 12))) {
          return verdict("fail", "Search bar contains the outgoing message text");
        }
      }
      return verdict("pass", "Composer focus looks OK (search bar not polluted)");

    case "message_sent":
      if (!ctx.lastSentMessage) return verdict("unknown", "No lastSentMessage recorded");
      if (ctx.searchBarLooksLikeMessage) {
        return verdict("fail", "Text landed in search, not sent");
      }
      return verdict("pass", `Recorded send: ${ctx.lastSentMessage.slice(0, 80)}`);

    case "reply_received":
      if (!ctx.lastSeenReply) return verdict("fail", "No new reply detected yet");
      return verdict("pass", `Reply: ${ctx.lastSeenReply.slice(0, 120)}`);

    case "browser_url_ok": {
      const url = ctx.world?.browser?.url ?? "";
      const title = ctx.world?.browser?.title ?? "";
      const topic = (ctx.expectedUrlTopic ?? "").toLowerCase();
      if (!topic) return verdict(url ? "pass" : "unknown", url || "No browser URL");
      const hay = `${url} ${title}`.toLowerCase();
      if (hay.includes(topic) || topic.split(/\s+/).some((w) => w.length > 3 && hay.includes(w))) {
        return verdict("pass", `URL/title matches topic «${topic}»: ${url}`);
      }
      return verdict("fail", `URL/title does not match «${topic}»: ${url} | ${title}`);
    }

    case "system_ok":
      if (ctx.evidence?.startsWith("ERROR")) return verdict("fail", ctx.evidence.slice(0, 200));
      return verdict(ctx.evidence ? "pass" : "unknown", ctx.evidence?.slice(0, 200) ?? "no evidence");

    case "tool_ok":
      if (!ctx.evidence?.trim()) return verdict("unknown", "Tool returned no evidence");
      if (/^(ERROR|FAIL|WARNING|BLOCKED)\b/i.test(ctx.evidence.trim())) {
        return verdict("fail", ctx.evidence.slice(0, 200));
      }
      return verdict("pass", ctx.evidence.slice(0, 200));

    case "end_phrase_or_continue": {
      const end = (ctx.endPhrase ?? "до свидания").toLowerCase();
      if (ctx.lastSeenReply?.toLowerCase().includes(end)) {
        return verdict("pass", `End phrase «${end}» detected — mission can finish`);
      }
      return verdict("fail", "End phrase not yet seen — continue loop");
    }

    default:
      return verdict("unknown", `No verifier for ${ctx.name}`);
  }
}

function verdict(v: Verdict, reason: string): VerifyResult {
  return { verdict: v, reason };
}

/** Detect the classic failure: typed into Telegram search instead of composer. */
export function looksLikeSearchBarPollution(searchText: string | null | undefined, message: string): boolean {
  if (!searchText || !message) return false;
  const s = searchText.replace(/\s+/g, "").toLowerCase();
  const m = message.replace(/\s+/g, "").toLowerCase().slice(0, 20);
  if (m.length < 4) return false;
  return s.includes(m) || (s.length > 15 && /[а-яa-z]{4,}/i.test(s) && s.length > 12);
}
