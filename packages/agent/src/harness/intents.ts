/** Shared intent detectors for harness match + mail. */

export function detectPreferredBrowser(
  text: string,
): "yandex" | "chrome" | "edge" | "auto" {
  const lower = text.toLowerCase();
  if (/яндекс|yandex|я\.?браузер|ya\s*browser/i.test(lower)) return "yandex";
  if (/chrome|хром/i.test(lower)) return "chrome";
  if (/\bedge\b|эдж/i.test(lower)) return "edge";
  return "auto";
}

export function detectHardBrowserMissionIntent(text: string): {
  kind: "wikipedia" | "reddit" | "multitab" | "stop" | "selected" | "recover";
  hops?: number;
  query?: string;
  browser: "yandex" | "chrome" | "edge" | "auto";
} | null {
  const lower = text.toLowerCase();
  const browser = detectPreferredBrowser(text);

  if (/^(стоп|отмена|cancel|хватит|останови|stop)\b/i.test(text.trim())) {
    return { kind: "stop", browser };
  }
  if (/восстанов|recover|убей браузер|браузер.*(упал|убит)|session.*(restore|recover)/i.test(lower)) {
    return { kind: "recover", browser };
  }
  if (/какой элемент.*(выделен|в фокусе)|what.*(selected|focused)|выделен на странице/i.test(lower)) {
    return { kind: "selected", browser };
  }
  if (
    /википед|wikipedia/i.test(lower) &&
    /(перв(ой|ую) ссылк|first link|100|сто раз|переходи)/i.test(lower)
  ) {
    const hops = Number(lower.match(/\b(\d{1,3})\b/)?.[1] ?? 100);
    return { kind: "wikipedia", hops: Math.min(Math.max(hops, 1), 100), browser };
  }
  if (/reddit/i.test(lower) && /openai/i.test(lower) && /(апвоут|upvote|scroll|прокрут|пост)/i.test(lower)) {
    return { kind: "reddit", browser };
  }
  if (
    /(несколько вкладок|вкладк)/i.test(lower) &&
    /github/i.test(lower) &&
    /reddit/i.test(lower) &&
    /(hacker news|hn|хакер)/i.test(lower)
  ) {
    const q =
      text.match(/проект[ае]?\s+["«]?([A-Za-z0-9_.-]+)/i)?.[1] ||
      text.match(/про\s+["«]?([A-Za-z0-9_.-]+)/i)?.[1] ||
      "TypeScript";
    return { kind: "multitab", query: q, browser };
  }
  if (/сравни обсуждение/i.test(lower) && /github|reddit|hacker/i.test(lower)) {
    return { kind: "multitab", query: "TypeScript", browser };
  }
  return null;
}

export function detectGitHubMissionIntent(
  text: string,
): { repo: string; browser: "yandex" | "chrome" | "edge" | "auto" } | null {
  const lower = text.toLowerCase();
  const mentionsGithub = /github|гитхаб|гитхабе/i.test(lower);
  const multiStep =
    /(репозитор|repository|issue|автор|профиль|profile|верн)/i.test(lower) &&
    /(обсуждаем|comment|popular|популяр|найди|открой|перейди|зайди)/i.test(lower);
  if (!mentionsGithub || !multiStep) {
    if (
      !/microsoft\s*\/\s*typescript|microsoft\/typescript/i.test(lower) ||
      !/(issue|автор|профиль)/i.test(lower)
    ) {
      return null;
    }
  }
  if (!mentionsGithub && !/microsoft\s*\/\s*typescript/i.test(lower)) return null;

  const repoMatch =
    text.match(/\b([A-Za-z0-9_.-]+)\s*\/\s*([A-Za-z0-9_.-]+)\b/) ||
    text.match(/github\.com\/([^/\s]+)\/([^/\s#?]+)/i);
  const repo = repoMatch
    ? `${repoMatch[1]}/${repoMatch[2]}`.replace(/\s+/g, "")
    : "microsoft/TypeScript";

  return { repo, browser: detectPreferredBrowser(text) };
}

export function detectMailIntent(text: string): {
  kind: "open" | "check" | "compose" | "reply" | "send";
  limit: number;
  unreadOnly: boolean;
  to?: string;
  subject?: string;
  body?: string;
  send?: boolean;
  browser: "yandex" | "chrome" | "edge" | "auto";
} | null {
  const value = text.trim();
  const lower = value.toLowerCase();
  const browser = detectPreferredBrowser(value);

  const hasMailContext =
    /(письм|mail|email|имейл|мейл|gmail|почт|inbox|входящ)/i.test(lower) ||
    /[\w.+-]+@[\w.-]+\.\w+/.test(value);
  const namesOtherChannel =
    /(телеграм|telegram|тг\b|whats\s?app|вотсап|ватсап|вайбер|viber|discord|дискорд|\bsms\b|смс|мессендж|messenger|инстаграм|instagram|директ)/i.test(
      lower,
    );
  if (namesOtherChannel && !hasMailContext) return null;

  if (/^(отправь|отправь письмо|send( it| mail| email)?)\s*$/i.test(value)) {
    return { kind: "send", limit: 10, unreadOnly: false, browser };
  }

  const wantsCompose =
    /(напиши|написать|отправь|создай).{0,40}(письм|email|имейл|мейл)/i.test(lower) ||
    /(compose|write|send).{0,20}(email|mail|letter)/i.test(lower);
  if (wantsCompose) {
    const emailMatch = value.match(/[\w.+-]+@[\w.-]+\.\w+/);
    const to = emailMatch?.[0];
    const subject =
      value.match(/(?:тема|subject)\s*[:\-–]\s*(.+?)(?:\n|$)/i)?.[1]?.trim() ||
      value.match(/про\s+["«](.+?)["»]/i)?.[1]?.trim();
    const body =
      value.match(/(?:текст|body|содержание)\s*[:\-–]\s*([\s\S]+)/i)?.[1]?.trim() ||
      value.match(/["«]([\s\S]{3,})["»]/)?.[1]?.trim() ||
      (to
        ? value
            .replace(to, "")
            .replace(/(напиши|написать|отправь|создай).{0,20}(письм|email|имейл|мейл)\w*/i, "")
            .replace(/(?:тема|subject)\s*[:\-–]\s*.+/i, "")
            .replace(/яндекс|yandex|chrome|хром|edge|эдж|браузер(е|а)?/gi, "")
            .trim()
        : undefined);
    const send = /(отправь|send now|сразу отправ)/i.test(lower);
    return {
      kind: "compose",
      limit: 10,
      unreadOnly: false,
      to: to || undefined,
      subject: subject || "Привет",
      body: body || "Привет!",
      send,
      browser,
    };
  }

  const wantsReply =
    hasMailContext &&
    /(ответь|ответить|reply)/i.test(lower) &&
    /(письм|mail|email|gmail|почт|на\s+(это\s+)?письмо|inbox)/i.test(lower);
  if (wantsReply) {
    const body =
      value.match(/(?:текст|body|:)\s*([\s\S]+)/i)?.[1]?.trim() ||
      value.replace(/^(ответь|ответить|reply)\s*/i, "").trim() ||
      "Спасибо, получил!";
    const send = /(и отправ|отправь|send)/i.test(lower);
    return { kind: "reply", limit: 10, unreadOnly: false, body, send, browser };
  }

  const wantsOpen =
    /(открой|открыть|open).{0,20}(gmail|почт|mail)/i.test(lower) ||
    /(проверь|посмотри|покажи|прочитай|кто).{0,30}(почт|письм|gmail)/i.test(lower) ||
    /(кто|что).{0,20}(мне )?(написал|прислал)/i.test(lower) ||
    /(check|show|read).{0,20}(mail|email|gmail|inbox)/i.test(lower);
  if (!wantsOpen) return null;

  const count = lower.match(/\b(\d{1,2})\b/)?.[1];
  return {
    kind: /(открой|открыть|open)/i.test(lower) ? "open" : "check",
    limit: Math.max(1, Math.min(Number(count ?? 10), 25)),
    unreadOnly: /(нов|непрочитан|unread)/i.test(lower),
    browser,
  };
}
