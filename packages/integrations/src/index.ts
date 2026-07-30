import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getCredentialsDir, getHeyAgentHome, ensureDir, loadConfig, saveConfig } from "@heyagent/shared";
import {
  gogAvailable,
  gogGmailSummary,
  gogHasAccount,
} from "./gog.js";
import {
  gmailImapCreateDraft,
  gmailImapSummary,
  gmailSmtpSend,
  testGmailImap,
  type GmailImapCredentials,
} from "./gmail-imap.js";
import { buildGoogleDocsFormatting } from "./google-docs-format.js";
export { buildGoogleDocsFormatting } from "./google-docs-format.js";
import { plainWorkspaceText } from "./workspace-text.js";
export { normalizeWorkspaceMath, plainWorkspaceText } from "./workspace-text.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export {
  GOOGLE_OAUTH_REDIRECT,
  GOOGLE_OAUTH_REDIRECT_LOCALHOST,
  GOOGLE_OAUTH_REDIRECT_CHOICES,
  GOOGLE_OAUTH_PORT,
  loadGoogleClientSecretJson,
  buildGoogleAuthUrl,
  makePkce,
  findGoogleClientSecretJson,
  GOOGLE_WORKSPACE_SCOPES,
  openUrl,
  waitForOAuthCode,
  exchangeGoogleCode,
} from "./google-oauth.js";

export {
  gogAvailable,
  gogAuthAdd,
  gogAuthList,
  gogGmailSummary,
  gogHasAccount,
  gogHomeHint,
  gogSetCredentials,
  runGog,
  resolveGogBinary,
} from "./gog.js";

export {
  gmailImapCreateDraft,
  gmailImapSummary,
  gmailSmtpSend,
  testGmailImap,
} from "./gmail-imap.js";

export type IntegrationId = "google" | "gmail" | "notion" | "github";

export interface IntegrationStatus {
  id: IntegrationId;
  name: string;
  connected: boolean;
  connectedAt?: string;
}

export interface GoogleCredentials {
  /** oauth = Gmail API token; imap = app password (simple path) */
  mode?: "oauth" | "imap";
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  clientId?: string;
  clientSecret?: string;
  email?: string;
  appPassword?: string;
}

export interface NotionCredentials {
  apiToken: string;
}

export interface GitHubCredentials {
  token: string;
}

const INTEGRATION_NAMES: Record<IntegrationId, string> = {
  google: "Google Workspace",
  gmail: "Gmail",
  notion: "Notion",
  github: "GitHub",
};

export class IntegrationsHub {
  private credsDir: string;

  constructor() {
    this.credsDir = getCredentialsDir();
  }

  async getStatus(): Promise<IntegrationStatus[]> {
    const config = await loadConfig();
    const integrations = config.integrations ?? {};
    const ids: IntegrationId[] = ["google", "gmail", "notion", "github"];
    const statuses: IntegrationStatus[] = [];
    for (const id of ids) {
      let connected =
        id === "google" || id === "gmail"
          ? await this.hasCredentials(id)
          : integrations[id]?.connected ?? (await this.hasCredentials(id));
      if (id === "google" && !connected && (await gogHasAccount())) connected = true;
      statuses.push({
        id,
        name: INTEGRATION_NAMES[id],
        connected,
        connectedAt: integrations[id]?.connectedAt,
      });
    }
    return statuses;
  }

  /** Mark Google connected after successful gog auth (OpenClaw path). */
  async markGoogleConnectedViaGog(): Promise<void> {
    await this.markConnected("google");
  }

  async hasCredentials(id: IntegrationId): Promise<boolean> {
    if (id === "google") {
      const creds = await this.loadCreds<GoogleCredentials>("google");
      return Boolean(creds?.mode !== "imap" && creds?.accessToken);
    }
    if (id === "gmail") {
      if (existsSync(join(this.credsDir, "gmail.json"))) return true;
      const legacy = await this.loadCreds<GoogleCredentials>("google");
      return Boolean(legacy?.mode === "imap" && legacy.email && legacy.appPassword);
    }
    return existsSync(join(this.credsDir, `${id}.json`));
  }

