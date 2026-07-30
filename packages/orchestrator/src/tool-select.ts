/**
 * Deterministic tool selection by domain / plan step.
 * Soft prefer (prompt order) + hard forbid only for catastrophic channel mismatches.
 */
import type { Domain, Plan, PlanStep, RouteDecision, StepKind } from "./types.js";

export interface ToolSelection {
  preferred: string[];
  forbidden: string[];
  /** Short guidance for the system prompt */
  guidance: string;
  /** Ordered plan summary for continuity */
  planBlock: string;
}

const TELEGRAM = ["telegram.message", "telegram.wait_reply", "telegram.file", "app.open"];
const BROWSER = [
  "browser.tabs.list",
  "browser.tabs.focus",
  "browser.use_open_tab",
  "browser.read_page",
  "browser.click_text",
  "browser.open",
  "browser.page_state",
  "browser.page.state",
  "desktop.see_and_click",
  "screen.see",
];
const MAIL = ["gmail.browser.open", "gmail.browser.compose", "gmail.browser.reply", "gmail.browser.send"];
const SYSTEM = ["system.control", "system.empty_recycle_bin", "system.set_volume", "shell.exec"];
const DESKTOP = [
  "screen.see",
  "desktop.see_and_click",
  "computer.click",
  "computer.type",
  "computer.hotkey",
  "computer.screenshot",
  "app.open",
  "app.search",
  "app.install",
];
const FILES = ["file.read", "file.write", "file.list", "notepad.write", "notepad.type", "shell.exec"];
const DOCS = ["google.docs.write", "google.docs.read", "browser.open"];

/** Broad computer tool surface — general / llm_loop missions get full access. */
export const FULL_COMPUTER_TOOLS = [
  ...DESKTOP,
  ...FILES,
  ...BROWSER,
  ...MAIL,
  ...SYSTEM,
  "web.search",
  "web.fetch",
  "web.analyze",
  "web.links",
  "report.write",
  "file.download",
  "clipboard.get",
  "clipboard.set",
  "google.docs.read",
  "google.docs.write",
  "google.drive.search",
  "google.sheets.create",
  "google.slides.create",
  "office.desktop.write",
  "presentation.create",
  "youtube.open_lesson",
  "image.edit",
  "memory.remember",
  "memory.search",
  "clock.now",
] as const;

const SOFT_HARNESS_HINTS = new Set(["llm_loop", "desktop", "browser", "coder", "research", "general"]);

function mergePreferred(primary: string[], includeFull = true): string[] {
  if (!includeFull) return [...new Set(primary)];
  return [...new Set([...primary, ...FULL_COMPUTER_TOOLS])];
}

export function hasHardHarnessSlot(slots: Record<string, string>): boolean {
  return Boolean(
    slots.openTab ||
      slots.googleDocs ||
      slots.composeDoc ||
      slots.appInstall ||
      slots.reportPdf ||
      slots.googleSheets ||
      slots.googleSlides ||
      slots.quizContinue ||
      slots.tabQuery,
  );
}

export function preferredToolsForDomain(
  domain: Domain,
  stepKind?: StepKind,
  slots?: Record<string, string>,
): string[] {
  const harness = slots?.harness;

  if (harness === "docs.compose" || slots?.googleDocs === "1") {
    return mergePreferred(DOCS, false);
  }
  if (harness === "google.sheets" || slots?.googleSheets === "1") {
    return mergePreferred(["google.sheets.create", "google.drive.search", "browser.open"]);
  }
  if (harness === "google.slides" || slots?.googleSlides === "1") {
    return mergePreferred(["google.slides.create", "presentation.create", "browser.open"]);
  }
  if (harness === "research.digest" || slots?.reportPdf === "1") {
    return mergePreferred(["web.search", "web.analyze", "web.fetch", "report.write", "file.write"]);
  }
  if (harness === "presentation.create") {
    return mergePreferred(["presentation.create", "google.slides.create", "file.write"]);
  }
  if (harness === "desktop.office") {
    return mergePreferred(["office.desktop.write", "notepad.write", "file.write", ...DESKTOP]);
  }
  if (harness === "app.install" || slots?.appInstall === "1") {
    return mergePreferred(["app.search", "app.install", "file.download", "shell.exec"]);
  }
  if (harness === "notepad.compose" || slots?.composeDoc === "1") {
    return mergePreferred([...FILES, ...DESKTOP]);
  }
  if (harness === "youtube.open.lesson") {
    return mergePreferred(["youtube.open_lesson", ...BROWSER, "screen.see"]);
  }
  if (harness === "open_tab") {
    return mergePreferred(BROWSER);
  }

  if (harness && SOFT_HARNESS_HINTS.has(harness) && !hasHardHarnessSlot(slots ?? {})) {
    return [...FULL_COMPUTER_TOOLS];
  }

  switch (domain) {
    case "messaging":
      return mergePreferred([...TELEGRAM, "screen.see"], false);
    case "mail":
      return mergePreferred([...MAIL, "browser.open", "screen.see"], false);
    case "browser":
      if (stepKind === "browser_open_and_verify") return mergePreferred(BROWSER);
      return mergePreferred([...BROWSER, "screen.see"]);
    case "system":
      return mergePreferred(SYSTEM, false);
    case "desktop":
      return mergePreferred(slots?.composeDoc === "1" ? [...FILES, ...DESKTOP] : [...DESKTOP, ...FILES]);
    case "coder":
      return mergePreferred([...FILES, "shell.exec"]);
    case "research":
      return mergePreferred([
        "web.search",
        "web.fetch",
        "web.analyze",
        "report.write",
        "file.write",
        "browser.open",
      ]);
    default:
      return [...FULL_COMPUTER_TOOLS];
  }
}

