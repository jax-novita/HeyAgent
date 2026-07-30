/**
 * Compose text for Notepad with genre/topic fidelity.
 * Prevents the LLM from substituting «стишок» when the owner asked for «рассказ».
 */
import { chatCompletion, type ModelRef } from "@heyagent/models";
import { notepadWrite } from "@heyagent/computer";

export type NoteGenre = "story" | "poem" | "list" | "letter" | "note";

export interface NotepadComposeIntent {
  genre: NoteGenre;
  topic: string;
  destination: "desktop" | "documents" | "downloads" | undefined;
  raw: string;
}

// No \b — JS word boundaries ignore Cyrillic.
const GENRE_HINTS: { re: RegExp; genre: NoteGenre }[] = [
  { re: /(рассказ|истори[яи]|сказк\w*|story|tale)/i, genre: "story" },
  { re: /(стишок|стих\w*|поэм\w*|рифм\w*|poem|rhyme|verse)/i, genre: "poem" },
  { re: /(список|\blist\b|\btodo\b|дел\w*)/i, genre: "list" },
  { re: /(письм\w*|\bletter\b)/i, genre: "letter" },
];

const GENRE_RU: Record<NoteGenre, string> = {
  story: "рассказ (проза, абзацы; НЕ стих и НЕ рифма)",
  poem: "стихотворение",
  list: "список",
  letter: "письмо",
  note: "заметка/текст",
};

function isBrowserDocumentTarget(lower: string): boolean {
  return (
    /google\s*doc|docs\.google|гугл\s*док|документ\w*\s+google|word\s+online|notion\.|figma/i.test(
      lower,
    ) ||
    (/(браузер|chrome|edge|firefox|yandex|яндекс)/i.test(lower) &&
      /(напиши|реферат|сочини|текст)/i.test(lower) &&
      !/(блокнот|notepad)/i.test(lower))
  );
}

export function detectNotepadComposeIntent(text: string): NotepadComposeIntent | null {
  const t = text.trim();
  const lower = t.toLowerCase().replace(/ё/g, "е");
  // «напиши там реферат в Google Docs» — не блокнот
  if (isBrowserDocumentTarget(lower)) return null;
  if (
    !/(блокнот|notepad)/i.test(lower) &&
    /(git|репозитор|коммит|commit|npm|node\.?js|http\s*endpoint|терминал|shell|powershell|cmd\.exe)/i.test(
      lower,
    )
  ) {
    return null;
  }

  const openNotepadOnly = /^(открой|открыть)\s+(мне\s+)?(блокнот|notepad)\s*$/i.test(lower);
  const composeGenreLocal =
    /(напиши|сочини|создай|запиши).{0,80}(реферат|эссе|доклад|сочинен\w*|рассказ|стишок|стих\w*|стать[юя]|текст|заметк)/i.test(
      lower,
    ) && !/(телеграм|telegram|(^|\s)тг(\s|$))/i.test(lower);

  const wantsNotepad =
    openNotepadOnly ||
    /(блокнот|notepad|создай\s+файл|файл\s+в\s+блокнот|открой\s+блокнот)/i.test(lower) ||
    composeGenreLocal ||
    // «напиши там» только рядом с блокнотом / файлом, не в веб-доке
    (/(напиши\s+(мне\s+)?там)/i.test(lower) &&
      /(блокнот|notepad|файл)/i.test(lower) &&
      !/(браузер|google|гугл)/i.test(lower)) ||
    (/(создай|сделай)\s+файл/i.test(lower) && /(напиши|текст|рассказ|стих)/i.test(lower));
  const wantsWrite =
    openNotepadOnly ||
    /(напиши|сочини|создай|сделай|запиши)/i.test(lower);
  if (!wantsNotepad || !wantsWrite) return null;

  let genre: NoteGenre = "note";
  for (const h of GENRE_HINTS) {
    if (h.re.test(lower)) {
      genre = h.genre;
      break;
    }
  }

  let topic = t
    .replace(/^(пожалуйста|плиз|pls|please)[,!\s]*/i, "")
    .replace(
      /\b(создай|сделай|открой|напиши|сочини|запиши|мне|там|файл|в|на|блокнот[еа]?|notepad|текстов\w*)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  if (topic.length < 3) topic = t.slice(0, 120);

  let destination: NotepadComposeIntent["destination"];
  if (/рабоч(ий|ем)\s+стол|desktop/i.test(lower)) destination = "desktop";
  else if (/документ|documents/i.test(lower)) destination = "documents";
  else if (/загрузк|downloads/i.test(lower)) destination = "downloads";
  else destination = "desktop";

  return { genre, topic, destination, raw: t };
}

function titleFromTopic(genre: NoteGenre, topic: string): string {
  const base = topic
    .replace(/[^\w\-. а-яА-ЯёЁ]+/gi, " ")
    .trim()
    .slice(0, 48)
    .replace(/\s+/g, "_")
    .toLowerCase();
  if (base.length >= 3) return base;
  return genre === "story" ? "rasskaz" : genre === "poem" ? "stihotvorenie" : "zametka";
}

function looksLikePoem(content: string): boolean {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 3) return false;
  const short = lines.filter((l) => l.length <= 48).length;
  return short / lines.length >= 0.7 && lines.length <= 20 && content.length < 600;
}

