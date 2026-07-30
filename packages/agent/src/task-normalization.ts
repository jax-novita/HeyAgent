export interface TaskCorrection {
  from: string;
  to: string;
  start: number;
}

export interface NormalizedDocumentTask {
  action: "create_document";
  destination: "google_docs";
  topic: string;
  documentType: "реферат" | "эссе" | "доклад" | "документ";
  requestedTitle?: string;
  requestedSections?: string[];
  oneSentencePerSection?: boolean;
}

export interface NormalizedDocumentRequest {
  /** Exact, immutable owner input. Never append metadata to this value. */
  originalUserMessage: string;
  /** Data used by the document harness. Contains no logs or correction history. */
  task: NormalizedDocumentTask;
  /** Diagnostic metadata only. Never pass this field to generation or integrations. */
  corrections: TaskCorrection[];
}

const DOCUMENT_TYPE_RE = /(?:^|\s)(реферат|эссе|доклад|документ)(?=\s|[.,!?]|$)/iu;
const TOPIC_RE = /(?:по\s+теме|на\s+тему)\s+[«„“"']?(.+?)[»“"']?\s*[.!?]*$/iu;
const EXACT_TITLE_RE =
  /(?:с\s+)?(?:точным\s+)?названи(?:ем|е)\s+[«„“"]([^»“"]+)[»“"]/iu;
const SECTIONS_RE = /раздел[а-яё]*\s*:\s*(.+)$/iu;

function sentenceCase(value: string): string {
  const clean = value.trim();
  if (!clean) return clean;
  return `${clean[0]!.toLocaleUpperCase("ru-RU")}${clean.slice(1)}`;
}

function extractTopic(message: string, documentType: string): string {
  const explicit = message.match(TOPIC_RE)?.[1];
  const afterType = message.match(
    new RegExp(`${documentType}\\s+(?:по\\s+)?[«„“"']?(.+?)[»“"']?\\s*[.!?]*$`, "iu"),
  )?.[1];
  const candidate = explicit || afterType || "Без темы";
  const clean = candidate
    .replace(
      /\s+(?:в|на)\s+(?:google\s*)?(?:docs?|documents?|гугл\s*док\w*)\s*$/iu,
      "",
    )
    .replace(/^[«„“"']+|[»“"']+$/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return sentenceCase(clean || "Без темы").slice(0, 120);
}

/**
 * Deterministic normalization for Google Docs compose requests.
 *
 * This intentionally performs no LLM rewriting. Consequently it cannot invent
 * typo corrections or copy prompt examples into owner data.
 */
export function normalizeDocumentRequest(
  originalUserMessage: string,
): NormalizedDocumentRequest {
  const exactOriginal = originalUserMessage;
  const compact = exactOriginal.trim().replace(/\s+/g, " ");
  const documentType =
    (compact.match(DOCUMENT_TYPE_RE)?.[1]?.toLocaleLowerCase("ru-RU") as
      | NormalizedDocumentTask["documentType"]
      | undefined) ?? "документ";
  const requestedTitle = compact.match(EXACT_TITLE_RE)?.[1]?.trim();
  const sectionsBlock = compact.match(SECTIONS_RE)?.[1] ?? "";
  const requestedSections = [...sectionsBlock.matchAll(/[«„“"]([^»“"]+)[»“"]/gu)]
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean)
    .slice(0, 12);
  const oneSentencePerSection =
    /в\s+каждом\s+разделе[^.!?]*(?:одно|1)\s+коротк[а-яё]*[^.!?]*предложени/iu.test(compact);

  return {
    originalUserMessage: exactOriginal,
    task: {
      action: "create_document",
      destination: "google_docs",
      topic: requestedTitle || extractTopic(compact, documentType),
      documentType,
      ...(requestedTitle ? { requestedTitle } : {}),
      ...(requestedSections.length ? { requestedSections } : {}),
      ...(oneSentencePerSection ? { oneSentencePerSection: true } : {}),
    },
    corrections: [],
  };
}