export function forbiddenToolsForRoute(route: RouteDecision): string[] {
  const forbid: string[] = [];
  const harness = route.slots.harness;
  const slots = route.slots;

  // Quiz / open tab — never Telegram (catastrophic: «пройди тест» → messenger)
  if (slots.openTab === "1" || harness === "open_tab" || slots.quizContinue === "1") {
    forbid.push("telegram.message", "telegram.wait_reply", "telegram.file");
  }

  // Google Docs — no Telegram / YouTube confusion
  if (slots.googleDocs === "1" || harness === "docs.compose") {
    forbid.push(
      "telegram.message",
      "telegram.wait_reply",
      "telegram.file",
      "youtube.open_lesson",
      "screen.see",
      "computer.click",
      "computer.type",
      "desktop.see_and_click",
    );
  }

  // Local compose / notepad — no Telegram
  if (harness === "notepad.compose" || slots.composeDoc === "1") {
    forbid.push("telegram.message", "telegram.wait_reply", "telegram.file");
  }

  // Install program — not notepad compose; not Telegram
  if (harness === "app.install" || slots.appInstall === "1") {
    forbid.push("notepad.write", "notepad.compose", "telegram.message", "telegram.wait_reply");
  }

  // Dedicated harness channel locks (not blanket desktop/browser)
  if (harness === "youtube.open.lesson") {
    forbid.push("telegram.message", "telegram.wait_reply", "telegram.file");
  }
  if (harness === "research.digest" || slots.reportPdf === "1") {
    forbid.push(
      "telegram.message",
      "telegram.wait_reply",
      "telegram.file",
      "notepad.write",
      "notepad.compose",
    );
  }
  if (harness === "presentation.create") {
    forbid.push("telegram.message", "telegram.wait_reply");
  }
  if (harness === "google.sheets" || harness === "google.slides") {
    forbid.push("telegram.message", "telegram.wait_reply");
  }
  if (harness === "desktop.office") {
    forbid.push("telegram.message", "telegram.wait_reply");
  }

  // Browser missions (incl. llm_loop «открой сайт») — no Telegram
  if (route.domain === "browser") {
    forbid.push("telegram.message", "telegram.wait_reply", "telegram.file");
  }

  // Domain channel isolation
  if (route.domain === "messaging") {
    forbid.push(
      "gmail.browser.open",
      "gmail.browser.compose",
      "gmail.browser.reply",
      "gmail.browser.send",
    );
  }
  if (route.domain === "mail") {
    forbid.push("telegram.message", "telegram.wait_reply", "telegram.file");
  }
  if (route.domain === "system") {
    forbid.push("telegram.message", "gmail.browser.send");
  }

  return [...new Set(forbid)];
}

export function buildToolSelection(
  route: RouteDecision,
  plan: Plan,
  currentStep?: PlanStep | null,
): ToolSelection {
  const preferred = preferredToolsForDomain(route.domain, currentStep?.kind, route.slots);
  const forbidden = forbiddenToolsForRoute(route);
  const next = currentStep || plan.steps.find((s) => s.status === "pending");
  const done = plan.steps.filter((s) => s.status === "done").map((s) => s.kind);
  const pending = plan.steps.filter((s) => s.status === "pending").map((s) => `${s.kind}:${s.title}`);

  const planBlock = [
    "### ACTIVE PLAN (do not lose state — follow in order)",
    `Mission domain: ${route.domain} | reason: ${route.reason}`,
    `Plan id: ${plan.id}`,
    done.length ? `Done: ${done.join(" → ")}` : "Done: (none)",
    next
      ? `NEXT STEP: [${next.kind}] ${next.title}${next.verify ? ` (verify=${next.verify})` : ""}`
      : "NEXT STEP: (plan complete — finish and report)",
    pending.length > 1 ? `Remaining: ${pending.slice(0, 6).join(" | ")}` : "",
    preferred.length
      ? `Suggested tools (full computer access available): ${preferred.slice(0, 14).join(", ")}…`
      : "",
    forbidden.length ? `Hard-blocked tools (channel mismatch only): ${forbidden.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const guidance = [
    "Tool access:",
    "- You have broad access to this PC — screen, shell, files, browser, apps, office, web.",
    "- Suggested tools fit the NEXT STEP; use any non-blocked tool when needed.",
    "- Never call hard-blocked tools (channel mismatch).",
    "- After web.search: fetch/open/analyze results — do not stop at search alone.",
    "- After each tool: check result. On ERROR → retry with a different approach, then continue.",
    "- DONE only with evidence (path, URL, tool output) or a named blocker (CAPTCHA/login/payment).",
    "- Keep working memory: step, last URL/contact/path from tool results.",
  ].join("\n");

  return { preferred, forbidden, guidance, planBlock };
}

/** Reorder tools: preferred first; drop only hard-forbidden. */
export function applyToolSelection<T extends { name: string }>(
  tools: T[],
  selection: ToolSelection,
): T[] {
  const forbid = new Set(selection.forbidden);
  const pref = selection.preferred;
  const allowed = tools.filter((t) => !forbid.has(t.name));
  const rank = (name: string) => {
    const i = pref.indexOf(name);
    return i === -1 ? 1000 : i;
  };
  return [...allowed].sort((a, b) => rank(a.name) - rank(b.name));
}
