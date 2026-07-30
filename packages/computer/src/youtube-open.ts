/**
 * Open a YouTube video.
 * - quick: first matching organic result (skip ads/Shorts only) — default for «открой мне …»
 * - deep: longer lessons / «урок про X» — may scroll a bit, but still prefer a matching top hit
 */
import type { PreferredBrowser } from "./browser-nav.js";
import {
  browserNavigateVerified,
  dismissPopups,
  isBrowserMissionCancelled,
  resetBrowserMissionCancel,
  saveMissionState,
  withCdpPage,
  readPageState,
  type CdpSession,
} from "./browser-agent.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Common typos / latin ↔ cyrillic place names → canonical form for matching. */
const TOKEN_ALIASES: Record<string, string[]> = {
  вашингтон: ["washington", "васшингтон", "вашынгтон", "вошингтон", "vashington"],
  орландо: ["orlando"],
  "нью-йорк": ["newyork", "ньюйорк", "ny"],
  "орел": ["орёл", "eagle"],
  решка: ["tails", "решки"],
  python: ["пайтон", "питон"],
};

function normalizeText(s: string): string {
  let t = s.toLowerCase().replace(/ё/g, "е");
  // apply known typo fixes into canonical tokens
  for (const [canon, alts] of Object.entries(TOKEN_ALIASES)) {
    for (const a of alts) {
      if (a === canon) continue;
      t = t.split(a).join(canon);
    }
  }
  return t;
}

function tokenize(s: string): string[] {
  return normalizeText(s)
    .split(/[^a-zа-я0-9+#._-]+/i)
    .filter((t) => t.length > 1);
}

const STOP = new Set([
  "урок",
  "видео",
  "ролик",
  "выпуск",
  "серия",
  "episode",
  "по",
  "про",
  "на",
  "в",
  "и",
  "the",
  "a",
  "an",
  "of",
  "lesson",
  "tutorial",
  "открыть",
  "открой",
  "найди",
  "покажи",
  "включи",
  "мне",
  "ютуб",
  "youtube",
]);

/** Topic after «про/about» is mandatory — e.g. Вашингтон, not Orlando. */
function extractMustTopics(query: string): string[] {
  const n = normalizeText(query);
  const must: string[] = [];
  const about = n.match(
    /(?:^|[\s,])(?:про|about|про город|про штат)\s+([a-zа-я0-9][a-zа-я0-9-]*(?:\s+[a-zа-я0-9-]+)?)/i,
  );
  if (about?.[1]) {
    for (const t of tokenize(about[1])) {
      if (!STOP.has(t) && t.length >= 3) must.push(t);
    }
  }
  // Known places explicitly in query
  for (const place of Object.keys(TOKEN_ALIASES)) {
    if (n.includes(place) && place.length >= 4) must.push(place);
  }
  return [...new Set(must)];
}

function hayHasTopic(hayRaw: string, topic: string): boolean {
  const hay = normalizeText(hayRaw);
  if (hay.includes(topic)) return true;
  const alts = TOKEN_ALIASES[topic] ?? [];
  if (alts.some((a) => hay.includes(a))) return true;
  // fuzzy: edit distance ≤ 2 for long topics (typos like васшингтон already normalized)
  if (topic.length >= 6) {
    for (const w of tokenize(hayRaw)) {
      if (Math.abs(w.length - topic.length) > 2) continue;
      if (editDistance(w, topic) <= 2) return true;
    }
  }
  return false;
}

function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
    }
  }
  return dp[m]![n]!;
}

function titleMatchesAllMust(title: string, must: string[]): boolean {
  if (!must.length) return true;
  return must.every((t) => hayHasTopic(title, t));
}

/** Correct search string: fix typos so YouTube ranks the right episode. */
export function correctYoutubeQuery(query: string): string {
  return normalizeText(query)
    .replace(/\bвасшингтон\b/g, "вашингтон")
    .trim();
}

export type YtCandidate = {
  title: string;
  href: string;
  channel: string;
  duration: string;
  /** Order in the feed after scrolling (0 = top). */
  index: number;
  viewsHint: string;
};

