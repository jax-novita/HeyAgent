import { appendFile } from "node:fs/promises";
import {
  generateId,
  getAuditLogPath,
  type PolicyMode,
  type ApprovalRequest,
} from "@heyagent/shared";

export * from "./capabilities.js";
export * from "./transaction-approvals.js";

const SENSITIVE_TOOLS = new Set([
  "shell.exec",
  "file.delete",
  "process.kill",
  "code.run",
  "gmail.send",
  "google.docs.write",
  "notion.write",
  "computer.click",
  "computer.type",
  "app.install",
  "app.uninstall",
  "telegram.message",
  "telegram.file",
]);

// Genuinely irreversible / high-blast-radius actions. In "risky" mode ONLY
// these require confirmation; everything else runs autonomously.
const RISKY_TOOLS = new Set([
  "shell.exec",
  "shell.exec_elevated",
  "file.delete",
  "process.kill",
  "code.run",
  "gmail.send",
  "gmail.browser.send",
  "system.empty_recycle_bin",
  "app.install",
  "app.uninstall",
  "telegram.message",
  "telegram.file",
]);

// Substrings that indicate an irreversible power/destroy action for "risky" mode.
const RISKY_HINTS = /(shutdown|restart|hibernate|delete|drop|format|wipe|uninstall)/i;

const SAFE_TOOLS = new Set([
  "file.read",
  "file.list",
  "file.exists",
  "file.info",
  "file.find",
  "file.mkdir",
  "file.copy",
  "file.move",
  "file.edit",
  "file.write",
  "file.download",
  "file.open",
  "archive.zip",
  "archive.unzip",
  "browser.open",
  "gmail.browser.open",
  "gmail.browser.compose",
  "gmail.browser.reply",
  "gmail.browser.send",
  "github.browse.mission",
  "browser.tour",
  "browser.wikipedia.hops",
  "browser.reddit.scroll",
  "browser.tabs.compare",
  "browser.mission.stop",
  "browser.mission.recover",
  "browser.page.state",
  "browser.what_selected",
  "browser.dismiss_popups",
  "youtube.open.lesson",
  "web.search",
  "web.fetch",
  "web.analyze",
  "web.links",
  "http.request",
  "weather.get",
  "clock.now",
  "app.open",
  "app.search",
  "notepad.write",
  "notepad.type",
  "telegram.document",
  "telegram.photo",
  "telegram.notify",
  "clipboard.set",
  "clipboard.get",
  "computer.screenshot",
  "computer.hotkey",
  "google.docs.read",
  "google.drive.search",
  "google.sheets.create",
  "google.slides.create",
  "presentation.create",
  "office.desktop.write",
  "memory.search",
  "notion.search",
  "notion.read",
  "gmail.draft",
  "gmail.summary",
  "apps.connect",
  "memory.remember",
  "mission.start",
  "mission.note_turn",
  "mission.cancel",
  "mission.status",
  "system.info",
  "system.empty_recycle_bin",
  "system.admin_status",
  "system.set_wallpaper",
  "system.open_settings",
  "system.update_drivers",
  "system.set_volume",
  "system.get_volume",
  "system.set_brightness",
  "system.get_display_modes",
  "system.set_refresh_rate",
  "system.set_hotspot",
  "system.control",
  "system.controls_help",
  "shell.exec_elevated",
  "image.edit",
  "paths.desktop",
  "paths.downloads",
  "report.write",
  "process.list",
  "window.list",
  "window.focus",
  "wait",
  "git.status",
  "git.diff",
  "cron.list",
  "cron.schedule",
  "cron.cancel",
  "screen.see",
  "screen.bounds",
  "screen.ocr",
  "desktop.see_and_click",
  "ui.tree",
  "ui.find",
  "computer.move",
  "computer.scroll",
  "computer.drag",
  "computer.double_click",
  "computer.click",
  "computer.type",
  "shell.exec",
  "code.run",
  "tts.speak",
]);

export class PolicyEngine {
  private mode: PolicyMode;
  private allowlist: Set<string>;
  private pendingApprovals = new Map<string, ApprovalRequest>();

  constructor(mode: PolicyMode = "ask", allowlist: string[] = []) {
    this.mode = mode;
    this.allowlist = new Set(allowlist);
  }

  setMode(mode: PolicyMode): void {
    this.mode = mode;
  }

  requiresApproval(toolName: string, args: Record<string, unknown>): boolean {
    if (this.mode === "full") return false;

    // "risky": run everything autonomously EXCEPT truly irreversible actions.
    if (this.mode === "risky") {
      if (RISKY_TOOLS.has(toolName)) return true;
      const argStr = JSON.stringify(args ?? {});
      if (RISKY_HINTS.test(toolName) || RISKY_HINTS.test(argStr)) return true;
      return false;
    }

    if (SAFE_TOOLS.has(toolName)) return false;
    if (this.mode === "allowlist") return !this.allowlist.has(toolName);

    if (SENSITIVE_TOOLS.has(toolName)) return true;

    if (toolName === "shell.exec" && typeof args.command === "string") {
      return true; // all shell needs ask in ask mode
    }

    if (toolName.includes("send") || toolName.includes("delete") || toolName.includes("write")) {
      return true;
    }

    // ask mode: only sensitive/destructive need confirm; safe actions run
    return false;
  }

  createApproval(
    toolName: string,
    args: Record<string, unknown>,
    description: string,
  ): ApprovalRequest {
    const request: ApprovalRequest = {
      id: generateId("approval"),
      action: toolName,
      description,
      toolName,
      arguments: args,
      createdAt: new Date().toISOString(),
      status: "pending",
    };
    this.pendingApprovals.set(request.id, request);
    return request;
  }

  resolveApproval(id: string, approved: boolean): ApprovalRequest | null {
    const req = this.pendingApprovals.get(id);
    if (!req) return null;
    req.status = approved ? "approved" : "denied";
    this.pendingApprovals.delete(id);
    return req;
  }

  getPendingApprovals(): ApprovalRequest[] {
    return [...this.pendingApprovals.values()].filter((a) => a.status === "pending");
  }

  async auditLog(entry: Record<string, unknown>): Promise<void> {
    const line = JSON.stringify({ ...entry, ts: new Date().toISOString() }) + "\n";
    await appendFile(getAuditLogPath(), line, "utf-8");
  }
}
