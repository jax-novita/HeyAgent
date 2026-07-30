/**
 * Persist last quiz tab so short Telegram replies («Пройди!!!!», «Так ответь»)
 * resume the open_tab harness instead of falling into llm_loop.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getHeyAgentHome, ensureDir } from "@heyagent/shared";

export interface LastQuizContext {
  tabQuery: string;
  browser: "auto" | "yandex" | "chrome" | "edge";
  url?: string;
  title?: string;
  progress?: string;
  at: string;
}

function path(): string {
  return join(getHeyAgentHome(), "last-quiz.json");
}

export async function rememberLastQuiz(ctx: Omit<LastQuizContext, "at">): Promise<void> {
  await ensureDir(getHeyAgentHome(), { mkdir } as typeof import("node:fs/promises"));
  const full: LastQuizContext = { ...ctx, at: new Date().toISOString() };
  await writeFile(path(), JSON.stringify(full, null, 2), "utf-8");
}

export async function loadLastQuiz(maxAgeHours = 12): Promise<LastQuizContext | null> {
  if (!existsSync(path())) return null;
  try {
    const raw = JSON.parse(await readFile(path(), "utf-8")) as LastQuizContext;
    const ageMs = Date.now() - new Date(raw.at).getTime();
    if (!Number.isFinite(ageMs) || ageMs > maxAgeHours * 3600_000) return null;
    return raw;
  } catch {
    return null;
  }
}

/**
 * Short owner messages that mean «continue / finish the quiz» — no «тест» required.
 * Must NOT match «ответь Алексy» (contact reply).
 */
export function isQuizContinueIntent(text: string): boolean {
  const raw = text.trim();
  const t = raw.toLowerCase().replace(/ё/g, "е");
  const clean = raw
    .replace(/[!?….💡✅⏳🧭📖]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Contact reply → not quiz
  if (
    /(ответь|ответить|напиши|скажи|отправь)\s+[A-Za-zА-Яа-яЁё]{2,}/i.test(raw) &&
    !/(вопрос|тест|опрос|квиз)/i.test(t)
  ) {
    return false;
  }

  if (
    /^(пройди|пройти|пройдем|продолжи|продолжай|продолжить|дальше|давай|заново|решай|отвечай|ответь|так ответь|еще раз|ещё раз)(?:\s+пожалуйста)?$/i.test(
      clean,
    )
  ) {
    return true;
  }

  if (
    /^(пройди|пройти|продолж\w*|реши)\s+(его|ее|их|этот|тот|заново|еще\s*раз|ещё\s*раз|до\s*конца)(?:\s+пожалуйста)?$/i.test(
      clean,
    )
  ) {
    return true;
  }

  if (/так\s+ответь/i.test(t)) return true;
  if (/пройд\w*.{0,30}заново/i.test(t)) return true;
  if (/продолж\w*.{0,30}(тест|опрос|квиз|вопрос)/i.test(t)) return true;
  if (/^(да|ага|давай|продолжай|работай)[!?.]*$/i.test(clean)) return true;

  return false;
}