function durationSeconds(duration: string): number {
  const parts = duration
    .trim()
    .split(":")
    .map((p) => Number(p.replace(/\D/g, "")))
    .filter((n) => !Number.isNaN(n));
  if (!parts.length) return 0;
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
}

/** DOM scrape: organic watch results only (skip ads, Shorts, promos). */
async function scrapeOrganicVideos(session: CdpSession): Promise<YtCandidate[]> {
  return session.evaluate<YtCandidate[]>(`
(() => {
  const out = [];
  const seen = new Set();
  const isAdText = (t) => {
    const s = (t || '').toLowerCase();
    return (
      s.includes('реклама') ||
      s.includes('sponsored') ||
      s.includes('ad ·') ||
      s.includes('ad •') ||
      /^ads?\\b/.test(s.trim())
    );
  };
  const nodes = Array.from(
    document.querySelectorAll('ytd-video-renderer, ytd-rich-item-renderer, ytd-compact-video-renderer')
  );
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    if (el.closest('ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-search-pyv-renderer, ytd-promoted-sparkles-text-search-renderer, ytd-promoted-sparkles-web-renderer')) continue;
    if (el.closest('ytd-reel-shelf-renderer, ytd-rich-shelf-renderer[is-shorts], ytd-reel-item-renderer')) continue;
    if (el.querySelector('a[href*="/shorts/"]') && !el.querySelector('a[href*="/watch"]')) continue;
    const badge = el.querySelector(
      '#ad-badge, .badge-style-type-ad, ytd-badge-supported-renderer .badge-style-type-ad, [class*="ad-badge"], .ytBadgeShape--ad'
    );
    if (badge) continue;
    const blockText = (el.innerText || '').slice(0, 220);
    if (isAdText(blockText)) continue;
    const a =
      el.querySelector('a#video-title') ||
      el.querySelector('a#video-title-link') ||
      el.querySelector('a.yt-simple-endpoint[href*="/watch"]');
    if (!a) continue;
    let href = a.href || a.getAttribute('href') || '';
    if (href.startsWith('/')) href = location.origin + href;
    if (!href.includes('/watch')) continue;
    if (href.includes('/shorts/')) continue;
    try {
      const u = new URL(href, location.origin);
      if (!u.hostname.includes('youtube.com') && !u.hostname.includes('youtu.be')) continue;
      href = u.origin + u.pathname + '?v=' + (u.searchParams.get('v') || '');
      if (!u.searchParams.get('v')) href = u.origin + u.pathname + u.search;
    } catch { continue; }
    const title = (a.getAttribute('title') || a.textContent || '').trim().replace(/\\s+/g, ' ');
    if (!title || title.length < 3) continue;
    const channel = (
      (el.querySelector('#channel-name a, ytd-channel-name a, .ytd-channel-name a') || {}).textContent || ''
    ).trim();
    const duration = (
      (el.querySelector('ytd-thumbnail-overlay-time-status-renderer #text, ytd-thumbnail-overlay-time-status-renderer, span.ytd-thumbnail-overlay-time-status-renderer') || {}).textContent || ''
    ).trim();
    const viewsHint = (
      (el.querySelector('#metadata-line span, .inline-metadata-item, ytd-video-meta-block #metadata-line span') || {}).textContent || ''
    ).trim();
    const key = href.split('&')[0];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title, href: key, channel, duration, viewsHint, index: out.length });
  }
  return out;
})()
`);
}