  async saveGoogleCredentials(creds: GoogleCredentials): Promise<void> {
    if (creds.mode === "imap") {
      if (!creds.email?.includes("@") || !creds.appPassword) {
        throw new Error("Для IMAP нужны email и пароль приложения.");
      }
      await this.saveCreds("gmail", {
        mode: "imap",
        email: creds.email.trim(),
        appPassword: creds.appPassword.replace(/\s+/g, ""),
      } satisfies GmailImapCredentials);
      await this.markConnected("gmail");
      return;
    }
    if (!creds.accessToken || !isValidGoogleAccessToken(creds.accessToken)) {
      throw new Error(
        "Неверный Google access token. Нужен токен вида ya29.... или IMAP через пароль приложения.",
      );
    }
    const legacy = await this.loadCreds<GoogleCredentials>("google");
    if (legacy?.mode === "imap" && legacy.email && legacy.appPassword) {
      await this.saveCreds("gmail", {
        mode: "imap",
        email: legacy.email,
        appPassword: legacy.appPassword,
      } satisfies GmailImapCredentials);
      await this.markConnected("gmail");
    }
    await this.saveCreds("google", { ...creds, mode: "oauth" });
    await this.markConnected("google");
  }

  async saveGmailAppPassword(email: string, appPassword: string): Promise<string> {
    const creds: GmailImapCredentials = {
      mode: "imap",
      email: email.trim(),
      appPassword: appPassword.replace(/\s+/g, ""),
    };
    const check = await testGmailImap(creds);
    if (check.startsWith("ERROR")) return check;
    await this.saveCreds("gmail", creds);
    await this.markConnected("gmail");
    return check;
  }

  async saveNotionToken(token: string): Promise<void> {
    await this.saveCreds("notion", { apiToken: token } satisfies NotionCredentials);
    await this.markConnected("notion");
  }

  async saveGitHubToken(token: string): Promise<void> {
    await this.saveCreds("github", { token } satisfies GitHubCredentials);
    await this.markConnected("github");
  }

  private async saveCreds(id: string, data: unknown): Promise<void> {
    await ensureDir(this.credsDir, { mkdir } as typeof import("node:fs/promises"));
    await writeFile(join(this.credsDir, `${id}.json`), JSON.stringify(data, null, 2), "utf-8");
  }

  private async loadCreds<T>(id: string): Promise<T | null> {
    const path = join(this.credsDir, `${id}.json`);
    if (!existsSync(path)) return null;
    return JSON.parse(await readFile(path, "utf-8")) as T;
  }

  private async getGmailCredentials(): Promise<GmailImapCredentials | null> {
    const current = await this.loadCreds<GmailImapCredentials>("gmail");
    if (current?.mode === "imap" && current.email && current.appPassword) return current;
    const legacy = await this.loadCreds<GoogleCredentials>("google");
    if (legacy?.mode === "imap" && legacy.email && legacy.appPassword) {
      return {
        mode: "imap",
        email: legacy.email,
        appPassword: legacy.appPassword,
      };
    }
    return null;
  }

  private async markConnected(id: IntegrationId): Promise<void> {
    const config = await loadConfig();
    config.integrations = config.integrations ?? {};
    config.integrations[id] = { connected: true, connectedAt: new Date().toISOString() };
    await saveConfig(config);
  }

