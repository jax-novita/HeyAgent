/**
 * Hard reliability missions for browser agent:
 * - Wikipedia first-link hops (context + state)
 * - Reddit infinite scroll find
 * - Multi-tab compare
 * - CAPTCHA honesty stop
 */
import type { PreferredBrowser } from "./browser-nav.js";
import {
  browserEval,
  browserGetState,
  browserListTabs,
  browserNavigateVerified,
  browserOpenTab,
  dismissPopups,
  ensureBrowser,
  isBrowserMissionCancelled,
  loadMissionState,
  recoverBrowser,
  requestBrowserMissionCancel,
  resetBrowserMissionCancel,
  saveMissionState,
  withCdpPage,
  CdpSession,
  readPageState,
} from "./browser-agent.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function withPage<T>(
  preferred: PreferredBrowser,
  fn: (session: CdpSession) => Promise<T>,
): Promise<T> {
  return withCdpPage(preferred, fn);
}

/** Click the first "real" content link in the Wikipedia article body. */
async function wikipediaClickFirstLink(session: CdpSession): Promise<string> {
  const href = await session.evaluate<string>(`
(() => {
  const content = document.querySelector('#mw-content-text .mw-parser-output');
  if (!content) return '';
  const links = Array.from(content.querySelectorAll('p a[href^="/wiki/"]'));
  for (const a of links) {
    const href = a.getAttribute('href') || '';
    const text = (a.textContent || '').trim();
    if (!href || !text) continue;
    if (href.includes(':')) continue; // File:, Help:, etc
    if (a.closest('.hatnote, .ambox, table, .infobox, .navbox, .thumb')) continue;
    // Prefer first link inside the first non-empty paragraph
    a.click();
    return href;
  }
  return '';
})()
`);
  await sleep(1500);
  await dismissPopups(session);
  return href;
}

/**
 * Open Wikipedia and follow the first link N times. Report final location.
 * Caps at 100; for huge N still runs but reports progress.
 */
