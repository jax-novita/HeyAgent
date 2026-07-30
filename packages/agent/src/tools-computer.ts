import type { ToolRegistry } from "./tools.js";
import {
  readFile,
  writeFile,
  listDirectory,
  runShell,
  openUrl,
  openApplication,
  notepadWrite,
  notepadType,
  setClipboard,
  getClipboard,
  keyboardHotkey,
  webSearch,
  webFetch,
  getWeather,
  formatSearchResults,
  gmailBrowserOpen,
  gmailBrowserCompose,
  gmailBrowserReply,
  gmailBrowserSendOpen,
  githubBrowseMission,
  wikipediaHopMission,
  redditOpenAiScrollMission,
  multiTabCompareMission,
  browserHardStop,
  browserHardRecover,
  browserWhatIsSelected,
  browserDismissPopupsMission,
  browserGetState,
  browserTourVerified,
  browserListTabs,
  browserFocusTab,
  browserClickText,
  browserReadPageText,
  browserUseOpenTab,
  getClockSnapshot,
  formatClockForHumans,
  youtubeOpenLessonMission,
} from "@heyagent/computer";

export function registerComputerTools(registry: ToolRegistry): void {
  registry.register({
    name: "clock.now",
    description:
      "Get the REAL current date/time from the OS clock (never guess). Optional: timezone, addMs/addMinutes/addHours for exact future/past times.",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description: "IANA timezone, e.g. Europe/Moscow. Defaults to system/config.",
        },
        addMs: { type: "number", description: "Add milliseconds to now" },
        addMinutes: { type: "number" },
        addHours: { type: "number" },
        addDays: { type: "number" },
      },
    },
    execute: async (args) => {
      const tz =
        typeof args.timezone === "string" && args.timezone.trim()
          ? args.timezone.trim()
          : undefined;
      const addMs =
        (Number(args.addMs) || 0) +
        (Number(args.addMinutes) || 0) * 60_000 +
        (Number(args.addHours) || 0) * 3_600_000 +
        (Number(args.addDays) || 0) * 86_400_000;
      const at = addMs ? new Date(Date.now() + addMs) : new Date();
      const snap = getClockSnapshot(tz, at);
      const lines = [formatClockForHumans(snap)];
      if (addMs) {
        lines.push("", `Offset from now: ${addMs} ms`);
        lines.push(`Base now: ${formatClockForHumans(getClockSnapshot(tz)).split("\n")[0]}`);
      }
      return lines.join("\n");
    },
  });

  registry.register({
    name: "file.read",
    description: "Read contents of a file at the given path",
    category: "computer",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    execute: async (args) => readFile(String(args.path ?? "")),
  });

  registry.register({
    name: "file.write",
    description: "Write content to a file at the given path",
    category: "computer",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
    execute: async (args) => {
      const path = String(args.path ?? "");
      const content = String(args.content ?? "");
      await writeFile(path, content);
      const { setLastFile } = await import("./memory.js");
      await setLastFile(path, content);
      return `Wrote ${content.length} bytes to ${path}`;
    },
  });

  registry.register({
    name: "file.list",
    description: "List files in a directory",
    category: "computer",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
    },
    execute: async (args) => (await listDirectory(String(args.path ?? "."))).join("\n"),
  });

  registry.register({
    name: "file.delete",
    description: "Delete a file at the given path",
    category: "computer",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    execute: async (args) => {
      const { deleteFile } = await import("@heyagent/computer");
      const path = String(args.path ?? "");
      await deleteFile(path);
      return `Deleted ${path}`;
    },
  });

  registry.register({
    name: "shell.exec",
    description: "Execute a shell/terminal command and return output",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeoutMs: {
          type: "number",
          description: "Timeout in milliseconds (default 60000, maximum 1200000)",
        },
      },
      required: ["command"],
    },
    execute: async (args) =>
      runShell(
        String(args.command ?? ""),
        undefined,
        Number.isFinite(Number(args.timeoutMs)) ? Number(args.timeoutMs) : undefined,
      ),
  });

  registry.register({
    name: "browser.open",
    description:
      "Open a NEW URL in the browser. FORBIDDEN when the owner says they already opened a page/tab («я открыл», «пройди этот тест») — use browser.tabs.list + browser.tabs.focus instead. Never open yandex.ru/dzen as a substitute for an open tab.",
    category: "computer",
    parameters: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
    execute: async (args) => {
      const url = String(args.url ?? "");
      await openUrl(url);
      return `Opened ${url}`;
    },
  });

  registry.register({
    name: "browser.tabs.list",
    description:
      "List ALL open browser tabs (title + URL) via CDP. ALWAYS call this FIRST when the owner says «я открыл …» / «на вкладке» / «пройди тест» before opening anything new.",
    category: "computer",
    parameters: {
      type: "object",
      properties: { browser: { type: "string" } },
    },
    execute: async (args) => {
      const raw = String(args.browser ?? "auto").toLowerCase();
      const browser =
        raw === "yandex" || raw === "chrome" || raw === "edge" ? raw : "auto";
      return browserListTabs(browser);
    },
  });

  registry.register({
    name: "browser.tabs.focus",
    description:
      "Focus an already-open tab by title/URL keywords or tab id. Does NOT open a new page. Prefer this over browser.open when the page is already open.",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Keywords from the tab title/URL, e.g. «тест математике» or onlinetestpad",
        },
        browser: { type: "string" },
      },
      required: ["query"],
    },
    execute: async (args) => {
      const raw = String(args.browser ?? "auto").toLowerCase();
      const browser =
        raw === "yandex" || raw === "chrome" || raw === "edge" ? raw : "auto";
      return browserFocusTab(String(args.query ?? ""), browser);
    },
  });

  registry.register({
    name: "browser.use_open_tab",
    description:
      "One-shot: list/match already-open tab by query, focus it, click Далее/Начать if present, return page text. Use when owner already opened a test/page.",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        browser: { type: "string" },
      },
      required: ["query"],
    },
    execute: async (args) => {
      const raw = String(args.browser ?? "auto").toLowerCase();
      const browser =
        raw === "yandex" || raw === "chrome" || raw === "edge" ? raw : "auto";
      return browserUseOpenTab(String(args.query ?? ""), browser);
    },
  });

  registry.register({
    name: "browser.click_text",
    description: "Click a visible button/link/label by its text on the current CDP page (e.g. «Далее»).",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string" },
        browser: { type: "string" },
      },
      required: ["text"],
    },
    execute: async (args) => {
      const raw = String(args.browser ?? "auto").toLowerCase();
      const browser =
        raw === "yandex" || raw === "chrome" || raw === "edge" ? raw : "auto";
      return browserClickText(String(args.text ?? ""), browser);
    },
  });

  registry.register({
    name: "browser.read_page",
    description: "Read URL, title and visible text of the current CDP page.",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        browser: { type: "string" },
        maxChars: { type: "number" },
      },
    },
    execute: async (args) => {
      const raw = String(args.browser ?? "auto").toLowerCase();
      const browser =
        raw === "yandex" || raw === "chrome" || raw === "edge" ? raw : "auto";
      return browserReadPageText(browser, Number(args.maxChars ?? 6000));
    },
  });

  registry.register({
    name: "web.search",
    description:
      "Search the web (DuckDuckGo). Use for facts, news, weather lookups when needed, docs, anything online.",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
    execute: async (args) => {
      const results = await webSearch(String(args.query ?? ""), Number(args.limit ?? 5));
      return formatSearchResults(results);
    },
  });

  registry.register({
    name: "web.fetch",
    description: "Fetch a URL and extract readable text/JSON for parsing",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
        maxChars: { type: "number" },
      },
      required: ["url"],
    },
    execute: async (args) =>
      webFetch(String(args.url ?? ""), Number(args.maxChars ?? 12000)),
  });

  registry.register({
    name: "weather.get",
    description: "Get current weather and short forecast for a city (wttr.in). Prefer this for weather questions.",
    category: "computer",
    parameters: {
      type: "object",
      properties: { location: { type: "string" } },
      required: ["location"],
    },
    execute: async (args) => getWeather(String(args.location ?? "Moscow")),
  });

  registry.register({
    name: "telegram.message",
    description:
      "Open Telegram Desktop on the PC and send a message to a contact by name via UI automation (search → chat → type → Enter). Use this when the user asks to write/send someone a Telegram message (e.g. 'напиши Ренату в телеграм привет'). Do NOT ask about bots — just do it.",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        contact: { type: "string", description: "Contact name as shown in Telegram, e.g. Ренат" },
        message: { type: "string", description: "Message text to send" },
      },
      required: ["contact", "message"],
    },
    execute: async (args) => {
      const { telegramSendUi } = await import("@heyagent/computer");
      const contact = String(args.contact ?? "");
      const message = String(args.message ?? "");
      const result = await telegramSendUi(contact, message);
      const { loadMemory, appendMissionTurn } = await import("./memory.js");
      const mem = await loadMemory();
      if (
        mem.activeMission?.status === "active" &&
        mem.activeMission.contact.toLowerCase() === contact.trim().toLowerCase()
      ) {
        await appendMissionTurn("agent", message);
      }
      return result;
    },
  });

  registry.register({
    name: "telegram.wait_reply",
    description:
      "WAIT for a Telegram contact to reply, then return a screenshot so you can READ their new message. Use this after telegram.message when you must hold a conversation until goodbye. Keep calling it (patiently — even for a long time) until the contact answers or the end phrase appears. NEVER ask the owner to forward the contact's messages — read them yourself from the screen.",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        contact: { type: "string", description: "Contact name whose reply you await" },
        maxWaitSeconds: {
          type: "number",
          description: "Max seconds to wait in THIS call before returning (default 180). Call again to keep waiting.",
        },
      },
      required: ["contact"],
    },
    execute: async (args) => {
      const { telegramWaitForReply } = await import("@heyagent/computer");
      const contact = String(args.contact ?? "");
      const maxWaitSeconds =
        typeof args.maxWaitSeconds === "number" ? args.maxWaitSeconds : undefined;
      return telegramWaitForReply(contact, { maxWaitSeconds });
    },
  });

  registry.register({
    name: "app.open",
    description:
      "Open a desktop application. Accepts casual names: 'Visual Studio Code', vscode, code, chrome, edge, yandex, telegram, notepad, calc, cursor. Resolves real install paths on Windows.",
    category: "computer",
    parameters: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
    execute: async (args) => openApplication(String(args.name ?? "notepad")),
  });

  registry.register({
    name: "notepad.write",
    description:
      "Create a text file and open it in Notepad. content MUST match the owner's genre/topic exactly: «рассказ» = prose story (NOT a poem/rhyme); «стих» = poem. Title from the topic. Prefer destination=desktop when saving for the user.",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description:
            "Full text. If owner asked for a story (рассказ) — write prose paragraphs about that topic, never a short rhyme.",
        },
        title: {
          type: "string",
          description:
            "File name without extension from the TOPIC (e.g. rasskaz_o_malchike). NEVER «стишок» unless they asked for a poem.",
        },
        destination: {
          type: "string",
          description:
            "Where to save: 'desktop' | 'documents' | 'downloads' | a folder path | a full .txt path. Omit for temp.",
        },
      },
      required: ["content"],
    },
    execute: async (args) => {
      const content = String(args.content ?? "");
      const result = await notepadWrite(
        content,
        String(args.title ?? "heyagent-note"),
        args.destination ? String(args.destination) : undefined,
      );
      const pathMatch = result.match(/path:\s*(.+?)\s*(?:\(|$)/i);
      const { setLastNotepad } = await import("./memory.js");
      if (pathMatch) await setLastNotepad(pathMatch[1].trim(), content);
      return result;
    },
  });

  registry.register({
    name: "notepad.type",
    description:
      "DEPRECATED / unreliable: opens empty Notepad and types via keyboard (can drop characters, does NOT save). Prefer notepad.write. Only use if the user explicitly wants live typing without saving.",
    category: "computer",
    parameters: {
      type: "object",
      properties: { content: { type: "string" } },
      required: ["content"],
    },
    execute: async (args) => {
      const content = String(args.content ?? "");
      const result = await notepadType(content);
      const { setLastNotepad } = await import("./memory.js");
      await setLastNotepad("(unsaved notepad buffer)", content);
      return `${result}. WARNING: this is NOT saved to a file and typing may be unreliable. Do not claim it was saved.`;
    },
  });

  registry.register({
    name: "clipboard.set",
    description: "Copy text to the system clipboard",
    category: "computer",
    parameters: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
    execute: async (args) => {
      await setClipboard(String(args.text ?? ""));
      return "Copied to clipboard";
    },
  });

  registry.register({
    name: "clipboard.get",
    description: "Read text from the system clipboard",
    category: "computer",
    parameters: { type: "object", properties: {} },
    execute: async () => getClipboard(),
  });

  registry.register({
    name: "computer.screenshot",
    description:
      "Capture screenshot (also attaches vision like screen.see). Prefer screen.see for UI work.",
    category: "computer",
    parameters: { type: "object", properties: {} },
    execute: async () => {
      const { captureScreenVision, formatVisionToolResult } = await import("@heyagent/computer");
      const shot = await captureScreenVision(1280);
      return formatVisionToolResult(shot, "Screenshot captured (vision attached).");
    },
  });

  registry.register({
    name: "computer.click",
    description: "Click at screen coordinates x,y",
    category: "computer",
    parameters: {
      type: "object",
      properties: { x: { type: "number" }, y: { type: "number" } },
      required: ["x", "y"],
    },
    execute: async (args) => {
      const { mouseClick } = await import("@heyagent/computer");
      const x = Number(args.x ?? 0);
      const y = Number(args.y ?? 0);
      await mouseClick(x, y);
      return `Clicked at (${x}, ${y})`;
    },
  });

  registry.register({
    name: "computer.type",
    description: "Type text into the focused window via keyboard/clipboard paste",
    category: "computer",
    parameters: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
    execute: async (args) => {
      const { keyboardType } = await import("@heyagent/computer");
      const text = String(args.text ?? "");
      await keyboardType(text);
      return `Typed ${text.length} characters`;
    },
  });

  registry.register({
    name: "computer.hotkey",
    description: "Send a hotkey combo like ctrl+s, alt+f4, enter",
    category: "computer",
    parameters: {
      type: "object",
      properties: { keys: { type: "string" } },
      required: ["keys"],
    },
    execute: async (args) => {
      await keyboardHotkey(String(args.keys ?? "enter"));
      return `Sent hotkey ${args.keys}`;
    },
  });

  registry.register({
    name: "gmail.browser.open",
    description:
      "Open Gmail inbox in a NEW browser tab. Prefer browser=yandex when user says «в яндексе» (separate accounts). Also chrome|edge|auto.",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        browser: {
          type: "string",
          description: "yandex | chrome | edge | auto (default: Yandex first)",
        },
      },
    },
    execute: async (args) => {
      const raw = String(args.browser ?? "auto").toLowerCase();
      const browser =
        raw === "yandex" || raw === "chrome" || raw === "edge" ? raw : "auto";
      return gmailBrowserOpen({ browser });
    },
  });

  registry.register({
    name: "gmail.browser.compose",
    description:
      "Open Gmail compose in a new tab with To/Subject/Body filled. Use for «напиши письмо». browser=yandex|chrome|edge|auto. Set send=true to send immediately.",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
        send: { type: "boolean", description: "true = send now" },
        browser: { type: "string" },
      },
      required: ["to"],
    },
    execute: async (args) => {
      const raw = String(args.browser ?? "auto").toLowerCase();
      const browser =
        raw === "yandex" || raw === "chrome" || raw === "edge" ? raw : "auto";
      return gmailBrowserCompose({
        to: String(args.to ?? ""),
        subject: args.subject ? String(args.subject) : undefined,
        body: args.body ? String(args.body) : undefined,
        send: Boolean(args.send),
        browser,
      });
    },
  });

  registry.register({
    name: "gmail.browser.reply",
    description:
      "Reply in Gmail UI (shortcut r). Prefer browser=yandex when asked. Set send=true to send.",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        body: { type: "string" },
        send: { type: "boolean" },
        openInboxFirst: { type: "boolean" },
        browser: { type: "string" },
      },
      required: ["body"],
    },
    execute: async (args) => {
      const raw = String(args.browser ?? "auto").toLowerCase();
      const browser =
        raw === "yandex" || raw === "chrome" || raw === "edge" ? raw : "auto";
      return gmailBrowserReply({
        body: String(args.body ?? ""),
        send: Boolean(args.send),
        openInboxFirst: args.openInboxFirst !== false,
        browser,
      });
    },
  });

  registry.register({
    name: "gmail.browser.send",
    description: "Send the currently open Gmail compose/reply with Ctrl+Enter. Use for «отправь».",
    category: "computer",
    parameters: {
      type: "object",
      properties: { browser: { type: "string" } },
    },
    execute: async (args) => {
      const raw = String(args.browser ?? "auto").toLowerCase();
      const browser =
        raw === "yandex" || raw === "chrome" || raw === "edge" ? raw : "auto";
      return gmailBrowserSendOpen({ browser });
    },
  });

  registry.register({
    name: "github.browse.mission",
    description:
      "Multi-step GitHub walkthrough in ONE browser tab (no tab spam): repo → most-commented issue → author → top repos page → back to issue. Use for github exploration missions.",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        repo: {
          type: "string",
          description: "owner/name, default microsoft/TypeScript",
        },
        browser: { type: "string", description: "yandex|chrome|edge|auto" },
        openBrowser: {
          type: "boolean",
          description: "false = API-only report without opening tabs",
        },
      },
    },
    execute: async (args) => {
      const raw = String(args.browser ?? "auto").toLowerCase();
      const browser =
        raw === "yandex" || raw === "chrome" || raw === "edge" ? raw : "auto";
      return githubBrowseMission({
        repo: args.repo ? String(args.repo) : "microsoft/TypeScript",
        browser,
        openBrowser: args.openBrowser !== false,
      });
    },
  });

  registry.register({
    name: "browser.tour",
    description:
      "Open a sequence of URLs in ONE CDP tab with URL verification after each hop. Prefer this over opening many tabs.",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: { type: "string" },
          description: "Ordered list of URLs to visit in one tab",
        },
        browser: { type: "string" },
      },
      required: ["urls"],
    },
    execute: async (args) => {
      const raw = String(args.browser ?? "auto").toLowerCase();
      const browser =
        raw === "yandex" || raw === "chrome" || raw === "edge" ? raw : "auto";
      const urls = Array.isArray(args.urls)
        ? args.urls.map((u) => String(u))
        : String(args.urls ?? "")
            .split(/\s+/)
            .filter(Boolean);
      return browserTourVerified(urls, browser);
    },
  });

  registry.register({
    name: "youtube.open.lesson",
    description:
      "Open a YouTube video from search. Default QUICK: open the FIRST matching organic result (skip ads/Shorts only) — do NOT dig/scroll past a good top hit. Deep mode only for урок/курс/tutorial.",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search topic, e.g. дым сигарет с ментолом" },
        browser: { type: "string" },
        minMinutes: {
          type: "number",
          description: "Prefer videos at least this long (deep mode; quick default 0)",
        },
        skipTop: {
          type: "number",
          description: "Skip N top organic results (deep only; default 0 — open first match)",
        },
        mode: {
          type: "string",
          description: "quick | deep. Omit to auto-detect from query.",
        },
      },
      required: ["query"],
    },
    execute: async (args) => {
      const raw = String(args.browser ?? "yandex").toLowerCase();
      const browser =
        raw === "yandex" || raw === "chrome" || raw === "edge" ? raw : "yandex";
      const modeRaw = String(args.mode ?? "").toLowerCase();
      const mode = modeRaw === "deep" || modeRaw === "quick" ? modeRaw : undefined;
      return youtubeOpenLessonMission({
        query: String(args.query ?? ""),
        browser,
        mode,
        minMinutes: args.minMinutes != null ? Number(args.minMinutes) : undefined,
        skipTop: args.skipTop != null ? Number(args.skipTop) : 0,
      });
    },
  });

  registry.register({
    name: "browser.wikipedia.hops",
    description:
      "Wikipedia stress test: open Wikipedia and click the first article link N times (default 100). Reports final page. Checks context/state memory.",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        hops: { type: "number" },
        start: { type: "string" },
        browser: { type: "string" },
      },
    },
    execute: async (args) => {
      const raw = String(args.browser ?? "auto").toLowerCase();
      const browser =
        raw === "yandex" || raw === "chrome" || raw === "edge" ? raw : "auto";
      return wikipediaHopMission({
        hops: Number(args.hops ?? 100),
        start: args.start ? String(args.start) : undefined,
        browser,
      });
    },
  });

  registry.register({
    name: "browser.reddit.scroll",
    description:
      "Scroll Reddit looking for an OpenAI post with high upvotes. Stops honestly on CAPTCHA. Infinite-scroll test.",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        minScore: { type: "number" },
        maxScrolls: { type: "number" },
        browser: { type: "string" },
      },
    },
    execute: async (args) => {
      const raw = String(args.browser ?? "auto").toLowerCase();
      const browser =
        raw === "yandex" || raw === "chrome" || raw === "edge" ? raw : "auto";
      return redditOpenAiScrollMission({
        minScore: Number(args.minScore ?? 1000),
        maxScrolls: Number(args.maxScrolls ?? 40),
        browser,
      });
    },
  });

  registry.register({
    name: "browser.tabs.compare",
    description:
      "Open GitHub + Reddit + Hacker News about a query in separate tabs and compare discussion snippets.",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        browser: { type: "string" },
      },
    },
    execute: async (args) => {
      const raw = String(args.browser ?? "auto").toLowerCase();
      const browser =
        raw === "yandex" || raw === "chrome" || raw === "edge" ? raw : "auto";
      return multiTabCompareMission({
        query: args.query ? String(args.query) : "TypeScript",
        browser,
      });
    },
  });

  registry.register({
    name: "browser.mission.stop",
    description: "Cancel an in-progress hard browser mission (Wikipedia hops / reddit scroll / tour).",
    category: "computer",
    parameters: { type: "object", properties: {} },
    execute: async () => browserHardStop(),
  });

  registry.register({
    name: "browser.mission.recover",
    description: "Relaunch CDP browser and resume last saved URL after crash/kill.",
    category: "computer",
    parameters: {
      type: "object",
      properties: { browser: { type: "string" } },
    },
    execute: async (args) => {
      const raw = String(args.browser ?? "auto").toLowerCase();
      const browser =
        raw === "yandex" || raw === "chrome" || raw === "edge" ? raw : "auto";
      return browserHardRecover(browser);
    },
  });

  registry.register({
    name: "browser.page.state",
    description:
      "Read current page URL/title and detect CAPTCHA/login blockers. Use to verify you are where you think you are.",
    category: "computer",
    parameters: {
      type: "object",
      properties: { browser: { type: "string" } },
    },
    execute: async (args) => {
      const raw = String(args.browser ?? "auto").toLowerCase();
      const browser =
        raw === "yandex" || raw === "chrome" || raw === "edge" ? raw : "auto";
      const st = await browserGetState(browser);
      return JSON.stringify(st, null, 2);
    },
  });

  registry.register({
    name: "browser.what_selected",
    description:
      "Honestly report which element is focused on the page. If unknown — say so, never invent.",
    category: "computer",
    parameters: {
      type: "object",
      properties: { browser: { type: "string" } },
    },
    execute: async (args) => {
      const raw = String(args.browser ?? "auto").toLowerCase();
      const browser =
        raw === "yandex" || raw === "chrome" || raw === "edge" ? raw : "auto";
      return browserWhatIsSelected(browser);
    },
  });

  registry.register({
    name: "browser.dismiss_popups",
    description: "Try to close cookie banners / modal dialogs on the current page.",
    category: "computer",
    parameters: {
      type: "object",
      properties: { browser: { type: "string" } },
    },
    execute: async (args) => {
      const raw = String(args.browser ?? "auto").toLowerCase();
      const browser =
        raw === "yandex" || raw === "chrome" || raw === "edge" ? raw : "auto";
      return browserDismissPopupsMission(browser);
    },
  });
}