/** Real scroll: wheel + scrollBy on window and main content, wait for lazy load. */
async function scrollFeedOnce(session: CdpSession): Promise<number> {
  const before = await session.evaluate<number>(
    `Math.max(window.scrollY, document.documentElement.scrollTop || 0)`,
  );
  await session.evaluate(`
(() => {
  const dy = Math.max(900, Math.floor(window.innerHeight * 1.1));
  window.scrollBy({ top: dy, left: 0, behavior: 'instant' });
  const root =
    document.querySelector('ytd-app') ||
    document.querySelector('#content') ||
    document.scrollingElement ||
    document.documentElement;
  if (root && root !== document.documentElement) {
    try { root.scrollBy(0, dy); } catch {}
  }
  // Nudge lazy-load
  window.dispatchEvent(new Event('scroll'));
})()
`);
  // CDP mouse wheel as backup (some YT builds ignore window.scrollBy)
  try {
    await session.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: 400,
      y: 400,
      deltaX: 0,
      deltaY: 1200,
    });
  } catch {
    /* ignore */
  }
  await sleep(900);
  const after = await session.evaluate<number>(
    `Math.max(window.scrollY, document.documentElement.scrollTop || 0)`,
  );
  return after - before;
}

/**
 * Collect organic videos. quick: first screen (+ optional tiny scroll). deep: more scroll.
 */
async function scrollAndCollect(
  session: CdpSession,
  opts: { minScrolls: number; minCandidates: number; maxScrolls: number },
  log: string[],
): Promise<YtCandidate[]> {
  const byHref = new Map<string, YtCandidate>();

  const merge = (list: YtCandidate[]) => {
    for (const c of list) {
      if (!byHref.has(c.href)) byHref.set(c.href, { ...c, index: byHref.size });
    }
  };

  merge(await scrapeOrganicVideos(session));
  log.push(`Before scroll: ${byHref.size} videos`);

  const maxScrolls = Math.max(0, opts.maxScrolls);
  for (let i = 0; i < maxScrolls; i++) {
    if (isBrowserMissionCancelled()) break;
    const enoughScrolls = i >= opts.minScrolls;
    const enoughVideos = byHref.size >= opts.minCandidates;
    if (enoughScrolls && enoughVideos) break;
    const moved = await scrollFeedOnce(session);
    merge(await scrapeOrganicVideos(session));
    log.push(`Scroll ${i + 1}/${maxScrolls}: Δy≈${moved}px, unique videos=${byHref.size}`);
    if (moved < 40) {
      await session.evaluate(`window.scrollTo(0, (window.scrollY || 0) + 1600)`);
      await sleep(700);
    }
  }

  return [...byHref.values()];
}

/** Prefer first organic match for «открой …»; deep only for lessons/tutorials. */
export function detectYoutubeOpenMode(query: string, rawUserText?: string): "quick" | "deep" {
  const t = `${rawUserText || ""} ${query}`.toLowerCase().replace(/ё/g, "е");
  if (
    /(урок|tutorial|курс|с нуля|для начина|гайд|guide|полный курс|learn\b)/i.test(t) ||
    /(выпуск|серия).{0,20}(про|по)\s+/i.test(t)
  ) {
    return "deep";
  }
  return "quick";
}

function scoreCandidate(
  c: YtCandidate,
  query: string,
  skipTop: number,
  mustTopics: string[],
  mode: "quick" | "deep",
): number {
  const tokens = tokenize(query).filter((t) => !STOP.has(t));
  const hay = `${c.title} ${c.channel}`;
  const hayN = normalizeText(hay);
  let score = 0;

  if (mustTopics.length) {
    const hits = mustTopics.filter((t) => hayHasTopic(c.title, t));
    if (hits.length === mustTopics.length) score += 80;
    else if (hits.length) score += 20;
    else score -= 120;
  }

  let tokenHits = 0;
  for (const t of tokens) {
    if (hayN.includes(t) || hayHasTopic(hay, t)) {
      score += 5;
      tokenHits++;
    }
  }
  if (tokens.length && tokenHits >= Math.ceil(tokens.length * 0.5)) score += 25;

  const sec = durationSeconds(c.duration);
  if (mode === "deep") {
    if (sec > 0) {
      score += 2;
      if (sec >= 8 * 60) score += 4;
      if (sec >= 20 * 60) score += 5;
      if (sec < 90) score -= 15;
    } else {
      score -= 4;
    }
    if (
      /урок|tutorial|курс|полный|с нуля|для начина|beginner|гайд|guide|learn|орел|решка|heads|tails/i.test(
        c.title,
      )
    ) {
      score += 3;
    }
    if (!mustTopics.length && c.index < skipTop) score -= 20;
  } else {
    // quick: FIRST matching organic wins — no digging
    if (sec > 0 && sec < 45) score -= 8;
    if (c.index === 0) score += 40;
    else if (c.index === 1) score += 25;
    else if (c.index === 2) score += 12;
    else score -= Math.min(c.index, 8);
  }

  if (/coursera|udemy|skillbox|geekbrains|нетология|реклам|#shorts/i.test(hayN)) score -= 25;
  if (/млн|million|\b\d+(\.\d+)?\s*m\b/i.test(c.viewsHint)) score += 2;
  return score;
}

function isRealWatchUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      (u.hostname.includes("youtube.com") || u.hostname.includes("youtu.be")) &&
      (u.pathname.includes("/watch") || u.hostname.includes("youtu.be"))
    );
  } catch {
    return false;
  }
}