  async exchangeGoogleOAuthCode(
    clientId: string,
    clientSecret: string,
    code: string,
    redirectUri: string,
  ): Promise<string> {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !data.access_token) {
      return `ERROR: OAuth exchange failed (${res.status}): ${data.error_description ?? data.error ?? "unknown error"}`;
    }
    await this.saveGoogleCredentials({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString(),
      clientId,
      clientSecret,
    });
    return "Google OAuth connected and verified.";
  }

  private async getGoogleAccessToken(): Promise<string | null> {
    const creds = await this.loadCreds<GoogleCredentials>("google");
    if (!creds?.accessToken) return null;
    if (!isValidGoogleAccessToken(creds.accessToken)) {
      return null;
    }
    const expiresSoon =
      Boolean(creds.expiresAt) &&
      new Date(creds.expiresAt!).getTime() <= Date.now() + 60_000;
    if (!expiresSoon) return creds.accessToken;
    if (!creds.refreshToken || !creds.clientId) {
      return creds.accessToken;
    }

    const refreshBody = new URLSearchParams({
      client_id: creds.clientId,
      refresh_token: creds.refreshToken,
      grant_type: "refresh_token",
    });
    if (creds.clientSecret) {
      refreshBody.set("client_secret", creds.clientSecret);
    }

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: refreshBody,
    });
    const data = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!res.ok || !data.access_token) return creds.accessToken ?? null;
    const updated: GoogleCredentials = {
      ...creds,
      accessToken: data.access_token,
      expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString(),
    };
    await this.saveCreds("google", updated);
    return updated.accessToken ?? null;
  }

  async testGoogleWorkspaceConnection(): Promise<string> {
    const accessToken = await this.getGoogleAccessToken();
    if (!accessToken) return "ERROR: Google Workspace token is missing.";
    const res = await fetch(
      "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (res.ok) {
      const data = await res.json() as { user?: { emailAddress?: string } };
      return `Workspace access verified${data.user?.emailAddress ? ` for ${data.user.emailAddress}` : ""}.`;
    }
    const detail = await res.text();
    if (res.status === 403 && /accessNotConfigured|SERVICE_DISABLED|has not been used/i.test(detail)) {
      return [
        "OAuth сохранён, но Google Drive API ещё не включён для проекта.",
        "Включи Workspace APIs: https://console.cloud.google.com/apis/library/drive.googleapis.com",
        "Также включи Docs, Sheets и Slides APIs в том же проекте.",
      ].join("\n");
    }
    return `ERROR: Google Workspace verification failed (${res.status}): ${detail.slice(0, 240)}`;
  }

  async googleDocsRead(documentId: string): Promise<string> {
    const accessToken = await this.getGoogleAccessToken();
    if (!accessToken) {
      return "Google not connected. Run: hey connect google";
    }
    const res = await fetch(
      `https://docs.googleapis.com/v1/documents/${documentId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return `Google Docs API error: ${res.status}`;
    const data = (await res.json()) as { title?: string; body?: unknown };
    return JSON.stringify({ title: data.title, body: data.body }, null, 2);
  }

  async googleDocsWrite(title: string, content: string): Promise<string> {
    const accessToken = await this.getGoogleAccessToken();
    if (!accessToken) {
      return "Google not connected. Run: hey connect google";
    }
    const createRes = await fetch("https://docs.googleapis.com/v1/documents", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title }),
    });
    if (!createRes.ok) {
      const detail = await createRes.text();
      if (
        createRes.status === 403 &&
        /accessNotConfigured|SERVICE_DISABLED|has not been used|disabled/i.test(detail)
      ) {
        return [
          "ERROR: Google Docs API выключен в проекте Google Cloud.",
          "Включи его: https://console.cloud.google.com/apis/library/docs.googleapis.com",
          "OAuth-доступ уже сохранён; повторно подключать аккаунт не нужно.",
        ].join("\n");
      }
      return `ERROR: Failed to create Google Doc (${createRes.status}): ${detail.slice(0, 500)}`;
    }
    const doc: unknown = await createRes.json();
    if (
      !isRecord(doc) ||
      typeof doc.documentId !== "string" ||
      !doc.documentId.trim()
    ) {
      return "ERROR: Google Docs create response did not contain a valid documentId.";
    }
    const documentId = doc.documentId;
    const formatted = buildGoogleDocsFormatting(content);
    const updateRes = await fetch(
      `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ requests: formatted.requests }),
      },
    );
    const documentUrl = `https://docs.google.com/document/d/${documentId}/edit`;
    if (!updateRes.ok) {
      const detail = await updateRes.text();
      return [
        `ERROR: Google Doc was created, but writing content failed (${updateRes.status}).`,
        documentUrl,
        detail.slice(0, 500),
      ].join("\n");
    }
    return `Created Google Doc "${title}" (id: ${documentId})\n${documentUrl}`;
  }

  async googleDriveSearch(query: string): Promise<string> {
    const accessToken = await this.getGoogleAccessToken();
    if (!accessToken) return "Google not connected. Run: hey connect google";
    const q = encodeURIComponent(`name contains '${query.replace(/'/g, "\\'")}'`);
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=10`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return `Drive API error: ${res.status}`;
    const data = (await res.json()) as { files: { id: string; name: string }[] };
    return data.files.map((f) => `${f.name} (${f.id})`).join("\n") || "No files found.";
  }

  async googleSheetsCreate(title: string, rowsCsv: string): Promise<string> {
    const accessToken = await this.getGoogleAccessToken();
    if (!accessToken) return "Google not connected. Run: hey connect google";
    const cleanTitle = plainWorkspaceText(title);
    const createRes = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ properties: { title: cleanTitle } }),
    });
    if (!createRes.ok) return `Sheets create error: ${createRes.status}`;
    const sheet = (await createRes.json()) as {
      spreadsheetId: string;
      spreadsheetUrl?: string;
      sheets?: { properties?: { sheetId?: number } }[];
    };
    const rows = rowsCsv
      .split(/\r?\n/)
      .map((line) => line.split(/\t|,|;/).map((c) => plainWorkspaceText(c.trim())))
      .filter((r) => r.some(Boolean))
      .slice(0, 200);
    if (rows.length) {
      const appendRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheet.spreadsheetId}/values/Sheet1!A1:append?valueInputOption=USER_ENTERED`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ values: rows }),
        },
      );
      if (!appendRes.ok) return `Sheets values error: ${appendRes.status}`;

      const sheetId = sheet.sheets?.[0]?.properties?.sheetId ?? 0;
      const columnCount = Math.max(...rows.map((row) => row.length), 1);
      const formatRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheet.spreadsheetId}:batchUpdate`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            requests: [
              {
                updateSheetProperties: {
                  properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
                  fields: "gridProperties.frozenRowCount",
                },
              },
              {
                repeatCell: {
                  range: { sheetId, startRowIndex: 0, endRowIndex: 1, endColumnIndex: columnCount },
                  cell: {
                    userEnteredFormat: {
                      backgroundColor: { red: 0.12, green: 0.32, blue: 0.62 },
                      horizontalAlignment: "CENTER",
                      textFormat: {
                        bold: true,
                        foregroundColor: { red: 1, green: 1, blue: 1 },
                      },
                    },
                  },
                  fields:
                    "userEnteredFormat(backgroundColor,horizontalAlignment,textFormat)",
                },
              },
              {
                repeatCell: {
                  range: {
                    sheetId,
                    startRowIndex: 1,
                    endRowIndex: rows.length,
                    endColumnIndex: columnCount,
                  },
                  cell: {
                    userEnteredFormat: {
                      wrapStrategy: "WRAP",
                      verticalAlignment: "MIDDLE",
                    },
                  },
                  fields: "userEnteredFormat(wrapStrategy,verticalAlignment)",
                },
              },
              {
                autoResizeDimensions: {
                  dimensions: {
                    sheetId,
                    dimension: "COLUMNS",
                    startIndex: 0,
                    endIndex: columnCount,
                  },
                },
              },
            ],
          }),
        },
      );
      if (!formatRes.ok) return `Sheets formatting error: ${formatRes.status}`;
    }
    const url =
      sheet.spreadsheetUrl ||
      `https://docs.google.com/spreadsheets/d/${sheet.spreadsheetId}/edit`;
    return `Created Google Sheet "${cleanTitle}" → ${url}`;
  }

  async googleSlidesCreate(
    title: string,
    slidesJson: string,
  ): Promise<string> {
    const accessToken = await this.getGoogleAccessToken();
    if (!accessToken) return "Google not connected. Run: hey connect google";
    let slides: { title?: string; bullets?: string[] }[] = [];
    try {
      const parsed = JSON.parse(slidesJson);
      slides = Array.isArray(parsed) ? parsed : [];
    } catch {
      return "ERROR: slidesJson must be JSON array";
    }
    const cleanTitle = plainWorkspaceText(title);
    const createRes = await fetch("https://slides.googleapis.com/v1/presentations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: cleanTitle }),
    });
    if (!createRes.ok) return `Slides create error: ${createRes.status}`;
    const pres = (await createRes.json()) as {
      presentationId: string;
      slides?: { objectId: string }[];
    };
    const firstId = pres.slides?.[0]?.objectId;
    const requests: unknown[] = [];
    const normalizedSlides = [
      { title: cleanTitle, bullets: [] as string[] },
      ...slides.slice(0, 11).map((slide) => ({
        title: plainWorkspaceText(String(slide.title || "Слайд")).slice(0, 120),
        bullets: (slide.bullets || [])
          .map((bullet) => plainWorkspaceText(String(bullet)).slice(0, 300))
          .filter(Boolean),
      })),
    ];
    for (const s of normalizedSlides) {
      const id = `slide_${Math.random().toString(36).slice(2, 10)}`;
      const titleId = `title_${Math.random().toString(36).slice(2, 10)}`;
      const bodyId = `body_${Math.random().toString(36).slice(2, 10)}`;
      requests.push({
        createSlide: {
          objectId: id,
          insertionIndex: requests.length,
          slideLayoutReference: { predefinedLayout: "BLANK" },
        },
      });
      requests.push({
        createShape: {
          objectId: titleId,
          shapeType: "TEXT_BOX",
          elementProperties: {
            pageObjectId: id,
            size: {
              width: { magnitude: 8_200_000, unit: "EMU" },
              height: { magnitude: 900_000, unit: "EMU" },
            },
            transform: {
              scaleX: 1,
              scaleY: 1,
              translateX: 470_000,
              translateY: 320_000,
              unit: "EMU",
            },
          },
        },
      });
      requests.push(
        { insertText: { objectId: titleId, text: s.title, insertionIndex: 0 } },
        {
          updateTextStyle: {
            objectId: titleId,
            textRange: { type: "ALL" },
            style: {
              bold: true,
              fontFamily: "Arial",
              fontSize: { magnitude: s.bullets.length ? 28 : 32, unit: "PT" },
              foregroundColor: {
                opaqueColor: { rgbColor: { red: 0.1, green: 0.22, blue: 0.45 } },
              },
            },
            fields: "bold,fontFamily,fontSize,foregroundColor",
          },
        },
      );
      if (s.bullets.length) {
        const body = s.bullets.join("\n").slice(0, 1800);
        requests.push(
          {
            createShape: {
              objectId: bodyId,
              shapeType: "TEXT_BOX",
              elementProperties: {
                pageObjectId: id,
                size: {
                  width: { magnitude: 8_000_000, unit: "EMU" },
                  height: { magnitude: 3_600_000, unit: "EMU" },
                },
                transform: {
                  scaleX: 1,
                  scaleY: 1,
                  translateX: 570_000,
                  translateY: 1_350_000,
                  unit: "EMU",
                },
              },
            },
          },
          { insertText: { objectId: bodyId, text: body, insertionIndex: 0 } },
          {
            updateTextStyle: {
              objectId: bodyId,
              textRange: { type: "ALL" },
              style: {
                fontFamily: "Arial",
                fontSize: { magnitude: 18, unit: "PT" },
              },
              fields: "fontFamily,fontSize",
            },
          },
          {
            createParagraphBullets: {
              objectId: bodyId,
              textRange: { type: "ALL" },
              bulletPreset: "BULLET_DISC_CIRCLE_SQUARE",
            },
          },
        );
      }
    }
    if (firstId) {
      requests.push({
        deleteObject: { objectId: firstId },
      });
    }
    if (requests.length) {
      const updateRes = await fetch(
        `https://slides.googleapis.com/v1/presentations/${pres.presentationId}:batchUpdate`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ requests }),
        },
      );
      if (!updateRes.ok) {
        const detail = await updateRes.text();
        return `Slides formatting error: ${updateRes.status}: ${detail.slice(0, 400)}`;
      }
    }
    const url = `https://docs.google.com/presentation/d/${pres.presentationId}/edit`;
    return `Created Google Slides "${cleanTitle}" → ${url}`;
  }

  async gmailDraft(to: string, subject: string, body: string): Promise<string> {
    const creds = await this.getGmailCredentials();
    if (!creds) return "Gmail not connected. Run: npx hey connect gmail";
    return gmailImapCreateDraft(creds, to, subject, body);
  }

  async gmailSend(to: string, subject: string, body: string): Promise<string> {
    const creds = await this.getGmailCredentials();
    if (!creds) return "Gmail not connected. Run: npx hey connect gmail";
    return gmailSmtpSend(creds, to, subject, body);
  }

  async googleCalendarToday(): Promise<string> {
    const accessToken = await this.getGoogleAccessToken();
    if (!accessToken) return "Google not connected. Run: hey connect google";
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.searchParams.set("timeMin", start.toISOString());
    url.searchParams.set("timeMax", end.toISOString());
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "20");
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return `Calendar API error: ${res.status}`;
    const data = (await res.json()) as {
      items?: { summary?: string; start?: { dateTime?: string; date?: string } }[];
    };
    const items = data.items ?? [];
    if (!items.length) return "На сегодня событий нет.";
    return items
      .map((e) => {
        const when = e.start?.dateTime || e.start?.date || "?";
        return `• ${when} — ${e.summary || "(без названия)"}`;
      })
      .join("\n");
  }

  async gmailSummary(limit = 10, unreadOnly = false): Promise<string> {
    const creds = await this.getGmailCredentials();
    if (creds) return gmailImapSummary(creds, limit, unreadOnly);
    return [
      "ERROR: Gmail не подключён.",
      "1) Открой: https://myaccount.google.com/apppasswords",
      "   (нужна 2FA на аккаунте Google)",
      "2) Создай пароль приложения → «Почта»",
      "3) Скопируй 16 символов",
      "4) Запусти: npx hey connect gmail",
    ].join("\n");

    // OpenClaw path: gog if authorized.
    if (await gogAvailable()) {
      if (await gogHasAccount()) {
        return gogGmailSummary(limit, unreadOnly);
      }
    }

    const accessToken = await this.getGoogleAccessToken();
    if (!accessToken) {
      return [
        "ERROR: Google не подключён.",
        "Простой способ:",
        "  npx hey connect gmail",
        "Нужен пароль приложения: https://myaccount.google.com/apppasswords",
      ].join("\n");
    }

    const pageSize = Math.max(1, Math.min(Number(limit) || 10, 25));
    const query = unreadOnly ? "in:inbox is:unread" : "in:inbox";
    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${pageSize}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!listRes.ok) {
      const detail = await listRes.text();
      if (listRes.status === 401 || listRes.status === 403) {
        return `ERROR: Gmail не разрешил чтение почты (${listRes.status}). Подключи Gmail отдельно: "npx hey connect gmail". ${detail.slice(0, 180)}`;
      }
      return `ERROR: Gmail API ${listRes.status}: ${detail.slice(0, 240)}`;
    }

    const listed = (await listRes.json()) as {
      messages?: { id: string; threadId: string }[];
    };
    const refs = listed.messages ?? [];
    if (!refs.length) {
      return unreadOnly ? "Новых непрочитанных писем нет." : "Во входящих писем не найдено.";
    }

    const items = await Promise.all(
      refs.map(async ({ id }) => {
        const res = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (!res.ok) return null;
        const message = (await res.json()) as {
          id: string;
          snippet?: string;
          internalDate?: string;
          labelIds?: string[];
          payload?: {
            headers?: { name: string; value: string }[];
          };
        };
        const headers = message.payload?.headers ?? [];
        const header = (name: string) =>
          headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
        return {
          from: decodeMimeHeader(header("From")) || "(неизвестный отправитель)",
          subject: decodeMimeHeader(header("Subject")) || "(без темы)",
          date: formatMailDate(header("Date"), message.internalDate),
          unread: message.labelIds?.includes("UNREAD") ?? false,
          summary: cleanMailSnippet(message.snippet ?? ""),
        };
      }),
    );

    const valid = items.filter((item): item is NonNullable<typeof item> => Boolean(item));
    if (!valid.length) return "ERROR: Не удалось прочитать найденные письма.";

    const lines = [
      unreadOnly
        ? `Непрочитанные письма (${valid.length}):`
        : `Последние входящие письма (${valid.length}):`,
      ...valid.flatMap((mail, index) => [
        "",
        `${index + 1}. ${mail.unread ? "● " : ""}${mail.from}`,
        `   Тема: ${mail.subject}`,
        `   Когда: ${mail.date}`,
        `   Кратко: ${mail.summary || "Превью отсутствует."}`,
      ]),
    ];
    return lines.join("\n");
  }

  async notionSearch(query: string): Promise<string> {
    const creds = await this.loadCreds<NotionCredentials>("notion");
    if (!creds?.apiToken) return "Notion not connected. Run: hey connect notion";
    const res = await fetch("https://api.notion.com/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.apiToken}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, page_size: 10 }),
    });
    if (!res.ok) return `Notion search error: ${res.status}`;
    const data = (await res.json()) as {
      results: { id: string; object: string; url?: string }[];
    };
    return data.results
      .map((r) => `${r.object}: ${r.id}${r.url ? ` (${r.url})` : ""}`)
      .join("\n") || "No results.";
  }

  async notionRead(pageId: string): Promise<string> {
    const creds = await this.loadCreds<NotionCredentials>("notion");
    if (!creds?.apiToken) return "Notion not connected. Run: hey connect notion";
    const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      headers: {
        Authorization: `Bearer ${creds.apiToken}`,
        "Notion-Version": "2022-06-28",
      },
    });
    if (!res.ok) return `Notion read error: ${res.status}`;
    return JSON.stringify(await res.json(), null, 2);
  }

  async notionWrite(title: string, content: string, parentId?: string): Promise<string> {
    const creds = await this.loadCreds<NotionCredentials>("notion");
    if (!creds?.apiToken) return "Notion not connected. Run: hey connect notion";

    const body: Record<string, unknown> = {
      parent: parentId ? { page_id: parentId } : { type: "workspace", workspace: true },
      properties: {
        title: { title: [{ text: { content: title } }] },
      },
      children: [
        {
          object: "block",
          type: "paragraph",
          paragraph: { rich_text: [{ type: "text", text: { content } }] },
        },
      ],
    };

    const res = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.apiToken}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      return `Notion write error: ${res.status} ${err.slice(0, 200)}`;
    }
    const page = (await res.json()) as { id: string; url?: string };
    return `Created Notion page "${title}" (id: ${page.id}${page.url ? `, ${page.url}` : ""})`;
  }

  async githubCreateIssue(repo: string, title: string, body: string): Promise<string> {
    const creds = await this.loadCreds<GitHubCredentials>("github");
    if (!creds?.token) return "GitHub not connected. Run: hey connect github";
    const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title, body }),
    });
    if (!res.ok) return `GitHub issue error: ${res.status}`;
    const issue = (await res.json()) as { number: number; html_url: string };
    return `Created issue #${issue.number}: ${issue.html_url}`;
  }

  getGoogleOAuthUrl(clientId: string, redirectUri: string): string {
    const scopes = [
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/presentations",
    ].join(" ");
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: scopes,
      access_type: "offline",
      prompt: "consent",
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }
}

