/**
 * Accurate wall-clock time from the OS — never ask the LLM to invent the time.
 */
export interface ClockSnapshot {
  iso: string;
  unixMs: number;
  unixSec: number;
  timezone: string;
  offsetMinutes: number;
  localeDate: string;
  localeTime: string;
  localeDateTime: string;
  weekday: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function resolveTimezone(timeZone?: string): string {
  return (
    timeZone?.trim() ||
    process.env.HEYAGENT_TZ ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "UTC"
  );
}

export function getClockSnapshot(timeZone?: string, at: Date = new Date()): ClockSnapshot {
  const now = at;
  const tz = resolveTimezone(timeZone);

  const fmt = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("ru-RU", { timeZone: tz, ...options }).format(now);

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "long",
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  let offsetMin = -now.getTimezoneOffset();
  try {
    const inTz = new Date(now.toLocaleString("en-US", { timeZone: tz }));
    const inUtc = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
    offsetMin = Math.round((inTz.getTime() - inUtc.getTime()) / 60000);
  } catch {
    /* keep local */
  }

  return {
    iso: now.toISOString(),
    unixMs: now.getTime(),
    unixSec: Math.floor(now.getTime() / 1000),
    timezone: tz,
    offsetMinutes: offsetMin,
    localeDate: fmt({ year: "numeric", month: "2-digit", day: "2-digit" }),
    localeTime: fmt({ hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }),
    localeDateTime: fmt({
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }),
    weekday: fmt({ weekday: "long" }),
    year: Number(get("year") || now.getFullYear()),
    month: Number(get("month") || now.getMonth() + 1),
    day: Number(get("day") || now.getDate()),
    hour: Number(get("hour") || now.getHours()),
    minute: Number(get("minute") || now.getMinutes()),
    second: Number(get("second") || now.getSeconds()),
  };
}

export function formatClockForHumans(snap: ClockSnapshot = getClockSnapshot()): string {
  const sign = snap.offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(snap.offsetMinutes);
  const oh = String(Math.floor(abs / 60)).padStart(2, "0");
  const om = String(abs % 60).padStart(2, "0");
  return [
    `Сейчас (система, не догадка LLM): ${snap.localeDateTime}`,
    `День недели: ${snap.weekday}`,
    `Часовой пояс: ${snap.timezone} (UTC${sign}${oh}:${om})`,
    `Unix: ${snap.unixSec}`,
    `ISO UTC: ${snap.iso}`,
  ].join("\n");
}

/** True if the user is asking what time / date it is. */
export function detectTimeIntent(text: string): boolean {
  const t = text.toLowerCase().trim();
  return (
    /^(который\s+час|сколько\s+времени|какое\s+время|what\s+time|time\s+now)\b/i.test(t) ||
    /(который|сколько).{0,12}(час|времени)/i.test(t) ||
    /(какая|какое).{0,12}(дата|число|день)/i.test(t) ||
    /(what('| i)?s?\s+the\s+time|current\s+time|what\s+day|what\s+date)/i.test(t) ||
    /сколько\s+сейчас\s+времени/i.test(t)
  );
}