function isAdLanding(url: string): boolean {
  const u = url.toLowerCase();
  return (
    u.includes("coursera.org") ||
    u.includes("udemy.com") ||
    u.includes("skillbox") ||
    u.includes("geekbrains") ||
    u.includes("doubleclick") ||
    u.includes("googleadservices") ||
    u.includes("/pagead/") ||
    (u.includes("youtube.com") && u.includes("/premium"))
  );
}

/** Scroll the chosen card into view and click — proves we scrolled, not teleported to #1. */
async function clickVideoInFeed(session: CdpSession, href: string): Promise<boolean> {
  const ok = await session.evaluate<boolean>(`
(() => {
  const want = ${JSON.stringify(href)};
  const wantId = (() => {
    try { return new URL(want).searchParams.get('v') || ''; } catch { return ''; }
  })();
  const nodes = Array.from(
    document.querySelectorAll('ytd-video-renderer, ytd-rich-item-renderer, ytd-compact-video-renderer')
  );
  for (const el of nodes) {
    const a =
      el.querySelector('a#video-title') ||
      el.querySelector('a#video-title-link') ||
      el.querySelector('a.yt-simple-endpoint[href*="/watch"]');
    if (!a) continue;
    const href = a.href || '';
    const id = (() => { try { return new URL(href).searchParams.get('v') || ''; } catch { return ''; } })();
    if (href.startsWith(want) || (wantId && id === wantId)) {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      a.click();
      return true;
    }
  }
  return false;
})()
`);
  await sleep(2200);
  return ok;
}

/**
 * Search YouTube and open a video.
 * quick (default): first matching organic result — no pointless scrolling.
 * deep: longer lesson search when user asked for урок/курс/tutorial.
 */