/** OpenClaw-style connect-apps router for multi-service actions. */
export async function connectAppAction(
  service: string,
  action: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const hub = new IntegrationsHub();
  const s = service.toLowerCase().trim();
  const a = action.toLowerCase().trim();

  if (s === "google" || s === "gdocs" || s === "gdrive") {
    if (a === "docs.create" || a === "create_doc" || a === "write") {
      return hub.googleDocsWrite(String(payload.title ?? "Untitled"), String(payload.content ?? ""));
    }
    if (a === "docs.read" || a === "read") {
      return hub.googleDocsRead(String(payload.documentId ?? payload.id ?? ""));
    }
    if (a === "drive.search" || a === "search") {
      return hub.googleDriveSearch(String(payload.query ?? ""));
    }
    return `Unknown Google Workspace action "${action}". Try: docs.create, docs.read, drive.search`;
  }

  if (s === "gmail") {
    if (a === "gmail.summary" || a === "summary" || a === "inbox") {
      return hub.gmailSummary(
        Number(payload.limit ?? 10),
        Boolean(payload.unreadOnly),
      );
    }
    if (a === "gmail.draft" || a === "draft") {
      return hub.gmailDraft(
        String(payload.to ?? ""),
        String(payload.subject ?? ""),
        String(payload.body ?? ""),
      );
    }
    if (a === "gmail.send" || a === "send") {
      return hub.gmailSend(
        String(payload.to ?? ""),
        String(payload.subject ?? ""),
        String(payload.body ?? ""),
      );
    }
    return `Unknown Gmail action "${action}". Try: gmail.summary, gmail.draft, gmail.send`;
  }

  if (s === "notion") {
    if (a === "search") return hub.notionSearch(String(payload.query ?? ""));
    if (a === "read") return hub.notionRead(String(payload.pageId ?? payload.id ?? ""));
    if (a === "write" || a === "create") {
      return hub.notionWrite(
        String(payload.title ?? "Untitled"),
        String(payload.content ?? ""),
        payload.parentId ? String(payload.parentId) : undefined,
      );
    }
    return `Unknown Notion action "${action}". Try: search, read, write`;
  }

  if (s === "github") {
    if (a === "issue.create" || a === "create_issue" || a === "issue") {
      return hub.githubCreateIssue(
        String(payload.repo ?? ""),
        String(payload.title ?? ""),
        String(payload.body ?? ""),
      );
    }
    return `Unknown GitHub action "${action}". Try: issue.create`;
  }

  if (s === "obsidian") {
    const { writeFile } = await import("@heyagent/computer");
    const { join } = await import("node:path");
    const { homedir } = await import("node:os");
    const vault = String(payload.vault ?? join(homedir(), "Documents", "Obsidian"));
    const name = String(payload.title ?? "heyagent-note").replace(/[^\w\- ]+/g, "") + ".md";
    const path = join(vault, name);
    await writeFile(path, String(payload.content ?? ""));
    return `Wrote Obsidian note: ${path} (open vault manually if needed)`;
  }

  if (s === "slack" || s === "trello") {
    return `${s} needs API credentials. Use hey connect later or browser.open for web UI.`;
  }

  return `Unknown service "${service}". Supported: google, notion, github, obsidian`;
}

