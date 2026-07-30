/**
 * Deterministic research digest → PDF (news / report).
 */
import { chatCompletion, type ModelRef } from "@heyagent/models";
import {
  webSearch,
  webFetch,
  formatSearchResults,
  writeReportPdf,
  openPath,
  type ReportSection,
} from "@heyagent/computer";

/** Strip verbs so search focuses on the subject (e.g. Азербайджан). */
export function extractDigestTopic(raw: string): string {
  // JS \\w is ASCII-only — use explicit Cyrillic classes for RU morphology.
  const w = "[a-zа-яё]";
  let t = raw.trim().replace(/\s+/g, " ");
  t = t
    .replace(
      /^(пожалуйста[,!]?\s*)?(собери|найди|сделай|напиши|покажи|дай)\s+(мне\s+)?(например\s+)?/i,
      "",
    )
    .replace(new RegExp(`^(последн${w}*|свеж${w}*|latest|today'?s?|сегодняшн${w}*)\\s+`, "i"), "")
    .replace(new RegExp(`^(новост${w}*|news|дайджест|digest)(\\s+|$)`, "i"), "")
    .replace(/^(по|про|about|on)\s+/i, "")
    .replace(new RegExp(`\\s+(и\\s+)?(сделай|создай|в)\\s+(pdf|отч[её]т${w}*|report)\\b`, "gi"), " ")
    .replace(new RegExp(`\\b(pdf|отч[её]т${w}*|report|дайджест|digest)\\b`, "gi"), " ")
    .replace(/\s+/g, " ")
    .trim();
  t = t
    .replace(new RegExp(`^(последн${w}*|свеж${w}*|новост${w}*|news)\\s+`, "i"), "")
    .trim();
  if (t.length < 2) t = raw.trim().slice(0, 120);
  return t.slice(0, 120);
}

export async function runResearchDigest(opts: {
  topic: string;
  modelRef: ModelRef;
  onStatus?: (s: "working" | "thinking" | "done" | "idle", d?: string) => void;
}): Promise<{ summary: string; path: string }> {
  const topic = extractDigestTopic(opts.topic) || "world news";
  opts.onStatus?.("working", "research.digest.search");
  const queries = [
    `${topic} новости`,
    `${topic} latest news`,
    `${topic} сегодня`,
  ].slice(0, 3);

  const hits: { title: string; url: string; snippet: string }[] = [];
  for (const q of queries) {
    try {
      const r = await webSearch(q, 6);
      for (const h of r) {
        if (!hits.some((x) => x.url === h.url)) {
          hits.push({ title: h.title, url: h.url, snippet: h.snippet || "" });
        }
      }
    } catch {
      /* continue */
    }
  }

  // Deepen top sources so the PDF is a real digest, not title scrapings.
  opts.onStatus?.("working", "research.digest.fetch");
  const enriched: typeof hits = [];
  for (const h of hits.slice(0, 5)) {
    if (!/^https?:\/\//i.test(h.url) || /duckduckgo\.com\/\?q=/i.test(h.url)) {
      enriched.push(h);
      continue;
    }
    try {
      const page = await webFetch(h.url, 4000);
      const body = page.replace(/\s+/g, " ").trim().slice(0, 1800);
      enriched.push({
        title: h.title,
        url: h.url,
        snippet: body.length > 120 ? body : h.snippet || h.title,
      });
    } catch {
      enriched.push(h);
    }
  }
  const sources = enriched.length ? enriched : hits;

  opts.onStatus?.("working", "research.digest.compose");
  let sections: ReportSection[] = sources.slice(0, 8).map((h, i) => ({
    heading: h.title || `Источник ${i + 1}`,
    body: h.snippet || h.title,
    source: h.url,
  }));

  if (sources.length) {
    try {
      const res = await chatCompletion(
        opts.modelRef,
        [
          {
            role: "system",
            content: [
              "You write a concise news/research digest in Russian.",
              "Reply STRICT JSON: {\"title\":\"...\",\"sections\":[{\"heading\":\"...\",\"body\":\"3-6 sentences with facts\",\"source\":\"url\"}]}",
              "Use only the provided sources. Expand each item into a clear news brief — not one-line titles.",
              "5-8 sections. No fluff, no meta commentary.",
            ].join("\n"),
          },
          {
            role: "user",
            content: `Topic: ${topic}\n\nSources:\n${formatSearchResults(sources.slice(0, 10))}`,
          },
        ],
        { maxTokens: 2800, toolChoice: "none", useDefaultFallbacks: true },
      );
      const m = (res.content || "").match(/\{[\s\S]*\}/);
      if (m) {
        const parsed = JSON.parse(m[0]) as {
          title?: string;
          sections?: { heading?: string; body?: string; source?: string }[];
        };
        if (Array.isArray(parsed.sections) && parsed.sections.length) {
          sections = parsed.sections.map((s) => ({
            heading: String(s.heading || "Новость").slice(0, 160),
            body: String(s.body || "").slice(0, 2000),
            source: s.source ? String(s.source).slice(0, 400) : undefined,
          }));
        }
      }
    } catch {
      /* keep heuristic sections from search/fetch */
    }
  }

  if (!sections.length) {
    sections = [
      {
        heading: "Нет результатов поиска",
        body: `Не удалось найти источники по теме «${topic}». Проверьте сеть / повторите запрос.`,
      },
    ];
  }

  opts.onStatus?.("working", "research.digest.pdf");
  const title = `Дайджест: ${topic}`.slice(0, 120);
  const written = await writeReportPdf(title, sections);
  opts.onStatus?.("working", "research.digest.open");
  let opened = "";
  try {
    opened = await openPath(written.path);
  } catch (err) {
    opened = `open skipped: ${err instanceof Error ? err.message : String(err)}`;
  }

  const openNote = /ERROR/i.test(opened)
    ? `Файл сохранён, автооткрытие не удалось: ${opened}`
    : opened;

  return {
    path: written.path,
    summary: [
      `DONE: дайджест по «${topic}» готов.`,
      written.message,
      openNote,
      `path: ${written.path}`,
    ].join("\n"),
  };
}