export async function youtubeOpenLessonMission(opts: {
  query: string;
  browser?: PreferredBrowser;
  minMinutes?: number;
  /** How many top organic results to refuse (deep mode only; default 0). */
  skipTop?: number;
  /** quick = first good hit; deep = lesson hunt. Auto from query if omitted. */
  mode?: "quick" | "deep";
  /** Original user text for mode detection */
  rawUserText?: string;
}): Promise<string> {
  resetBrowserMissionCancel();
  const rawQuery = opts.query.trim();
  if (!rawQuery) return "ERROR: empty query";
  const query = correctYoutubeQuery(rawQuery);
  const mustTopics = extractMustTopics(query);
  const browser = opts.browser ?? "yandex";
  const mode = opts.mode ?? detectYoutubeOpenMode(query, opts.rawUserText);
  // Never skip the top hit unless caller explicitly asks (deep lesson dig).
  const skipTop = mode === "quick" ? 0 : Math.max(0, opts.skipTop ?? 0);
  const minSec =
    opts.minMinutes != null
      ? Math.max(0, opts.minMinutes * 60)
      : mode === "deep"
        ? Math.max(0, (mustTopics.length ? 5 : 8) * 60)
        : 0;
  const lines: string[] = [`mode=${mode}`];

  const searchUrl =
    `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}` +
    `&sp=EgIQAQ%253D%253D`;

  saveMissionState({
    missionId: "youtube-open",
    kind: "youtube.open.lesson",
    step: 0,
    steps: ["search", "scroll", "collect", "pick", "verify"],
    lastUrl: searchUrl,
    updatedAt: new Date().toISOString(),
  });

  const first = await browserNavigateVerified(searchUrl, browser, {
    expectIncludes: "youtube.com",
    settleMs: 2400,
  });
  if (first.blocker === "captcha") {
    return `STOP: CAPTCHA на YouTube. Нужен человек.\n${first.url}`;
  }
  lines.push(`Search: ${query}` + (query !== rawQuery ? ` (из «${rawQuery}»)` : ""));
  if (mustTopics.length) lines.push(`Must match in TITLE: ${mustTopics.join(", ")}`);
  lines.push(`Results: ${first.url}`);

  return withCdpPage(browser, async (session) => {
    await dismissPopups(session);
    await sleep(700);

    const collectOpts =
      mode === "quick"
        ? { minScrolls: 0, minCandidates: 1, maxScrolls: 0 }
        : { minScrolls: 2, minCandidates: 8, maxScrolls: 6 };

    let candidates = await scrollAndCollect(session, collectOpts, lines);

    if (candidates.length < 3 && mode === "deep") {
      await session.navigate(
        `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
        2200,
      );
      candidates = await scrollAndCollect(
        session,
        { minScrolls: 4, minCandidates: 10, maxScrolls: 10 },
        lines,
      );
    }

    if (!candidates.length) {
      return ["ERROR: не нашёл видео в выдаче.", ...lines].join("\n");
    }
    candidates = candidates.map((c, i) => ({ ...c, index: i }));

    let topicHits = mustTopics.length
      ? candidates.filter((c) => titleMatchesAllMust(c.title, mustTopics))
      : [];

    if (mustTopics.length && topicHits.length === 0 && mode === "deep") {
      lines.push("Тема не в названиях — повторный поиск с акцентом на тему");
      const alt = `${mustTopics.join(" ")} ${tokenize(query)
        .filter((t) => !mustTopics.includes(t) && !STOP.has(t))
        .slice(0, 5)
        .join(" ")}`.trim();
      await session.navigate(
        `https://www.youtube.com/results?search_query=${encodeURIComponent(alt)}&sp=EgIQAQ%253D%253D`,
        2200,
      );
      candidates = await scrollAndCollect(
        session,
        { minScrolls: 4, minCandidates: 10, maxScrolls: 10 },
        lines,
      );
      candidates = candidates.map((c, i) => ({ ...c, index: i }));
      topicHits = candidates.filter((c) => titleMatchesAllMust(c.title, mustTopics));
    }

    if (mustTopics.length && topicHits.length === 0) {
      return [
        `ERROR: нет ролика с «${mustTopics.join(", ")}» в названии. Не открываю чужой выпуск (Орландо ≠ Вашингтон).`,
        ...lines,
      ].join("\n");
    }

    const base = topicHits.length ? topicHits : candidates;
    const eligible = base.filter((c) => {
      if (mode === "deep" && !mustTopics.length && c.index < skipTop) return false;
      const sec = durationSeconds(c.duration);
      if (minSec > 0 && sec > 0 && sec < minSec) return false;
      return true;
    });
    const usePool = eligible.length ? eligible : base;

    const ranked = [...usePool]
      .map((c) => ({ c, score: scoreCandidate(c, query, skipTop, mustTopics, mode) }))
      .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.c.index - b.c.index));

    // quick: hard-prefer first organic on the screen — stop "digging" past duplicates
    if (mode === "quick" && usePool.length) {
      const tokens = tokenize(query).filter((t) => !STOP.has(t));
      const firstMatch =
        usePool.find((c) => {
          const hay = normalizeText(`${c.title} ${c.channel}`);
          if (!tokens.length) return true;
          return tokens.some((t) => hay.includes(t) || hayHasTopic(c.title, t));
        }) ?? usePool[0]!;
      const rest = ranked.filter((r) => r.c.href !== firstMatch.href);
      ranked.length = 0;
      ranked.push(
        { c: firstMatch, score: scoreCandidate(firstMatch, query, 0, mustTopics, mode) + 100 },
        ...rest,
      );
      lines.push(`quick-pick: #${firstMatch.index} «${firstMatch.title.slice(0, 60)}»`);
    }

    lines.push(`topic-hits=${topicHits.length}; pool=${usePool.length}`);
    for (const { c, score } of ranked.slice(0, 8)) {
      lines.push(
        `  [#${c.index} ${score}] ${c.duration || "?:??"} | ${c.title.slice(0, 70)}`,
      );
    }

    const tryOpen = async (
      pick: YtCandidate,
    ): Promise<{ ok: boolean; page: Awaited<ReturnType<typeof readPageState>> }> => {
      const clicked = await clickVideoInFeed(session, pick.href);
      if (!clicked) {
        await session.navigate(pick.href, 2200);
        await dismissPopups(session);
      }
      let page = await readPageState(session);
      if (!isRealWatchUrl(page.url) || isAdLanding(page.url)) {
        await session.navigate(pick.href, 2200);
        await dismissPopups(session);
        page = await readPageState(session);
      }
      const titleOk =
        !mustTopics.length ||
        titleMatchesAllMust(page.title, mustTopics) ||
        titleMatchesAllMust(pick.title, mustTopics);
      const ok =
        isRealWatchUrl(page.url) &&
        !isAdLanding(page.url) &&
        page.blocker !== "captcha" &&
        titleOk;
      return { ok, page };
    };

    const tryList = ranked.slice(0, mode === "quick" ? 1 : 5);
    for (const { c } of tryList) {
      if (mustTopics.length && !titleMatchesAllMust(c.title, mustTopics)) continue;
      lines.push(`Trying #${c.index}: ${c.title.slice(0, 80)}`);
      const { ok, page } = await tryOpen(c);
      if (page.blocker === "captcha") {
        return `STOP: CAPTCHA.\n${page.url}\n` + lines.join("\n");
      }
      if (!ok) {
        lines.push(`  reject: title/url mismatch → ${page.title.slice(0, 60)} | ${page.url}`);
        if (mode === "quick") continue;
        await session.navigate(searchUrl, 1600);
        await scrollAndCollect(session, { minScrolls: 1, minCandidates: 4, maxScrolls: 3 }, lines);
        continue;
      }
      saveMissionState({
        missionId: "youtube-open",
        kind: "youtube.open.lesson",
        step: 5,
        steps: ["search", "scroll", "collect", "pick", "verify"],
        lastUrl: page.url,
        updatedAt: new Date().toISOString(),
      });
      return [
        mode === "quick"
          ? `DONE: открыл первое подходящее видео (#${c.index}).`
          : mustTopics.length
            ? `DONE: открыл выпуск по теме «${mustTopics.join(", ")}».`
            : "DONE: открыл подходящее видео.",
        `Title: ${page.title}`,
        `URL: ${page.url}`,
        `Picked: ${c.title}`,
        c.duration ? `Duration: ${c.duration}` : "",
        "",
        "--- log ---",
        ...lines,
      ]
        .filter(Boolean)
        .join("\n");
    }

    return [
      mustTopics.length
        ? `ERROR: не смог открыть выпуск именно про «${mustTopics.join(", ")}».`
        : "ERROR: не удалось открыть подходящее видео.",
      ...lines,
    ].join("\n");
  });
}