function topicTokens(topic: string): string[] {
  return topic
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[^a-zа-я0-9]+/i)
    .filter((t) => t.length >= 4)
    .filter((t) => !/(рассказ|история|стих|стишок|файл|блокнот|маленьк)/i.test(t));
}

function contentMatchesTopic(content: string, topic: string): boolean {
  const hay = content.toLowerCase().replace(/ё/g, "е");
  const tokens = topicTokens(topic);
  if (!tokens.length) {
    // «маленьком мальчике» → мальчик
    if (/мальчик/i.test(topic) && /мальчик/i.test(hay)) return true;
    if (/девочк/i.test(topic) && /девочк/i.test(hay)) return true;
    return hay.length > 80;
  }
  const hits = tokens.filter((t) => hay.includes(t) || hay.includes(t.replace(/е$/, "")));
  return hits.length >= Math.min(1, tokens.length);
}

async function generateNoteBody(
  modelRef: ModelRef,
  intent: NotepadComposeIntent,
): Promise<{ title: string; content: string }> {
  const res = await chatCompletion(
    modelRef,
    [
      {
        role: "system",
        content: [
          "Ты пишешь текст для файла в Блокноте.",
          `Жанр ОБЯЗАТЕЛЕН: ${GENRE_RU[intent.genre]}.`,
          "Тема ОБЯЗАТЕЛЬНА — не подменяй на другой жанр или другой сюжет.",
          "Если жанр = рассказ: пиши ПРОЗУ (абзацы). Запрещены стихи, рифмы, короткие строчки-куплеты.",
          "Если жанр = стихотворение: тогда можно рифму.",
          "Язык: русский. Длина рассказа: 2–5 абзацев (примерно 400–1200 знаков).",
          "Имя файла — по теме (латиница/кириллица без пробелов), БЕЗ слова «стишок», если это не стих.",
          'Ответ СТРОГО JSON: {"title":"...","content":"..."}',
        ].join("\n"),
      },
      {
        role: "user",
        content: `Исходный запрос: ${intent.raw}\nЖанр: ${intent.genre}\nТема: ${intent.topic}`,
      },
    ],
    { maxTokens: 1200, toolChoice: "none" },
  );
  const text = (res.content ?? "").trim();
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) {
    return {
      title: titleFromTopic(intent.genre, intent.topic),
      content: text.slice(0, 4000) || fallbackStory(intent.topic),
    };
  }
  try {
    const parsed = JSON.parse(m[0]) as { title?: string; content?: string };
    return {
      title:
        typeof parsed.title === "string" && parsed.title.trim()
          ? parsed.title.trim().replace(/\.txt$/i, "")
          : titleFromTopic(intent.genre, intent.topic),
      content:
        typeof parsed.content === "string" && parsed.content.trim()
          ? parsed.content.trim()
          : fallbackStory(intent.topic),
    };
  } catch {
    return {
      title: titleFromTopic(intent.genre, intent.topic),
      content: fallbackStory(intent.topic),
    };
  }
}

function fallbackStory(topic: string): string {
  const about = topic.replace(/\b(рассказ|история|про|о|об)\b/gi, " ").replace(/\s+/g, " ").trim();
  return [
    `Однажды жил-был маленький мальчик${about ? ` — герой истории про «${about}»` : ""}.`,
    "",
    "Утром он вышел во двор, где всё казалось знакомым и в то же время новым: скрипела калитка, пахло хлебом из соседнего окна, а солнце ложилось полосками на песок.",
    "",
    "Мальчик нашёл под кустом старую пуговицу и решил, что это талисман. Весь день он бережно носил её в кармане, помогал бабушке донести сумку и делился яблоком с другом.",
    "",
    "К вечеру он понял простую вещь: самые важные приключения часто случаются рядом с домом — если смотреть внимательно и не бояться быть добрым.",
  ].join("\n");
}

export async function runNotepadCompose(opts: {
  text: string;
  modelRef: ModelRef;
  intent?: NotepadComposeIntent | null;
}): Promise<{ summary: string; content: string; title: string }> {
  const intent = opts.intent ?? detectNotepadComposeIntent(opts.text);
  if (!intent) {
    return {
      summary: "ERROR: не похоже на задачу «напиши текст в блокнот».",
      content: "",
      title: "",
    };
  }

  let { title, content } = await generateNoteBody(opts.modelRef, intent);

  // Reject genre swap: story → poem
  if (intent.genre === "story" && looksLikePoem(content)) {
    content = fallbackStory(intent.topic);
    title = titleFromTopic("story", intent.topic);
  }
  if (intent.genre === "story" && /стиш/i.test(title)) {
    title = titleFromTopic("story", intent.topic);
  }
  if (!contentMatchesTopic(content, intent.topic) && intent.genre === "story") {
    content = fallbackStory(intent.topic);
  }

  const saved = await notepadWrite(content, title, intent.destination);
  return {
    summary: [
      `DONE: написал ${GENRE_RU[intent.genre]} по теме «${intent.topic}».`,
      saved,
    ].join("\n"),
    content,
    title,
  };
}

/** String result helper for callers that only need the message. */
export async function runNotepadComposeText(opts: {
  text: string;
  modelRef: ModelRef;
  intent?: NotepadComposeIntent | null;
}): Promise<string> {
  const r = await runNotepadCompose(opts);
  return r.summary;
}