export async function wikipediaHopMission(opts: {
  hops?: number;
  start?: string;
  browser?: PreferredBrowser;
}): Promise<string> {
  resetBrowserMissionCancel();
  const hops = Math.max(1, Math.min(opts.hops ?? 100, 100));
  const start = opts.start ?? "https://en.wikipedia.org/wiki/Special:Random";
  const browser = opts.browser ?? "auto";
  const trail: string[] = [];

  const first = await browserNavigateVerified(start, browser, {
    expectIncludes: "wikipedia.org",
  });
  if (first.blocker === "captcha") {
    return `STOP: CAPTCHA на старте Wikipedia. Не могу продолжить без человека.\n${first.url}`;
  }
  trail.push(`${first.title} — ${first.url}`);

  await withPage(browser, async (session) => {
    for (let i = 1; i <= hops; i++) {
      if (isBrowserMissionCancelled()) {
        trail.push(`CANCELLED at hop ${i}`);
        break;
      }
      const href = await wikipediaClickFirstLink(session);
      if (!href) {
        trail.push(`STOP at hop ${i}: no first-link found`);
        break;
      }
      await sleep(400);
      const page = await readPageState(session);
      if (page.blocker === "captcha") {
        trail.push(`STOP CAPTCHA at hop ${i}: ${page.url}`);
        break;
      }
      trail.push(`${i}. ${page.title} — ${page.url}`);
      saveMissionState({
        missionId: "wikipedia-hops",
        kind: "wikipedia-hops",
        step: i,
        steps: [`hop-${hops}`],
        lastUrl: page.url,
        updatedAt: new Date().toISOString(),
      });
      if (i % 10 === 0) {
        // light progress checkpoint
      }
    }
  });

  const final = await browserGetState(browser);
  return [
    `Wikipedia hops mission (${hops} max):`,
    `Start: ${start}`,
    `Hops done: ${Math.max(0, trail.length - 1)}`,
    `Final: ${final.title || "(unknown)"}`,
    `URL: ${final.url || "(unknown)"}`,
    "",
    "Trail (last 12):",
    ...trail.slice(-12),
    final.blocker === "captcha" ? "Не могу продолжить — CAPTCHA." : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Reddit: scroll until finding a post about OpenAI with high score (best-effort via DOM).
 */
export async function redditOpenAiScrollMission(opts: {
  minScore?: number;
  maxScrolls?: number;
  browser?: PreferredBrowser;
}): Promise<string> {
  resetBrowserMissionCancel();
  const minScore = opts.minScore ?? 1000;
  const maxScrolls = Math.max(5, Math.min(opts.maxScrolls ?? 40, 80));
  const browser = opts.browser ?? "auto";

  const start = await browserNavigateVerified("https://www.reddit.com/r/all/", browser, {
    expectIncludes: "reddit.com",
    settleMs: 2200,
  });
  if (start.blocker === "captcha") {
    return `STOP: CAPTCHA/Cloudflare на Reddit. Не могу продолжить — нужен человек.\n${start.url}`;
  }

  let foundTitle = "";
  let foundScore = 0;
  let foundUrl = "";
  let captchaHit = false;

  await withPage(browser, async (session) => {
    for (let i = 0; i < maxScrolls; i++) {
      if (isBrowserMissionCancelled()) break;
      const page = await readPageState(session);
      if (page.blocker === "captcha") {
        captchaHit = true;
        saveMissionState({
          missionId: "reddit-scroll",
          kind: "reddit-scroll",
          step: i,
          steps: ["captcha"],
          lastUrl: page.url,
          updatedAt: new Date().toISOString(),
        });
        break;
      }

      const hit = await session.evaluate<{
        title: string;
        score: number;
        url: string;
      } | null>(`
(() => {
  const min = ${minScore};
  const posts = Array.from(document.querySelectorAll('shreddit-post, div[data-testid="post-container"], article'));
  for (const p of posts) {
    const titleEl = p.querySelector('a[slot="title"], a[data-click-id="body"], h3, [slot="title"]');
    const title = (titleEl && (titleEl.textContent || '')) || p.getAttribute('post-title') || '';
    if (!/openai/i.test(title)) continue;
    let score = Number(p.getAttribute('score') || p.getAttribute('comment-count') || 0);
    const scoreText = (p.querySelector('[id*="vote-count"], faceplate-number, [score]') || {}).textContent || '';
    const m = String(scoreText).match(/([\\d.]+)\\s*([kKmM])?/);
    if (m) {
      let n = parseFloat(m[1]);
      if ((m[2] || '').toLowerCase() === 'k') n *= 1000;
      if ((m[2] || '').toLowerCase() === 'm') n *= 1000000;
      score = Math.max(score, Math.round(n));
    }
    if (score >= min) {
      const href = (titleEl && titleEl.getAttribute && titleEl.getAttribute('href')) || p.getAttribute('permalink') || location.href;
      return { title: title.trim(), score, url: href.startsWith('http') ? href : ('https://www.reddit.com' + href) };
    }
  }
  return null;
})()
`);
      if (hit) {
        foundTitle = hit.title;
        foundScore = hit.score;
        foundUrl = hit.url;
        break;
      }
      await session.evaluate(`window.scrollBy(0, Math.max(800, window.innerHeight))`);
      await sleep(900);
    }
  });

  if (captchaHit || !foundUrl) {
    const st = await browserGetState(browser);
    if (captchaHit || st.blocker === "captcha") {
      return "STOP: CAPTCHA на Reddit. Не кликаю бесконечно. Нужен человек.";
    }
    return `Не нашёл пост про OpenAI с >${minScore} апвоутами за ${maxScrolls} прокруток. Честно: не нашёл.`;
  }

  await browserNavigateVerified(foundUrl, browser);
  return [
    "Reddit scroll mission DONE:",
    `Title: ${foundTitle}`,
    `Score ≥ ${minScore} (parsed ~${foundScore})`,
    `URL: ${foundUrl}`,
  ].join("\n");
}

/**
 * Open GitHub + Reddit + HN in separate tabs and compare mentions of a project.
 */
export async function multiTabCompareMission(opts: {
  query?: string;
  browser?: PreferredBrowser;
}): Promise<string> {
  resetBrowserMissionCancel();
  const q = (opts.query ?? "TypeScript").trim();
  const browser = opts.browser ?? "auto";
  const gh = `https://github.com/search?q=${encodeURIComponent(q)}&type=repositories`;
  const rd = `https://www.reddit.com/search/?q=${encodeURIComponent(q)}`;
  const hn = `https://hn.algolia.com/?q=${encodeURIComponent(q)}`;

  await ensureBrowser(gh, browser);
  await browserNavigateVerified(gh, browser, { expectIncludes: "github.com" });
  const ghState = await browserGetState(browser);
  if (ghState.blocker === "captcha") {
    return "STOP: CAPTCHA на GitHub search. Не могу продолжить.";
  }

  await browserOpenTab(rd, browser);
  await sleep(1500);
  await browserOpenTab(hn, browser);
  await sleep(1500);

  const tabs = await browserListTabs();

  // Pull short snippets via eval on current tab, then navigate between by opening known URLs verified
  const snippets: string[] = [];
  for (const [name, url] of [
    ["GitHub", gh],
    ["Reddit", rd],
    ["Hacker News", hn],
  ] as const) {
    if (isBrowserMissionCancelled()) break;
    const page = await browserNavigateVerified(url, browser);
    if (page.blocker === "captcha") {
      snippets.push(`${name}: CAPTCHA — skip`);
      continue;
    }
    const text = await browserEval(
      `(document.body && document.body.innerText || '').replace(/\\s+/g,' ').slice(0, 500)`,
      browser,
    );
    snippets.push(`${name} (${page.url}): ${text.slice(0, 280)}`);
  }

  return [
    `Multi-tab compare for «${q}»:`,
    "Tabs:",
    tabs,
    "",
    "Snippets:",
    ...snippets.map((s, i) => `${i + 1}. ${s}`),
    "",
    "Сравнение: смотри активность/тон обсуждения по сниппетам выше. Вкладки открыты отдельно (не спам шагов внутри одной задачи).",
  ].join("\n");
}

export async function browserHardStop(): Promise<string> {
  requestBrowserMissionCancel();
  const st = loadMissionState();
  return `Остановил браузерную миссию. Последний шаг: ${st?.step ?? "—"}; URL: ${st?.lastUrl ?? "—"}`;
}

export async function browserHardRecover(preferred: PreferredBrowser = "auto"): Promise<string> {
  return recoverBrowser(preferred);
}

export async function browserWhatIsSelected(preferred: PreferredBrowser = "auto"): Promise<string> {
  try {
    await ensureBrowser("about:blank", preferred);
    const info = await browserEval(
      `(() => {
        const el = document.activeElement;
        if (!el || el === document.body || el === document.documentElement) {
          return JSON.stringify({ selected: false, reason: 'no meaningful activeElement' });
        }
        return JSON.stringify({
          selected: true,
          tag: el.tagName,
          id: el.id || null,
          name: el.getAttribute('name'),
          text: (el.innerText || el.value || '').toString().slice(0, 120)
        });
      })()`,
      preferred,
    );
    const parsed = JSON.parse(info) as { selected: boolean; reason?: string; tag?: string; text?: string };
    if (!parsed.selected) {
      return "Не могу определить выделенный элемент — сейчас нет осмысленного фокуса на странице. Не выдумываю.";
    }
    return `Сейчас в фокусе: <${parsed.tag}> ${parsed.text || "(без текста)"}`;
  } catch {
    return "Не могу определить выделенный элемент — нет доступа к странице. Не выдумываю.";
  }
}

export async function browserDismissPopupsMission(
  preferred: PreferredBrowser = "auto",
): Promise<string> {
  await ensureBrowser("about:blank", preferred);
  return withPage(preferred, async (session) => {
    const before = await readPageState(session);
    const result = await dismissPopups(session);
    const after = await readPageState(session);
    return [
      `Popup handling: ${result}`,
      `Before: ${before.url}`,
      `After: ${after.url}`,
      after.blocker === "captcha" ? "Обнаружена CAPTCHA — останавливаюсь, нужен человек." : "OK",
    ].join("\n");
  });
}
