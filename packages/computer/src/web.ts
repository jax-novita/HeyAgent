/** Web search, fetch/parse, weather — OpenClaw-style tools (wttr.in + DDG). */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export async function webSearch(query: string, limit = 5): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];

  // 1) DuckDuckGo Instant Answer API (free, no key)
  try {
    const ddg = await duckDuckGoInstant(q);
    if (ddg.length) return ddg.slice(0, limit);
  } catch {
    /* fall through */
  }

  // 2) DuckDuckGo HTML lite scrape
  try {
    const html = await duckDuckGoHtml(q);
    if (html.length) return html.slice(0, limit);
  } catch {
    /* fall through */
  }

  // 3) Last resort: return search URL for browser.open
  return [
    {
      title: `Search: ${q}`,
      url: `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
      snippet: "Open this URL in the browser for full results.",
    },
  ];
}

async function duckDuckGoInstant(query: string): Promise<SearchResult[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const res = await fetch(url, {
    headers: { "User-Agent": "HeyAgent/0.1 (local-agent)" },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    AbstractText?: string;
    AbstractURL?: string;
    Heading?: string;
    RelatedTopics?: { Text?: string; FirstURL?: string; Topics?: { Text?: string; FirstURL?: string }[] }[];
    Results?: { Text?: string; FirstURL?: string }[];
  };

  const out: SearchResult[] = [];
  if (data.AbstractText && data.AbstractURL) {
    out.push({
      title: data.Heading || query,
      url: data.AbstractURL,
      snippet: data.AbstractText,
    });
  }
  for (const r of data.Results ?? []) {
    if (r.Text && r.FirstURL) {
      out.push({ title: r.Text.slice(0, 80), url: r.FirstURL, snippet: r.Text });
    }
  }
  for (const t of data.RelatedTopics ?? []) {
    if (t.Text && t.FirstURL) {
      out.push({ title: t.Text.slice(0, 80), url: t.FirstURL, snippet: t.Text });
    }
    for (const sub of t.Topics ?? []) {
      if (sub.Text && sub.FirstURL) {
        out.push({ title: sub.Text.slice(0, 80), url: sub.FirstURL, snippet: sub.Text });
      }
    }
  }
  return out;
}

async function duckDuckGoHtml(query: string): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });
  if (!res.ok) return [];
  const html = await res.text();
  const results: SearchResult[] = [];
  const re =
    /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && results.length < 8) {
    const href = decodeDuckRedirect(m[1]);
    const title = stripTags(m[2]).trim();
    const snippet = stripTags(m[3]).trim();
    if (href && title) results.push({ title, url: href, snippet });
  }
  return results;
}

function decodeDuckRedirect(href: string): string {
  try {
    if (href.includes("uddg=")) {
      const u = new URL(href, "https://duckduckgo.com");
      return decodeURIComponent(u.searchParams.get("uddg") || href);
    }
  } catch {
    /* ignore */
  }
  return href.startsWith("//") ? `https:${href}` : href;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export async function webFetch(url: string, maxChars = 12000): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "HeyAgent/0.1 (local-agent)",
      Accept: "text/html,application/json,text/plain,*/*",
    },
    redirect: "follow",
  });
  if (!res.ok) return `Fetch failed: HTTP ${res.status}`;
  const ct = res.headers.get("content-type") || "";
  const text = await res.text();
  if (ct.includes("application/json")) {
    return text.slice(0, maxChars);
  }
  return htmlToText(text).slice(0, maxChars);
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** OpenClaw weather skill pattern: wttr.in JSON */
export async function getWeather(location: string): Promise<string> {
  const loc = location.trim() || "Moscow";
  const encoded = encodeURIComponent(loc.replace(/\s+/g, "+"));
  const url = `https://wttr.in/${encoded}?format=j2`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "HeyAgent/0.1",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    // short format fallback
    const short = await fetch(`https://wttr.in/${encoded}?format=3`, {
      headers: { "User-Agent": "HeyAgent/0.1" },
    });
    if (!short.ok) return `Weather fetch failed for ${loc}`;
    return (await short.text()).trim();
  }
  const data = (await res.json()) as {
    nearest_area?: { areaName?: { value: string }[]; country?: { value: string }[] }[];
    current_condition?: {
      temp_C?: string;
      FeelsLikeC?: string;
      humidity?: string;
      weatherDesc?: { value: string }[];
      windspeedKmph?: string;
      precipMM?: string;
    }[];
    weather?: { date: string; maxtempC: string; mintempC: string }[];
  };
  const area = data.nearest_area?.[0];
  const cur = data.current_condition?.[0];
  const name = area?.areaName?.[0]?.value ?? loc;
  const country = area?.country?.[0]?.value ?? "";
  const desc = cur?.weatherDesc?.[0]?.value ?? "";
  const lines = [
    `Weather for ${name}${country ? `, ${country}` : ""}:`,
    `${desc}, ${cur?.temp_C ?? "?"}°C (feels like ${cur?.FeelsLikeC ?? "?"}°C)`,
    `Humidity: ${cur?.humidity ?? "?"}% | Wind: ${cur?.windspeedKmph ?? "?"} km/h | Precip: ${cur?.precipMM ?? "?"} mm`,
  ];
  const forecast = (data.weather ?? []).slice(0, 3);
  if (forecast.length) {
    lines.push("Forecast:");
    for (const d of forecast) {
      lines.push(`  ${d.date}: ${d.mintempC}–${d.maxtempC}°C`);
    }
  }
  return lines.join("\n");
}

