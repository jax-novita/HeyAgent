import type { ToolRegistry } from "./tools.js";
import { IntegrationsHub, connectAppAction, runGog } from "@heyagent/integrations";

export function registerIntegrationTools(registry: ToolRegistry): void {
  const hub = new IntegrationsHub();

  registry.register({
    name: "google.docs.read",
    description: "Read a Google Doc by document ID",
    category: "integration",
    parameters: {
      type: "object",
      properties: { documentId: { type: "string" } },
      required: ["documentId"],
    },
    execute: async (args) => hub.googleDocsRead(String(args.documentId ?? "")),
  });

  registry.register({
    name: "google.docs.write",
    description: "Create a Google Doc with title and content",
    category: "integration",
    parameters: {
      type: "object",
      properties: { title: { type: "string" }, content: { type: "string" } },
      required: ["title", "content"],
    },
    execute: async (args) =>
      hub.googleDocsWrite(String(args.title ?? "Untitled"), String(args.content ?? "")),
  });

  registry.register({
    name: "google.drive.search",
    description: "Search Google Drive files",
    category: "integration",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    execute: async (args) => hub.googleDriveSearch(String(args.query ?? "")),
  });

  registry.register({
    name: "google.sheets.create",
    description: "Create a Google Sheet with optional CSV/TSV rows (one row per line).",
    category: "integration",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        rowsCsv: { type: "string", description: "CSV/TSV lines for cells" },
      },
      required: ["title"],
    },
    execute: async (args) =>
      hub.googleSheetsCreate(String(args.title ?? "Sheet"), String(args.rowsCsv ?? "")),
  });

  registry.register({
    name: "google.slides.create",
    description:
      "Create a Google Slides presentation. slidesJson: [{\"title\":\"...\",\"bullets\":[\"...\"]}]",
    category: "integration",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        slidesJson: { type: "string" },
      },
      required: ["title", "slidesJson"],
    },
    execute: async (args) =>
      hub.googleSlidesCreate(String(args.title ?? "Slides"), String(args.slidesJson ?? "[]")),
  });

  registry.register({
    name: "gmail.summary",
    description:
      "Read Gmail inbox via IMAP/API if connected. Prefer gmail.browser.open when user wants the real Gmail UI.",
    category: "integration",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "How many latest emails, default 10" },
        unreadOnly: {
          type: "boolean",
          description: "true = only unread, false = latest inbox messages",
        },
      },
    },
    execute: async (args) =>
      hub.gmailSummary(Number(args.limit ?? 10), Boolean(args.unreadOnly)),
  });

  registry.register({
    name: "gmail.draft",
    description: "Create a Gmail draft",
    category: "integration",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
      },
      required: ["to", "subject", "body"],
    },
    execute: async (args) =>
      hub.gmailDraft(String(args.to ?? ""), String(args.subject ?? ""), String(args.body ?? "")),
  });

  registry.register({
    name: "gmail.send",
    description: "Send an email via Gmail",
    category: "integration",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
      },
      required: ["to", "subject", "body"],
    },
    execute: async (args) =>
      hub.gmailSend(String(args.to ?? ""), String(args.subject ?? ""), String(args.body ?? "")),
  });

  registry.register({
    name: "notion.search",
    description: "Search Notion workspace",
    category: "integration",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    execute: async (args) => hub.notionSearch(String(args.query ?? "")),
  });

  registry.register({
    name: "notion.read",
    description: "Read a Notion page by ID",
    category: "integration",
    parameters: {
      type: "object",
      properties: { pageId: { type: "string" } },
      required: ["pageId"],
    },
    execute: async (args) => hub.notionRead(String(args.pageId ?? "")),
  });

  registry.register({
    name: "notion.write",
    description: "Create a Notion page with title and content",
    category: "integration",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        content: { type: "string" },
        parentId: { type: "string" },
      },
      required: ["title", "content"],
    },
    execute: async (args) =>
      hub.notionWrite(
        String(args.title ?? "Untitled"),
        String(args.content ?? ""),
        args.parentId ? String(args.parentId) : undefined,
      ),
  });

  registry.register({
    name: "github.issue.create",
    description: "Create a GitHub issue in owner/repo",
    category: "integration",
    parameters: {
      type: "object",
      properties: {
        repo: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
      },
      required: ["repo", "title"],
    },
    execute: async (args) =>
      hub.githubCreateIssue(
        String(args.repo ?? ""),
        String(args.title ?? ""),
        String(args.body ?? ""),
      ),
  });

  registry.register({
    name: "apps.connect",
    description:
      "Connect-apps router: perform an action on a connected service. service=google|notion|github|slack|trello|obsidian; action depends on service.",
    category: "integration",
    parameters: {
      type: "object",
      properties: {
        service: { type: "string" },
        action: { type: "string" },
        payload: { type: "object" },
      },
      required: ["service", "action"],
    },
    execute: async (args) =>
      connectAppAction(
        String(args.service ?? ""),
        String(args.action ?? ""),
        (args.payload as Record<string, unknown>) ?? {},
      ),
  });

  registry.register({
    name: "gog.run",
    description:
      "Run a gog (gogcli) command for Google Workspace — same as OpenClaw. Pass args without the binary name, e.g. gmail search 'in:inbox' --max 5 --json",
    category: "integration",
    parameters: {
      type: "object",
      properties: {
        args: {
          type: "string",
          description: "Arguments after gog, space-separated (quotes supported)",
        },
      },
      required: ["args"],
    },
    execute: async (args) => {
      const raw = String(args.args ?? "").trim();
      if (!raw) return "ERROR: empty args";
      const parsed = splitShellArgs(raw);
      const r = await runGog(parsed, { timeoutMs: 120_000 });
      if (r.code !== 0) return `ERROR (exit ${r.code}): ${r.stderr || r.stdout}`;
      return r.stdout.trim() || r.stderr.trim() || "OK";
    },
  });
}

function splitShellArgs(input: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    out.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  return out;
}
