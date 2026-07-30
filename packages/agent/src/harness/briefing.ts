/**
 * Morning/evening briefing: news + mail + calendar → one PDF → Telegram owner.
 */
import { chatCompletion, type ModelRef } from "@heyagent/models";
import {
  writeReportPdf,
  telegramSendDocumentBot,
  telegramNotifyOwner,
  type ReportSection,
} from "@heyagent/computer";
import { IntegrationsHub } from "@heyagent/integrations";
import { runResearchDigest, extractDigestTopic } from "./research-digest.js";

export async function runBriefingCompose(opts: {
  topic: string;
  modelRef: ModelRef;
  onStatus?: (s: "working" | "thinking" | "done" | "idle", d?: string) => void;
}): Promise<{ summary: string; path: string }> {
  const topic = extractDigestTopic(opts.topic) || "мир";
  const sections: ReportSection[] = [];

  opts.onStatus?.("working", "briefing.news");
  try {
    const dig = await runResearchDigest({
      topic,
      modelRef: opts.modelRef,
      onStatus: opts.onStatus,
    });
    sections.push({
      heading: `Новости: ${topic}`,
      body: dig.summary.slice(0, 2500),
      source: dig.path,
    });
  } catch (err) {
    sections.push({
      heading: "Новости",
      body: `Не удалось собрать: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  opts.onStatus?.("working", "briefing.mail");
  try {
    const hub = new IntegrationsHub();
    const mail = await hub.gmailSummary(8, false);
    sections.push({
      heading: "Почта",
      body: mail?.trim() || "Google/почта не подключена (hey connect google).",
    });
  } catch {
    sections.push({ heading: "Почта", body: "Почта недоступна." });
  }

  opts.onStatus?.("working", "briefing.calendar");
  try {
    const hub = new IntegrationsHub();
    const cal = await hub.googleCalendarToday();
    sections.push({
      heading: "Календарь на сегодня",
      body: cal?.trim() || "Нет событий или Calendar API не подключён.",
    });
  } catch {
    sections.push({ heading: "Календарь на сегодня", body: "Календарь недоступен." });
  }

  // Optional LLM polish of intro
  opts.onStatus?.("working", "briefing.compose");
  let intro = `Брифинг по теме «${topic}» — ${new Date().toLocaleString("ru-RU")}.`;
  try {
    const res = await chatCompletion(
      opts.modelRef,
      [
        {
          role: "system",
          content: "Напиши 2–3 предложения введения к брифингу на русском. Без JSON.",
        },
        { role: "user", content: `Тема: ${topic}\nСекции: ${sections.map((s) => s.heading).join(", ")}` },
      ],
      { maxTokens: 300, toolChoice: "none", useDefaultFallbacks: true },
    );
    if (res.content?.trim()) intro = res.content.trim().slice(0, 600);
  } catch {
    /* keep default intro */
  }
  sections.unshift({ heading: "Кратко", body: intro });

  opts.onStatus?.("working", "briefing.pdf");
  const title = `Брифинг: ${topic}`.slice(0, 100);
  const written = await writeReportPdf(title, sections);

  opts.onStatus?.("working", "briefing.deliver");
  let delivered = "";
  try {
    delivered = await telegramSendDocumentBot(written.path, title);
  } catch (err) {
    delivered = `Telegram send skipped: ${err instanceof Error ? err.message : String(err)}`;
  }
  try {
    await telegramNotifyOwner(`📋 Брифинг готов: ${written.path}`);
  } catch {
    /* ignore */
  }

  return {
    path: written.path,
    summary: [`DONE: брифинг «${topic}».`, written.message, delivered, `path: ${written.path}`].join(
      "\n",
    ),
  };
}
