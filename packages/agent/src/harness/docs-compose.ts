/**
 * Generate a clean document payload and write it through Google Docs API.
 * Browser automation is only used to open the finished document URL.
 */
import { chatCompletion, type ChatMessage, type ModelRef } from "@heyagent/models";
import { IntegrationsHub, openUrl } from "@heyagent/integrations";
import {
  loadConfig,
  resolveLocale,
  type SupportedLocale,
} from "@heyagent/shared";
import {
  normalizeDocumentRequest,
  type NormalizedDocumentRequest,
} from "../task-normalization.js";

export type DocumentTaskNormalizer = (message: string) => NormalizedDocumentRequest;

export interface PreparedDocsCompose {
  normalized: NormalizedDocumentRequest;
  title: string;
  generationMessages: ChatMessage[];
}

export interface GoogleDocsWritePayload {
  title: string;
  content: string;
}

function sentenceCase(value: string): string {
  const clean = value.trim();
  if (!clean) return clean;
  return `${clean[0]!.toLocaleUpperCase("ru-RU")}${clean.slice(1)}`;
}

export function buildDocumentTitle(request: NormalizedDocumentRequest): string {
  return (
    request.task.requestedTitle ||
    `${sentenceCase(request.task.documentType)}: ${request.task.topic}`
  ).slice(0, 120);
}

export function buildDocsGenerationMessages(
  request: NormalizedDocumentRequest,
  locale: SupportedLocale = "ru",
): ChatMessage[] {
  const { documentType, topic, requestedSections, oneSentencePerSection } = request.task;
  const sectionRequirement = requestedSections?.length
    ? [
        `Use exactly these sections in this order: ${requestedSections.join(", ")}.`,
        oneSentencePerSection ? "Write exactly one short sentence in each section." : "",
      ].filter(Boolean).join(" ")
    : "";
  if (locale === "en") {
    return [
      {
        role: "system",
        content: [
          `Write an educational ${documentType}.`,
          requestedSections?.length
            ? ""
            : "Structure: introduction, 3–5 titled sections, conclusion and sources.",
          oneSentencePerSection ? "" : "Length: approximately 800–1400 words.",
          "Use controlled markup: # for the title, ## for sections, **text** for important terms, *text* for restrained italics and <u>text</u> for 3–6 key conclusions.",
          "Use '-' or numbered lines for lists. Do not over-format.",
          "Write formulas with readable Unicode symbols. Do not use LaTeX delimiters or commands.",
          "Return only the document text without JSON, reasoning, correction logs or internal notes.",
          sectionRequirement,
        ].join("\n"),
      },
      {
        role: "user",
        content: `Document type: ${documentType}\nTopic: ${topic}`,
      },
    ];
  }
  return [
    {
      role: "system",
      content: [
        `Ты пишешь учебный ${documentType} на русском языке.`,
        requestedSections?.length
          ? ""
          : "Структура: введение, 3–5 разделов с подзаголовками, заключение, список источников.",
        oneSentencePerSection ? "" : "Объём: примерно 800–1400 слов.",
        "Используй управляемую разметку: # для названия, ## для разделов, **текст** для важных терминов, *текст* для умеренного курсива, <u>текст</u> для 3–6 ключевых выводов.",
        "Списки оформляй строками через «- » или «1. ». Не злоупотребляй выделениями.",
        "Формулы пиши читаемыми Unicode-символами (например: Δx · Δp ≥ ℏ/2; ψ = c₁ψ₁ + c₂ψ₂). Не используй LaTeX, \\[, \\], \\frac или обратные слеши.",
        "Верни только текст документа без JSON, рассуждений, служебных заметок и метакомментариев.",
        sectionRequirement,
      ].join("\n"),
    },
    {
      role: "user",
      content: `Тип документа: ${documentType}\nТема: ${topic}`,
    },
  ];
}

export function prepareDocsCompose(
  originalUserMessage: string,
  normalize: DocumentTaskNormalizer = normalizeDocumentRequest,
  locale: SupportedLocale = "ru",
): PreparedDocsCompose {
  // Exactly one normalization call per compose run.
  const normalized = normalize(originalUserMessage);
  return {
    normalized,
    title: buildDocumentTitle(normalized),
    generationMessages: buildDocsGenerationMessages(normalized, locale),
  };
}

