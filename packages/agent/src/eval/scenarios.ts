import type { EvalScenario } from "./types.js";

/** Built-in mock-first eval pack (OpenClaw personal-agent style). */
export const BUILTIN_SCENARIOS: EvalScenario[] = [
  {
    id: "01_youtube_open",
    name: "YouTube open — quick harness",
    mode: "mock",
    input: "открой мне дым сигарет с ментолом",
    expected: [
      { kind: "domain", value: "browser" },
      { kind: "harness", value: "youtube.open.lesson" },
      { kind: "youtube_mode", value: "quick" },
      { kind: "forbidden_includes", values: [] },
    ],
    tags: ["youtube", "harness"],
  },
  {
    id: "02_telegram_chat_until",
    name: "Telegram chat-until harness",
    mode: "mock",
    input: "общайся с Алексом в телеграме до прощания",
    expected: [
      { kind: "domain", value: "messaging" },
      { kind: "harness", value: "telegram_conversation" },
      { kind: "forbidden_includes", values: ["gmail.browser.send"] },
    ],
    tags: ["telegram", "harness"],
  },
  {
    id: "03_notepad_story",
    name: "Notepad story genre fidelity",
    mode: "mock",
    input: "создай файл в блокноте и напиши мне там рассказ о маленьком мальчике",
    expected: [
      { kind: "harness", value: "notepad.compose" },
      { kind: "notepad_genre", value: "story" },
    ],
    tags: ["notepad", "harness"],
  },
  {
    id: "04_system_volume",
    name: "System volume control",
    mode: "mock",
    input: "выключи звук",
    expected: [
      { kind: "harness", value: "system.control" },
    ],
    tags: ["system", "harness"],
  },
  {
    id: "05_browser_research",
    name: "Browser open content route",
    mode: "mock",
    input: "открой сайт wikipedia.org",
    expected: [
      { kind: "domain", value: "browser" },
      { kind: "harness", value: "llm_loop" },
      { kind: "forbidden_includes", values: ["telegram.message"] },
    ],
    tags: ["browser"],
  },
  {
    id: "06_long_session_compaction",
    name: "Compaction keeps recent + archives old",
    mode: "mock",
    input: "__compaction__",
    expected: [{ kind: "compaction", value: "ok" }],
    tags: ["compaction", "unit"],
  },
  {
    id: "07_failover",
    name: "Failover classifies 500/503",
    mode: "mock",
    input: "__failover__",
    expected: [{ kind: "failover_class", value: "ok" }],
    tags: ["failover", "unit"],
  },
  {
    id: "08_harness_override_quiz",
    name: "Open quiz → open_tab not Telegram",
    mode: "mock",
    input: "я открыл тест по математике пройди его",
    expected: [
      { kind: "domain", value: "browser" },
      { kind: "harness", value: "open_tab" },
      { kind: "forbidden_includes", values: ["telegram.message", "telegram.wait_reply"] },
    ],
    tags: ["quiz", "harness"],
  },
  {
    id: "09_forbidden_tool_quiz",
    name: "Bare «Пройди!!!!» stays quiz",
    mode: "mock",
    input: "Пройди!!!!",
    expected: [
      { kind: "harness", value: "open_tab" },
      { kind: "forbidden_includes", values: ["telegram.message"] },
    ],
    tags: ["quiz"],
  },
  {
    id: "10_recovery_plan_domain",
    name: "Deep lesson still youtube harness",
    mode: "mock",
    input: "открой урок по python на ютубе",
    expected: [
      { kind: "harness", value: "youtube.open.lesson" },
      { kind: "youtube_mode", value: "deep" },
    ],
    tags: ["youtube"],
  },
  {
    id: "11_cron_nl",
    name: "NL cron schedule harness",
    mode: "mock",
    input: "напоминай мне каждые 30 минут проверить почту",
    expected: [{ kind: "harness", value: "cron.schedule" }],
    tags: ["cron", "harness"],
  },
  {
    id: "12_google_docs_not_youtube",
    name: "Google Docs essay ≠ YouTube",
    mode: "mock",
    input:
      "открой мне google documents в яндекс браузере и напиши там реферат по теме криптография",
    expected: [
      { kind: "domain", value: "browser" },
      { kind: "harness", value: "docs.compose" },
      { kind: "forbidden_includes", values: ["telegram.message", "telegram.wait_reply"] },
    ],
    tags: ["browser", "regression"],
  },
  {
    id: "13_google_docs_not_telegram",
    name: "Google Docs essay ≠ Telegram search",
    mode: "mock",
    input: "напиши мне реферат в google docs по теме криптография",
    expected: [
      { kind: "domain", value: "browser" },
      { kind: "harness", value: "docs.compose" },
      { kind: "forbidden_includes", values: ["telegram.message", "telegram.wait_reply"] },
    ],
    tags: ["browser", "telegram", "regression"],
  },
  {
    id: "14_essay_notepad_not_telegram",
    name: "Local essay → notepad, not Telegram",
    mode: "mock",
    input: "напиши реферат по криптографии",
    expected: [
      { kind: "harness", value: "notepad.compose" },
      { kind: "forbidden_includes", values: ["telegram.message", "telegram.wait_reply"] },
    ],
    tags: ["notepad", "telegram", "regression"],
  },
  {
    id: "15_open_notepad",
    name: "Open notepad ≠ browser/YouTube",
    mode: "mock",
    input: "открой блокнот",
    expected: [
      { kind: "harness", value: "notepad.compose" },
      { kind: "domain", value: "desktop" },
    ],
    tags: ["notepad", "regression"],
  },
  {
    id: "16_say_truth_not_messaging",
    name: "«скажи правду» ≠ Telegram contact",
    mode: "mock",
    input: "скажи правду",
    expected: [
      { kind: "domain", value: "general" },
      { kind: "harness", value: "llm_loop" },
    ],
    tags: ["regression"],
  },
  {
    id: "17_write_text_not_messaging",
    name: "«напиши текст» ≠ Telegram",
    mode: "mock",
    input: "напиши текст",
    expected: [
      { kind: "harness", value: "notepad.compose" },
      { kind: "forbidden_includes", values: ["telegram.message"] },
    ],
    tags: ["notepad", "regression"],
  },
  {
    id: "18_news_digest_pdf",
    name: "News digest → research.digest",
    mode: "mock",
    input: "собери новости мира и сделай pdf отчёт",
    expected: [
      { kind: "domain", value: "research" },
      { kind: "harness", value: "research.digest" },
      { kind: "forbidden_includes", values: ["telegram.message"] },
    ],
    tags: ["research", "pdf"],
  },
  {
    id: "18a_telegram_mom_conversation",
    name: "Telegram: маме привет и поговори с ней",
    mode: "mock",
    input: "напиши в телеграм маме привет и поговори с ней",
    expected: [
      { kind: "domain", value: "messaging" },
      { kind: "harness", value: "telegram_conversation" },
      { kind: "slot", key: "contact", value: "Мама" },
    ],
    tags: ["regression", "telegram"],
  },
  {
    id: "18b_news_azerbaijan",
    name: "Latest Azerbaijan news → research.digest",
    mode: "mock",
    input: "собери мне последние новости Азербайджана",
    expected: [
      { kind: "domain", value: "research" },
      { kind: "harness", value: "research.digest" },
      { kind: "forbidden_includes", values: ["telegram.message", "notepad.compose"] },
    ],
    tags: ["research", "pdf", "regression"],
  },
  {
    id: "19_presentation_html",
    name: "Presentation → HTML deck harness",
    mode: "mock",
    input: "сделай презентацию про криптографию",
    expected: [
      { kind: "harness", value: "presentation.create" },
      { kind: "forbidden_includes", values: ["telegram.message"] },
    ],
    tags: ["presentation"],
  },
  {
    id: "20_google_sheets",
    name: "Google Sheets route",
    mode: "mock",
    input: "создай таблицу в google sheets с расходами",
    expected: [
      { kind: "harness", value: "google.sheets" },
      { kind: "forbidden_includes", values: ["telegram.message"] },
    ],
    tags: ["google", "office"],
  },
  {
    id: "21_desktop_word",
    name: "Desktop Word office harness",
    mode: "mock",
    input: "напиши текст в word про криптографию",
    expected: [
      { kind: "harness", value: "desktop.office" },
      { kind: "domain", value: "desktop" },
    ],
    tags: ["office"],
  },
  {
    id: "22_google_slides",
    name: "Google Slides route",
    mode: "mock",
    input: "создай презентацию в google slides про AI",
    expected: [
      { kind: "harness", value: "google.slides" },
    ],
    tags: ["google", "presentation"],
  },
  {
    id: "23_app_install_not_notepad",
    name: "Download program ≠ notepad note",
    mode: "mock",
    input: "скачай мне notepad++",
    expected: [
      { kind: "harness", value: "app.install" },
      { kind: "domain", value: "desktop" },
      { kind: "forbidden_includes", values: ["notepad.compose", "telegram.message"] },
    ],
    tags: ["install", "notepad", "regression"],
  },
  {
    id: "24_app_install_with_program_word",
    name: "Download program (explicit программу) → app.install",
    mode: "mock",
    input: "скачай мне программу notepad++",
    expected: [
      { kind: "harness", value: "app.install" },
      { kind: "forbidden_includes", values: ["notepad.compose"] },
    ],
    tags: ["install", "regression"],
  },
  {
    id: "25_briefing_compose",
    name: "Morning briefing → briefing.compose",
    mode: "mock",
    input: "собери утренний брифинг по миру",
    expected: [
      { kind: "harness", value: "briefing.compose" },
      { kind: "domain", value: "research" },
    ],
    tags: ["briefing", "harness"],
  },
  {
    id: "26_mission_replay",
    name: "Replay yesterday mission",
    mode: "mock",
    input: "сделай как вчера",
    expected: [
      { kind: "harness", value: "mission.replay" },
    ],
    tags: ["replay", "harness"],
  },
  {
    id: "27_wait_owner",
    name: "Pause until owner reply",
    mode: "mock",
    input: "подожди мой ответ",
    expected: [
      { kind: "harness", value: "mission.wait_owner" },
    ],
    tags: ["wait", "harness"],
  },
];

export function listScenarios(filter?: { id?: string; tag?: string; live?: boolean }): EvalScenario[] {
  let list = [...BUILTIN_SCENARIOS];
  if (filter?.id) list = list.filter((s) => s.id === filter.id || s.id.startsWith(filter.id!));
  if (filter?.tag) list = list.filter((s) => s.tags?.includes(filter.tag!));
  if (!filter?.live) list = list.filter((s) => s.mode !== "live");
  return list;
}
