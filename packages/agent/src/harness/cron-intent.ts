/** Natural-language → cron schedule. */

export function detectCronScheduleIntent(text: string): {
  name: string;
  prompt: string;
  everyMinutes: number;
  daily?: { hourLocal: number; minuteLocal: number };
} | null {
  const t = text.trim();
  const lower = t.toLowerCase().replace(/ё/g, "е");
  if (!/(напоминан|кажд|каждые|cron|расписан|раз в|брифинг\s+кажд)/i.test(lower)) return null;

  const atTime = lower.match(
    /(?:каждый\s+день|ежедневн\w*|каждое\s+утро|каждый\s+вечер).{0,40}(?:в|во)\s+(\d{1,2})(?::(\d{2}))?/i,
  ) || lower.match(/(?:в|во)\s+(\d{1,2})(?::(\d{2}))?\s*(?:утра|вечера)?/i);

  let daily: { hourLocal: number; minuteLocal: number } | undefined;
  if (/каждый\s+день|ежедневн|каждое\s+утро|каждый\s+вечер/i.test(lower) && atTime) {
    let hour = Number(atTime[1]);
    const minute = Number(atTime[2] || "0");
    if (/вечер/i.test(lower) && hour < 12) hour += 12;
    if (/утр/i.test(lower) && hour === 12) hour = 9;
    daily = { hourLocal: hour, minuteLocal: minute };
  } else if (/каждое\s+утро/i.test(lower)) {
    daily = { hourLocal: 9, minuteLocal: 0 };
  } else if (/каждый\s+вечер/i.test(lower)) {
    daily = { hourLocal: 20, minuteLocal: 0 };
  }

  let everyMinutes: number | null = daily ? 60 * 24 : null;
  const everyM = lower.match(/каждые?\s+(\d+)\s*(минут|мин|час|часа|часов|день|дня|дней)/i);
  if (everyM) {
    const n = Number(everyM[1]);
    const unit = everyM[2];
    if (/час/.test(unit)) everyMinutes = n * 60;
    else if (/день|дня|дней/.test(unit)) everyMinutes = n * 60 * 24;
    else everyMinutes = n;
  } else if (/каждый\s+день|ежедневн/i.test(lower)) {
    everyMinutes = 60 * 24;
  } else if (/каждый\s+час/i.test(lower)) {
    everyMinutes = 60;
  }

  if (everyMinutes == null && !daily) return null;

  let prompt = t
    .replace(/^(пожалуйста|плиз)[,!\s]*/i, "")
    .replace(
      /напоминан?\w*\s+(мне\s+)?(каждый\s+день\s+)?((в|во)\s+\d{1,2}(?::\d{2})?\s+)?/i,
      "",
    )
    .replace(/каждые?\s+\d+\s*(минут\w*|мин|час\w*|день|дня|дней)\s*/i, "")
    .replace(/^(чтобы\s+|и\s+)/i, "")
    .trim();
  if (prompt.length < 3) prompt = t.replace(/напоминан?\w*/i, "").trim() || t;
  if (/брифинг/i.test(lower) && !/брифинг/i.test(prompt)) {
    prompt = `собери брифинг: ${prompt}`;
  }
  const name = (`reminder_${prompt}`).slice(0, 40).replace(/\s+/g, "_");
  return {
    name,
    prompt,
    everyMinutes: Math.max(1, Math.min(everyMinutes || 60 * 24, 60 * 24 * 7)),
    daily,
  };
}