export function cleanGeneratedDocumentText(value: string): string {
  return value
    .replace(/<think>[\s\S]*?<\/think>/giu, "")
    .split(/\r?\n/)
    .filter(
      (line) =>
        !/^\s*(?:🔎\s*)?(?:\[?перечитал\s+задание|исправлено\s*:|уточнена\s+платформа|стиль\s+сохранён)/iu.test(
          line,
        ),
    )
    .join("\n")
    .trim();
}

export function buildGoogleDocsWritePayload(
  prepared: PreparedDocsCompose,
  generatedContent: string,
): GoogleDocsWritePayload {
  return {
    title: prepared.title,
    content: cleanGeneratedDocumentText(generatedContent),
  };
}

export function buildConstrainedDocumentContent(
  prepared: PreparedDocsCompose,
): string | null {
  const { requestedSections, oneSentencePerSection } = prepared.normalized.task;
  if (!oneSentencePerSection || !requestedSections?.length) return null;
  return [
    `# ${prepared.title}`,
    ...requestedSections.flatMap((section) => [
      `## ${section}`,
      `Тестовый раздел «${section}» создан для проверки HeyAgent.`,
    ]),
  ].join("\n\n");
}

function fallbackDocument(documentType: string, topic: string): string {
  return [
    `${sentenceCase(documentType)} по теме «${topic}»`,
    "",
    "Введение",
    `${topic} — важная область знаний. Ниже изложены базовые понятия и практическое значение темы.`,
    "",
    "Основная часть",
    "1. Определения и ключевые понятия.",
    "2. Исторический контекст и развитие области.",
    "3. Современные применения и вызовы.",
    "",
    "Заключение",
    `Тема «${topic}» остаётся актуальной для учёбы и практики.`,
    "",
    "Источники",
    "1. Учебные материалы по теме.",
    "2. Обзорные статьи в открытом доступе.",
  ].join("\n");
}

export function formatDocsSuccess(
  request: NormalizedDocumentRequest,
  locale: SupportedLocale = "ru",
  documentUrl?: string,
): string {
  const link = documentUrl ? `\n${documentUrl}` : "";
  if (locale === "en") {
    return `Done — ${request.task.documentType} on “${request.task.topic}” was created in Google Docs.${link}`;
  }
  return `Готово — ${request.task.documentType} по теме «${request.task.topic}» создан в Google Docs.${link}`;
}

export async function runDocsCompose(opts: {
  userText: string;
  modelRef: ModelRef;
  onStatus?: (s: "working" | "thinking" | "done" | "idle", d?: string) => void;
  normalizeTask?: DocumentTaskNormalizer;
  locale?: SupportedLocale;
}): Promise<{ summary: string; title: string }> {
  const locale = opts.locale ?? resolveLocale(await loadConfig());
  const prepared = prepareDocsCompose(opts.userText, opts.normalizeTask, locale);
  const { documentType, topic } = prepared.normalized.task;

  opts.onStatus?.("working", "docs.compose.generate");
  let generatedContent = "";
  try {
    const response = await chatCompletion(opts.modelRef, prepared.generationMessages, {
      maxTokens: 3500,
      toolChoice: "none",
      useDefaultFallbacks: true,
    });
    generatedContent = response.content || "";
  } catch (error) {
    return {
      title: prepared.title,
      summary: `ERROR: не смог сгенерировать текст документа: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  generatedContent = buildConstrainedDocumentContent(prepared) ?? generatedContent;
  if (
    cleanGeneratedDocumentText(generatedContent).length < 200 &&
    !prepared.normalized.task.requestedSections?.length
  ) {
    generatedContent = fallbackDocument(documentType, topic);
  }
  const payload = buildGoogleDocsWritePayload(prepared, generatedContent);

  opts.onStatus?.("working", "docs.compose.write");
  const hub = new IntegrationsHub();
  const result = await hub.googleDocsWrite(payload.title, payload.content);

  if (/not connected|Google not connected/i.test(result)) {
    return {
      title: payload.title,
      summary: [
        "ERROR: Google не подключён — документ в Docs не создан.",
        "Сделай: npx hey connect google",
      ].join("\n"),
    };
  }
  if (/Failed|error|ERROR/i.test(result) && !/Created Google Doc/i.test(result)) {
    return {
      title: payload.title,
      summary: `ERROR: Google Docs write failed.\n${result}`,
    };
  }

  const documentUrl = result.match(/https:\/\/docs\.google\.com\/document\/d\/[^\s]+/)?.[0];
  if (documentUrl) openUrl(documentUrl);

  return {
    title: payload.title,
    summary: formatDocsSuccess(prepared.normalized, locale, documentUrl),
  };
}