/** True when the ask is clearly NOT YouTube (Docs, sites, apps, essays…). */
export function isNonYoutubeOpenTask(text: string): boolean {
  const lower = text.toLowerCase().replace(/ё/g, "е");
  return (
    /(google\s*docs?|google\s*documents?|docs\.google|документ\w*|реферат|презентац|таблиц|sheet|slides|notion|figma|canva)/i.test(
      lower,
    ) ||
    /(сайт|страниц|википед|wikipedia|gmail|почт|настройк|блокнот|notepad|vs\s*code|visual\s*studio)/i.test(
      lower,
    ) ||
    /(напиши|написать|сочини).{0,40}(реферат|текст|стать|эссе|доклад)/i.test(lower)
  );
}

/** Extract topic from natural language like «открой урок по python» / «открой мне дым…». */
export function extractYoutubeLessonQuery(text: string): string | null {
  const t = text.trim();
  const lower = t.toLowerCase().replace(/ё/g, "е");
  if (isNonYoutubeOpenTask(t)) return null;

  const mentionsYoutube = /ютуб|youtube|youtu\.be/i.test(lower);
  const mentionsMedia =
    /видос|видео|ролик|урок|tutorial|выпуск|серия|орел|орёл|решка|посмотр|клип|трек|песн|музык|дым|сигарет/i.test(
      lower,
    );
  // Bare «открой мне X» is YouTube ONLY if media/topic looks like watchable content —
  // never Docs / sites / essays (those go to browser LLM-loop).
  const openMediaShortcut =
    /^(открой|открыть|покажи|включи|найди|поищи)(\s|$)/i.test(lower) &&
    mentionsMedia &&
    !/(телеграм|telegram|блокнот|notepad|файл|папк|настройк|почт|gmail)/i.test(lower);

  if (
    !mentionsYoutube &&
    !mentionsMedia &&
    !openMediaShortcut &&
    !/(открой|найди|включи|покажи).{0,40}(python|пайтон|джава|react).{0,20}(урок|видео|tutorial|курс)/i.test(
      lower,
    )
  ) {
    return null;
  }
  const wantsOpen =
    /(открой|найди|включи|покажи|поиск|поищи|запусти|play|open|find|search|watch)/i.test(lower) ||
    /(урок|видео|ролик|выпуск|tutorial|lesson).{0,40}(по|про|about|on)/i.test(lower);
  if (!wantsOpen && !mentionsYoutube) return null;

  const patterns: RegExp[] = [
    /((?:выпуск|серия|урок|видео|ролик|tutorial|lesson).{0,40}(?:по|про|about|on)\s+.+?)(?:\s+на\s+(?:ютуб|youtube).*)?$/i,
    /((?:орел|орёл)\s*и\s*решк\w*.+)$/i,
    /(?:на\s+)?(?:ютуб[еа]?|youtube)\s+(?:урок|видео|ролик|выпуск)?\s*(?:по|про|about)?\s*(.+)$/i,
    /(?:открой|найди|включи|покажи|поищи)\s+(?:мне\s+)?(?:на\s+)?(?:ютуб[еа]?|youtube)\s+(.+)$/i,
    /(?:открой|найди|включи|покажи)\s+(?:мне\s+)?(.+?)(?:\s+на\s+(?:ютуб|youtube))/i,
  ];
  // Only allow catch-all «открой мне X» when media is already implied
  if (mentionsMedia || mentionsYoutube) {
    patterns.push(/(?:открой|открыть|покажи|включи|найди|поищи)\s+(?:мне\s+)?(.+)$/i);
  }
  for (const re of patterns) {
    const m = t.match(re);
    if (m?.[1]) {
      const q = m[1]
        .replace(/^(открой|найди|включи|покажи|поищи|мне)\s+/i, "")
        .replace(/\s+на\s+(ютуб[еа]?|youtube)\s*$/i, "")
        .replace(/[?!.,]+$/g, "")
        .trim();
      if (q.length >= 2 && q.length < 140) return correctYoutubeQuery(q);
    }
  }

  const q = t
    .replace(/^(пожалуйста|pls|please)[,!\s]*/i, "")
    .replace(
      /\b(открой|найди|включи|покажи|поищи|мне|на|в|ютуб[еа]?|youtube)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  if (q.length >= 2 && q.length < 100 && (mentionsMedia || mentionsYoutube)) {
    return correctYoutubeQuery(q);
  }
  return null;
}
