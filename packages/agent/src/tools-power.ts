import type { ToolRegistry } from "./tools.js";
import {
  systemInfo,
  fileExists,
  fileInfo,
  fileCopy,
  fileMove,
  fileMkdir,
  fileEdit,
  fileFind,
  downloadFile,
  httpRequest,
  zipCreate,
  zipExtract,
  processList,
  processKill,
  applicationSearch,
  applicationInstall,
  applicationUninstall,
  windowList,
  windowFocus,
  writeReport,
  codeRun,
  waitMs,
  openPath,
  emptyRecycleBin,
  gitStatus,
  gitDiff,
  desktopPath,
  downloadsPath,
  webAnalyze,
  webLinks,
  telegramSendFileUi,
  telegramSendDocumentBot,
  telegramSendPhotoBot,
  telegramNotifyOwner,
  adminStatusReport,
  runElevatedCommand,
  setWallpaper,
  openWindowsSettings,
  updateDrivers,
  editImage,
  setVolume,
  getVolume,
  setBrightness,
  getDisplayModes,
  setRefreshRate,
  setMobileHotspot,
  systemControl,
  systemControlHelp,
  validateSystemControlParams,
} from "@heyagent/computer";

export function registerPowerTools(registry: ToolRegistry): void {
  registry.register({
    name: "app.search",
    description:
      "Search installable applications/packages via winget/choco/scoop (Windows), brew, or apt.",
    category: "computer",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    execute: async (args) => applicationSearch(String(args.query ?? "")),
  });

  registry.register({
    name: "app.install",
    description:
      "Install a program autonomously and verify installation. Windows: winget/choco/scoop; macOS: brew; Linux: apt. Use for «установи программу». If package ID is known, set exact=true.",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        package: { type: "string", description: "Program name or package ID" },
        exact: { type: "boolean", description: "Treat package as an exact ID/name" },
      },
      required: ["package"],
    },
    execute: async (args) =>
      applicationInstall(String(args.package ?? ""), Boolean(args.exact)),
  });

  registry.register({
    name: "app.uninstall",
    description: "Uninstall a program/package by name or ID.",
    category: "computer",
    parameters: {
      type: "object",
      properties: { package: { type: "string" } },
      required: ["package"],
    },
    execute: async (args) => applicationUninstall(String(args.package ?? "")),
  });

  registry.register({
    name: "system.info",
    description: "OS, paths (Desktop/Downloads/Documents), memory, hostname — use to resolve Desktop paths",
    category: "computer",
    parameters: { type: "object", properties: {} },
    execute: async () => systemInfo(),
  });

  registry.register({
    name: "system.empty_recycle_bin",
    description:
      "Empty Windows Recycle Bin / macOS Trash / Linux trash. For «очисти корзину». Real OS API — do not refuse or only offer to open the bin.",
    category: "computer",
    parameters: { type: "object", properties: {} },
    execute: async () => emptyRecycleBin(),
  });

  registry.register({
    name: "system.admin_status",
    description: "Check if HeyAgent is running as Windows Administrator / elevated.",
    category: "computer",
    parameters: { type: "object", properties: {} },
    execute: async () => adminStatusReport(),
  });

  registry.register({
    name: "shell.exec_elevated",
    description:
      "Run a PowerShell/shell command with UAC elevation (admin). Use for drivers, system settings that need admin.",
    category: "computer",
    parameters: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    },
    execute: async (args) => runElevatedCommand(String(args.command ?? "")),
  });

  registry.register({
    name: "system.set_wallpaper",
    description: "Set desktop wallpaper from an image file path. «поставь обои».",
    category: "computer",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    execute: async (args) => setWallpaper(String(args.path ?? "")),
  });

  registry.register({
    name: "system.open_settings",
    description:
      "Open Windows Settings page: display, wallpaper, network, update, apps, bluetooth, sound, personalization, etc.",
    category: "computer",
    parameters: {
      type: "object",
      properties: { page: { type: "string" } },
    },
    execute: async (args) => openWindowsSettings(String(args.page ?? "")),
  });

  registry.register({
    name: "system.update_drivers",
    description:
      "Kick off Windows Update / driver update scan (elevated best-effort). «обнови драйвера».",
    category: "computer",
    parameters: { type: "object", properties: {} },
    execute: async () => updateDrivers(),
  });

  registry.register({
    name: "image.edit",
    description:
      "Edit an image file: rotate90|rotate180|rotate270|resize:WxH|grayscale|copy. Saves edited copy.",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        op: { type: "string" },
        outputPath: { type: "string" },
      },
      required: ["path"],
    },
    execute: async (args) =>
      editImage(String(args.path ?? ""), {
        op: args.op ? String(args.op) : undefined,
        outputPath: args.outputPath ? String(args.outputPath) : undefined,
      }),
  });

  registry.register({
    name: "system.set_volume",
    description: "Set master Windows volume 0–100. Optional mute true/false. «громкость 30», «выключи звук».",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        level: { type: "number" },
        mute: { type: "boolean" },
      },
      required: ["level"],
    },
    execute: async (args) =>
      setVolume(Number(args.level ?? 50), args.mute === undefined ? undefined : Boolean(args.mute)),
  });

  registry.register({
    name: "system.get_volume",
    description: "Get current master volume and mute state.",
    category: "computer",
    parameters: { type: "object", properties: {} },
    execute: async () => getVolume(),
  });

  registry.register({
    name: "system.set_brightness",
    description: "Set display brightness 0–100 (WMI; works on most laptops).",
    category: "computer",
    parameters: {
      type: "object",
      properties: { level: { type: "number" } },
      required: ["level"],
    },
    execute: async (args) => setBrightness(Number(args.level ?? 50)),
  });

  registry.register({
    name: "system.get_display_modes",
    description: "List current resolution/Hz and available display modes.",
    category: "computer",
    parameters: { type: "object", properties: {} },
    execute: async () => getDisplayModes(),
  });

  registry.register({
    name: "system.set_refresh_rate",
    description:
      "Set monitor refresh rate in Hz (герцовка). Optional width/height. Use get_display_modes first.",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        hz: { type: "number" },
        width: { type: "number" },
        height: { type: "number" },
      },
      required: ["hz"],
    },
    execute: async (args) =>
      setRefreshRate(
        Number(args.hz),
        args.width != null ? Number(args.width) : undefined,
        args.height != null ? Number(args.height) : undefined,
      ),
  });

  registry.register({
    name: "system.set_hotspot",
    description:
      "Enable/disable Windows Mobile Hotspot. Optional ssid/password. «включи хотспот».",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        enable: { type: "boolean" },
        ssid: { type: "string" },
        password: { type: "string" },
      },
      required: ["enable"],
    },
    execute: async (args) =>
      setMobileHotspot(
        Boolean(args.enable),
        args.ssid ? String(args.ssid) : undefined,
        args.password ? String(args.password) : undefined,
      ),
  });

  registry.register({
    name: "system.control",
    description:
      "UNIVERSAL PC control. Use for ANY system request: volume, brightness, Hz, resolution, Wi‑Fi, Bluetooth, hotspot, airplane, lock/sleep/shutdown/restart, theme, night light, wallpaper, recycle bin, temp clean, disk space, battery, clipboard, notifications, drivers, task manager, settings, media keys, etc. Pass action=… (see system.controls_help). Prefer this over inventing shell hacks.",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string" },
        level: { type: "number" },
        delta: { type: "number" },
        mute: { type: "boolean" },
        hz: { type: "number" },
        width: { type: "number" },
        height: { type: "number" },
        enable: { type: "boolean" },
        path: { type: "string" },
        page: { type: "string" },
        ssid: { type: "string" },
        password: { type: "string" },
        text: { type: "string" },
        theme: { type: "string" },
        mode: { type: "string" },
        command: { type: "string" },
        seconds: { type: "number" },
      },
      required: ["action"],
    },
    execute: async (args) => {
      const parsed = validateSystemControlParams({
        action: String(args.action ?? "help"),
        level: args.level != null ? Number(args.level) : undefined,
        delta: args.delta != null ? Number(args.delta) : undefined,
        mute: args.mute === undefined ? undefined : Boolean(args.mute),
        hz: args.hz != null ? Number(args.hz) : undefined,
        width: args.width != null ? Number(args.width) : undefined,
        height: args.height != null ? Number(args.height) : undefined,
        enable: args.enable === undefined ? undefined : Boolean(args.enable),
        path: args.path != null ? String(args.path) : undefined,
        page: args.page != null ? String(args.page) : undefined,
        ssid: args.ssid != null ? String(args.ssid) : undefined,
        password: args.password != null ? String(args.password) : undefined,
        text: args.text != null ? String(args.text) : undefined,
        theme: args.theme === "light" ? "light" : args.theme === "dark" ? "dark" : undefined,
        mode: args.mode != null ? String(args.mode) : undefined,
        command: args.command != null ? String(args.command) : undefined,
        seconds: args.seconds != null ? Number(args.seconds) : undefined,
      });
      if (!parsed.ok) {
        return `ERROR: ${parsed.error} (${parsed.reason})`;
      }
      return systemControl(parsed.value);
    },
  });

  registry.register({
    name: "system.controls_help",
    description: "List ALL PC control actions for system.control.",
    category: "computer",
    parameters: { type: "object", properties: {} },
    execute: async () => systemControlHelp(),
  });

  registry.register({
    name: "file.exists",
    description: "Check if a path exists",
    category: "computer",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    execute: async (args) =>
      (await fileExists(String(args.path ?? ""))) ? "exists: true" : "exists: false",
  });

  registry.register({
    name: "file.info",
    description: "File/dir metadata: size, mtime, type",
    category: "computer",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    execute: async (args) => fileInfo(String(args.path ?? "")),
  });

  registry.register({
    name: "file.copy",
    description: "Copy a file to a new path",
    category: "computer",
    parameters: {
      type: "object",
      properties: { src: { type: "string" }, dest: { type: "string" } },
      required: ["src", "dest"],
    },
    execute: async (args) => fileCopy(String(args.src ?? ""), String(args.dest ?? "")),
  });

  registry.register({
    name: "file.move",
    description: "Move/rename a file",
    category: "computer",
    parameters: {
      type: "object",
      properties: { src: { type: "string" }, dest: { type: "string" } },
      required: ["src", "dest"],
    },
    execute: async (args) => fileMove(String(args.src ?? ""), String(args.dest ?? "")),
  });

  registry.register({
    name: "file.mkdir",
    description: "Create a directory (recursive)",
    category: "computer",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    execute: async (args) => fileMkdir(String(args.path ?? "")),
  });

  registry.register({
    name: "file.edit",
    description: "Search-replace edit inside a text file (OpenClaw-style apply patch lite)",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        oldText: { type: "string" },
        newText: { type: "string" },
        replaceAll: { type: "boolean" },
      },
      required: ["path", "oldText", "newText"],
    },
    execute: async (args) =>
      fileEdit(
        String(args.path ?? ""),
        String(args.oldText ?? ""),
        String(args.newText ?? ""),
        Boolean(args.replaceAll),
      ),
  });

  registry.register({
    name: "file.find",
    description: "Find files/folders by name substring under a root directory",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        root: { type: "string" },
        pattern: { type: "string" },
        max: { type: "number" },
      },
      required: ["pattern"],
    },
    execute: async (args) =>
      fileFind(String(args.root ?? "."), String(args.pattern ?? ""), Number(args.max ?? 50)),
  });

  registry.register({
    name: "file.download",
    description:
      "Download a file from URL to Downloads (or destPath). Use for installers, PDFs, zips, datasets.",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
        destPath: { type: "string", description: "Optional full destination path" },
      },
      required: ["url"],
    },
    execute: async (args) =>
      downloadFile(String(args.url ?? ""), args.destPath ? String(args.destPath) : undefined),
  });

  registry.register({
    name: "file.open",
    description: "Open a local file/folder with the default OS app",
    category: "computer",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    execute: async (args) => openPath(String(args.path ?? "")),
  });

  registry.register({
    name: "archive.zip",
    description: "Create a zip archive from a file or folder",
    category: "computer",
    parameters: {
      type: "object",
      properties: { sourcePath: { type: "string" }, zipPath: { type: "string" } },
      required: ["sourcePath"],
    },
    execute: async (args) =>
      zipCreate(String(args.sourcePath ?? ""), args.zipPath ? String(args.zipPath) : undefined),
  });

  registry.register({
    name: "archive.unzip",
    description: "Extract a zip archive",
    category: "computer",
    parameters: {
      type: "object",
      properties: { zipPath: { type: "string" }, destDir: { type: "string" } },
      required: ["zipPath"],
    },
    execute: async (args) =>
      zipExtract(String(args.zipPath ?? ""), args.destDir ? String(args.destDir) : undefined),
  });

  registry.register({
    name: "http.request",
    description: "Raw HTTP request (GET/POST/PUT/DELETE) for APIs and webhooks",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        method: { type: "string" },
        url: { type: "string" },
        body: { type: "string" },
        headersJson: { type: "string", description: "JSON object of headers" },
        maxChars: { type: "number" },
      },
      required: ["url"],
    },
    execute: async (args) =>
      httpRequest(
        String(args.method ?? "GET"),
        String(args.url ?? ""),
        args.body ? String(args.body) : undefined,
        args.headersJson ? String(args.headersJson) : undefined,
        Number(args.maxChars ?? 20000),
      ),
  });

  registry.register({
    name: "web.analyze",
    description:
      "Deep website analysis: title, meta, headings, links, text. Prefer for «проанализируй сайт».",
    category: "computer",
    parameters: {
      type: "object",
      properties: { url: { type: "string" }, maxChars: { type: "number" } },
      required: ["url"],
    },
    execute: async (args) =>
      webAnalyze(String(args.url ?? ""), Number(args.maxChars ?? 16000)),
  });

  registry.register({
    name: "web.links",
    description: "Extract all links from a webpage",
    category: "computer",
    parameters: {
      type: "object",
      properties: { url: { type: "string" }, limit: { type: "number" } },
      required: ["url"],
    },
    execute: async (args) => webLinks(String(args.url ?? ""), Number(args.limit ?? 50)),
  });

  registry.register({
    name: "report.write",
    description:
      "Write a report to Documents/HeyAgent-Reports. Prefer format=pdf for news digests (styled HTML→PDF). Also md|html|txt. Body: markdown with ## section headings.",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        content: { type: "string", description: "Markdown body; use ## headings for PDF sections" },
        format: { type: "string", description: "pdf | md | html | txt" },
        destDir: { type: "string" },
      },
      required: ["title", "content"],
    },
    execute: async (args) => {
      const fmt = String(args.format ?? "md").toLowerCase();
      const format =
        fmt === "html" || fmt === "txt" || fmt === "pdf" ? (fmt as "html" | "txt" | "pdf") : "md";
      return writeReport(
        String(args.title ?? "Report"),
        String(args.content ?? ""),
        format,
        args.destDir ? String(args.destDir) : undefined,
      );
    },
  });

  registry.register({
    name: "presentation.create",
    description:
      "Create an interactive HTML Reveal.js presentation (animations via fragments) and open it. Use for «сделай презентацию».",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        slidesJson: {
          type: "string",
          description: 'JSON array: [{"title":"...","bullets":["..."]}]',
        },
        open: { type: "boolean" },
      },
      required: ["title", "slidesJson"],
    },
    execute: async (args) => {
      const { createPresentationDeck } = await import("@heyagent/computer");
      let slides: { title: string; bullets?: string[]; notes?: string }[] = [];
      try {
        const parsed = JSON.parse(String(args.slidesJson ?? "[]"));
        slides = Array.isArray(parsed) ? parsed : [];
      } catch {
        return "ERROR: slidesJson must be a JSON array";
      }
      const r = await createPresentationDeck({
        title: String(args.title ?? "Presentation"),
        slides,
        open: args.open !== false,
      });
      return r.message;
    },
  });

  registry.register({
    name: "office.desktop.write",
    description:
      "Create a document in local Word / Excel / PowerPoint / WordPad (Windows COM). Use when user asks for desktop Office apps (not Google).",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        app: { type: "string", description: "word | excel | powerpoint | wordpad" },
        title: { type: "string" },
        content: { type: "string" },
      },
      required: ["app", "title", "content"],
    },
    execute: async (args) => {
      const { officeWriteDocument } = await import("@heyagent/computer");
      const app = String(args.app ?? "word").toLowerCase();
      const allowed = ["word", "excel", "powerpoint", "wordpad"] as const;
      const a = allowed.includes(app as (typeof allowed)[number])
        ? (app as (typeof allowed)[number])
        : "word";
      return officeWriteDocument({
        app: a,
        title: String(args.title ?? "Document"),
        content: String(args.content ?? ""),
      });
    },
  });

  registry.register({
    name: "code.run",
    description: "Run a short Node/Python/PowerShell/Bash snippet and return stdout",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        language: { type: "string", description: "node | python | powershell | bash" },
        code: { type: "string" },
      },
      required: ["language", "code"],
    },
    execute: async (args) => {
      const lang = String(args.language ?? "node").toLowerCase();
      const allowed = ["node", "python", "powershell", "bash"] as const;
      const language = (allowed.includes(lang as (typeof allowed)[number])
        ? lang
        : "node") as (typeof allowed)[number];
      return codeRun(language, String(args.code ?? ""));
    },
  });

  registry.register({
    name: "process.list",
    description: "List running processes (optional name filter)",
    category: "computer",
    parameters: {
      type: "object",
      properties: { filter: { type: "string" } },
    },
    execute: async (args) => processList(args.filter ? String(args.filter) : undefined),
  });

  registry.register({
    name: "process.kill",
    description: "Kill a process by PID (requires approval)",
    category: "computer",
    parameters: {
      type: "object",
      properties: { pid: { type: "number" } },
      required: ["pid"],
    },
    execute: async (args) => processKill(Number(args.pid ?? 0)),
  });

  registry.register({
    name: "window.list",
    description: "List open windows with titles (Windows)",
    category: "computer",
    parameters: { type: "object", properties: {} },
    execute: async () => windowList(),
  });

  registry.register({
    name: "window.focus",
    description: "Focus a window by title substring (Windows)",
    category: "computer",
    parameters: {
      type: "object",
      properties: { title: { type: "string" } },
      required: ["title"],
    },
    execute: async (args) => windowFocus(String(args.title ?? "")),
  });

  registry.register({
    name: "wait",
    description: "Wait N milliseconds (max 120000) before next action",
    category: "computer",
    parameters: {
      type: "object",
      properties: { ms: { type: "number" } },
      required: ["ms"],
    },
    execute: async (args) => waitMs(Number(args.ms ?? 1000)),
  });

  registry.register({
    name: "git.status",
    description: "git status -sb in a repo directory",
    category: "computer",
    parameters: {
      type: "object",
      properties: { cwd: { type: "string" } },
    },
    execute: async (args) => gitStatus(args.cwd ? String(args.cwd) : undefined),
  });

  registry.register({
    name: "git.diff",
    description: "git diff --stat summary",
    category: "computer",
    parameters: {
      type: "object",
      properties: { cwd: { type: "string" } },
    },
    execute: async (args) => gitDiff(args.cwd ? String(args.cwd) : undefined),
  });

  registry.register({
    name: "telegram.file",
    description:
      "Send a local FILE to a Telegram Desktop CONTACT (UI paste). Use when user says «отправь файл Ренату».",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        contact: { type: "string" },
        filePath: { type: "string" },
        caption: { type: "string" },
      },
      required: ["contact", "filePath"],
    },
    execute: async (args) =>
      telegramSendFileUi(
        String(args.contact ?? ""),
        String(args.filePath ?? ""),
        args.caption ? String(args.caption) : undefined,
      ),
  });

  registry.register({
    name: "telegram.document",
    description:
      "Send a document to the OWNER via Bot API (reliable). Use to deliver reports/files back to the user in the control bot.",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        filePath: { type: "string" },
        caption: { type: "string" },
      },
      required: ["filePath"],
    },
    execute: async (args) =>
      telegramSendDocumentBot(
        String(args.filePath ?? ""),
        args.caption ? String(args.caption) : undefined,
      ),
  });

  registry.register({
    name: "telegram.photo",
    description: "Send a photo to the OWNER via Bot API",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        filePath: { type: "string" },
        caption: { type: "string" },
      },
      required: ["filePath"],
    },
    execute: async (args) =>
      telegramSendPhotoBot(
        String(args.filePath ?? ""),
        args.caption ? String(args.caption) : undefined,
      ),
  });

  registry.register({
    name: "telegram.notify",
    description: "Push a short status message to the owner bot chat",
    category: "computer",
    parameters: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
    execute: async (args) => telegramNotifyOwner(String(args.text ?? "")),
  });

  registry.register({
    name: "paths.desktop",
    description: "Return the Desktop absolute path",
    category: "computer",
    parameters: { type: "object", properties: {} },
    execute: async () => desktopPath(),
  });

  registry.register({
    name: "paths.downloads",
    description: "Return the Downloads absolute path",
    category: "computer",
    parameters: { type: "object", properties: {} },
    execute: async () => downloadsPath(),
  });
}
