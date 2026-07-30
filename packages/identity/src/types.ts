import type { SupportedLocale } from "@heyagent/shared";

export interface AgentIdentity {
  name: string;
  avatarId: string;
  persona: string;
  createdAt: string;
}

export const PERSONAS: Record<string, string> = {
  friendly: "You are warm, encouraging, and explain things clearly.",
  engineer: "You are precise, technical, and prefer actionable solutions.",
  concise: "You are brief and direct. No fluff.",
};

const PERSONAS_RU: Record<string, string> = {
  friendly: "Ты дружелюбен, поддерживаешь пользователя и объясняешь всё понятно.",
  engineer: "Ты точен, технически грамотен и предпочитаешь практические решения.",
  concise: "Ты отвечаешь кратко и прямо, без лишних слов.",
};

export const AVATAR_CATALOG = [
  { id: "sprite-01", label: "Cyan Bot", color: "#3dd9c4" },
  { id: "sprite-02", label: "Amber Scout", color: "#f5a623" },
  { id: "sprite-03", label: "Rose Pilot", color: "#e85d8a" },
  { id: "sprite-04", label: "Lime Ranger", color: "#7ed957" },
  { id: "sprite-05", label: "Indigo Sage", color: "#6b7fd7" },
  { id: "sprite-06", label: "Coral Spark", color: "#ff6b4a" },
  { id: "sprite-07", label: "Mint Ghost", color: "#9ef0d0" },
  { id: "sprite-08", label: "Gold Knight", color: "#d4a017" },
  { id: "sprite-09", label: "Violet Wisp", color: "#a855f7" },
  { id: "sprite-10", label: "Steel Core", color: "#8b9aab" },
  { id: "sprite-11", label: "Sunrise", color: "#ff9a56" },
  { id: "sprite-12", label: "Night Owl", color: "#4a5568" },
] as const;

export type AvatarId = (typeof AVATAR_CATALOG)[number]["id"];
export type AvatarState = "idle" | "thinking" | "working" | "done";

export function isValidAvatarId(id: string): id is AvatarId {
  return AVATAR_CATALOG.some((a) => a.id === id);
}

export function validateAgentName(name: string, locale: SupportedLocale = "en"): string | null {
  const trimmed = name.trim();
  if (trimmed.length < 2) {
    return locale === "ru"
      ? "Имя должно содержать не менее 2 символов."
      : "Name must be at least 2 characters.";
  }
  if (trimmed.length > 24) {
    return locale === "ru"
      ? "Имя должно содержать не более 24 символов."
      : "Name must be 24 characters or fewer.";
  }
  if (!/^[\p{L}\p{N}\s_-]+$/u.test(trimmed)) {
    return locale === "ru"
      ? "Имя может содержать только буквы, цифры, пробелы, _ и -."
      : "Name can only contain letters, numbers, spaces, _ and -.";
  }
  return null;
}

export function buildSystemPrompt(
  identity: AgentIdentity,
  locale: SupportedLocale = "en",
): string {
  if (locale === "ru") {
    const personaText = PERSONAS_RU[identity.persona] ?? PERSONAS_RU.friendly;
    return [
      `Ты ${identity.name}, персональный ИИ-агент, локально работающий на компьютере владельца через HeyAgent.`,
      personaText,
      "Ты управляешь этим компьютером: файлами, терминалом, браузером, интерфейсом, Telegram Desktop и системными настройками.",
      "Используй все подходящие инструменты — экран, приложения, офис и веб, — а не один узкий канал.",
      "При приветствии называй себя по имени. Выполняй обычные задачи без лишних запросов разрешения.",
      "Останавливайся только при настоящих препятствиях: CAPTCHA, входе, оплате или необратимом удалении, когда этого требует политика.",
      "Никогда не переводи, не исправляй и не переписывай исходный запрос пользователя перед маршрутизацией или выполнением.",
    ].join("\n");
  }

  const personaText = PERSONAS[identity.persona] ?? PERSONAS.friendly;
  return [
    `You are ${identity.name}, a personal AI agent running locally on the owner's computer via HeyAgent.`,
    personaText,
    "You control this PC: files, shell, browser, desktop UI, Telegram Desktop, system settings.",
    "Use the full tool surface as needed — screen, apps, office, web — not a single narrow channel.",
    "Identify yourself by name when greeting. Act — do not ask permission for ordinary tasks.",
    "Only pause for genuine blockers: CAPTCHA, login, payment, or irreversible destroy when policy requires.",
    "Never translate, correct, or rewrite the original user request before routing or execution.",
  ].join("\n");
}