export function formatSearchResults(results: SearchResult[]): string {
  if (!results.length) return "No results.";
  return results
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
    .join("\n\n");
}

/** Deep page analysis: title, meta, headings, links, text preview. */
export async function webAnalyze(url: string, maxChars = 16000): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; HeyAgent/0.1; +https://github.com/local/heyagent)",
      Accept: "text/html,application/xhtml+xml,application/json,*/*",
    },
    redirect: "follow",
  });
  if (!res.ok) return `Analyze failed: HTTP ${res.status} for ${url}`;
  const finalUrl = res.url;
  const ct = res.headers.get("content-type") || "";
  const html = await res.text();

  if (ct.includes("application/json")) {
    return [`URL: ${finalUrl}`, "Type: JSON", html.slice(0, maxChars)].join("\n");
  }

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
  const desc =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)?.[1] ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)?.[1] ??
    "";
  const ogTitle =
    html.match(/property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1] ?? "";
  const headings = [...html.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi)]
    .slice(0, 20)
    .map((m) => `H${m[1]}: ${stripTags(m[2]).slice(0, 120)}`);

  const links: string[] = [];
  const re = /<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && links.length < 40) {
    let href = m[1];
    try {
      href = new URL(href, finalUrl).href;
    } catch {
      continue;
    }
    const label = stripTags(m[2]).slice(0, 80);
    links.push(`- ${label || href}\n  ${href}`);
  }

  const text = htmlToText(html).slice(0, maxChars);
  return [
    `URL: ${finalUrl}`,
    `Title: ${title || ogTitle || "(none)"}`,
    `Description: ${desc || "(none)"}`,
    `Content-Type: ${ct}`,
    `Size: ${html.length} chars HTML`,
    "",
    "Headings:",
    headings.length ? headings.join("\n") : "(none)",
    "",
    "Links (sample):",
    links.length ? links.join("\n") : "(none)",
    "",
    "Text preview:",
    text,
  ].join("\n");
}

/** Extract links from a page. */
export async function webLinks(url: string, limit = 50): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "HeyAgent/0.1" },
    redirect: "follow",
  });
  if (!res.ok) return `Failed: HTTP ${res.status}`;
  const html = await res.text();
  const base = res.url;
  const out: string[] = [];
  const re = /href=["']([^"'#]+)["']/gi;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = re.exec(html)) && out.length < limit) {
    try {
      const href = new URL(m[1], base).href;
      if (seen.has(href)) continue;
      seen.add(href);
      out.push(href);
    } catch {
      /* skip */
    }
  }
  return out.join("\n") || "No links found";
}