export async function ensureHeyAgentHome(): Promise<void> {
  await ensureDir(getHeyAgentHome(), { mkdir } as typeof import("node:fs/promises"));
  await ensureDir(getCredentialsDir(), { mkdir } as typeof import("node:fs/promises"));
}

function isValidGoogleAccessToken(token: string): boolean {
  const value = token.trim();
  if (!value) return false;
  if (/^https?:\/\//i.test(value)) return false;
  if (value.includes(" ") || value.includes("\n")) return false;
  // Real Google user access tokens usually start with ya29.
  // Also accept long opaque tokens from some OAuth flows.
  return value.startsWith("ya29.") || value.length >= 40;
}

function cleanMailSnippet(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320);
}

function formatMailDate(headerDate: string, internalDate?: string): string {
  const date = headerDate ? new Date(headerDate) : new Date(Number(internalDate ?? Date.now()));
  if (Number.isNaN(date.getTime())) return headerDate || "неизвестно";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function decodeMimeHeader(value: string): string {
  return value.replace(
    /=\?([^?]+)\?([bqBQ])\?([^?]+)\?=/g,
    (_match, charset: string, encoding: string, data: string) => {
      try {
        const bytes =
          encoding.toLowerCase() === "b"
            ? Buffer.from(data, "base64")
            : Buffer.from(
                data
                  .replace(/_/g, " ")
                  .replace(/=([0-9A-F]{2})/gi, (_m, hex: string) =>
                    String.fromCharCode(Number.parseInt(hex, 16)),
                  ),
                "binary",
              );
        return new TextDecoder(charset.toLowerCase()).decode(bytes);
      } catch {
        return data;
      }
    },
  );
}
