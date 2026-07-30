/**
 * Google OAuth with a FIXED loopback redirect.
 * Avoids gog's random-port callbacks that break Web clients (redirect_uri_mismatch).
 */
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/** Default loopback callback — must match Console character-for-character. */
export const GOOGLE_OAUTH_PORT = 19876;
export const GOOGLE_OAUTH_PATH = "/";
export const GOOGLE_OAUTH_REDIRECT = `http://127.0.0.1:${GOOGLE_OAUTH_PORT}`;
export const GOOGLE_OAUTH_REDIRECT_LOCALHOST = `http://localhost:${GOOGLE_OAUTH_PORT}`;

export const GOOGLE_OAUTH_REDIRECT_CHOICES = [
  "http://127.0.0.1:19876",
  "http://127.0.0.1:19876/",
  "http://localhost:19876",
  "http://localhost:19876/",
  "http://127.0.0.1:28790/oauth/google",
  "http://localhost:28790/oauth/google",
] as const;

export const GOOGLE_WORKSPACE_SCOPES = [
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/presentations",
].join(" ");

export interface GoogleClientSecret {
  type: "desktop" | "web";
  clientId: string;
  clientSecret: string;
}

export interface GoogleTokenResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  clientId: string;
  clientSecret?: string;
}

export async function loadGoogleClientSecretJson(path: string): Promise<GoogleClientSecret> {
  const raw = JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
  const installed = raw.installed as Record<string, unknown> | undefined;
  const web = raw.web as Record<string, unknown> | undefined;

  if (installed?.client_id && installed?.client_secret) {
    return {
      type: "desktop",
      clientId: String(installed.client_id),
      clientSecret: String(installed.client_secret),
    };
  }
  if (web?.client_id && web?.client_secret) {
    return {
      type: "web",
      clientId: String(web.client_id),
      clientSecret: String(web.client_secret),
    };
  }

  // Reject bare client_id dumps — they cause redirect_uri_mismatch chaos.
  if (raw.client_id && !raw.client_secret && !installed && !web) {
    throw new Error(
      "Это не полный JSON от Google. Нужен скачанный client_secret_*.json " +
        "(внутри блок \"installed\" или \"web\" + client_secret). " +
        "Не вставляй один только Client ID.",
    );
  }

  throw new Error(
    "Неверный OAuth JSON. В Google Cloud: Credentials → Create OAuth client → " +
      "Desktop app → Download JSON.",
  );
}

export function buildGoogleAuthUrl(
  clientId: string,
  redirectUri: string,
  codeChallenge: string,
  scopes = GOOGLE_WORKSPACE_SCOPES,
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes,
    access_type: "offline",
    prompt: "consent",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/**
 * Find the newest downloaded Desktop OAuth client JSON so the common flow is:
 * download once, then run `npx hey connect google` with no path arguments.
 */
export async function findGoogleClientSecretJson(
  explicitPath?: string,
  roots = defaultClientSecretRoots(),
): Promise<string | null> {
  const direct = explicitPath?.trim().replace(/^["']|["']$/g, "");
  if (direct) {
    const path = isAbsolute(direct) ? direct : resolve(direct);
    await loadGoogleClientSecretJson(path);
    return path;
  }

  const envPath = process.env.GOOGLE_OAUTH_CLIENT_JSON?.trim();
  if (envPath) {
    const path = isAbsolute(envPath) ? envPath : resolve(envPath);
    await loadGoogleClientSecretJson(path);
    return path;
  }

  const candidates: Array<{ path: string; modifiedAt: number }> = [];
  for (const root of roots) {
    let names: string[];
    try {
      names = await readdir(root);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!/(?:client_secret|credentials).+\.json$/i.test(name)) continue;
      const path = join(root, name);
      try {
        await loadGoogleClientSecretJson(path);
        candidates.push({ path, modifiedAt: (await stat(path)).mtimeMs });
      } catch {
        // Ignore unrelated JSON files.
      }
    }
  }
  return candidates.sort((left, right) => right.modifiedAt - left.modifiedAt)[0]?.path ?? null;
}

function defaultClientSecretRoots(): string[] {
  return [
    process.cwd(),
    join(homedir(), "Downloads"),
    join(homedir(), "Desktop"),
    join(homedir(), "Documents"),
  ];
}

export function makePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function openUrl(url: string): void {
  if (process.platform === "win32") {
    // Let Windows resolve the user's default browser directly. A hidden
    // PowerShell Start-Process can be blocked by execution policy and its
    // failure used to be invisible because stderr is intentionally detached.
    spawn("explorer.exe", [url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
    return;
  }
  const cmd = process.platform === "darwin" ? "open" : "xdg-open";
  spawn(cmd, [url], { detached: true, stdio: "ignore" }).unref();
}

export function waitForOAuthCode(redirectUri = GOOGLE_OAUTH_REDIRECT): Promise<string> {
  const parsed = new URL(redirectUri);
  const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
  const host = parsed.hostname === "localhost" ? "127.0.0.1" : parsed.hostname;
  const expectedPath = parsed.pathname || "/";

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      const pathOk =
        url.pathname === expectedPath ||
        (expectedPath === "/" && (url.pathname === "/" || url.pathname === ""));
      if (!pathOk && url.searchParams.has("code")) {
        // Still accept code if Google hit our port (path typos).
      } else if (!pathOk && !url.searchParams.has("code")) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      if (error || !code) {
        res.writeHead(400);
        res.end(`<h2>OAuth error</h2><p>${error ?? "code missing"}</p>`);
        server.close();
        reject(new Error(error ?? "OAuth code missing"));
        return;
      }
      res.writeHead(200);
      res.end("<h2>HeyAgent подключён к Google</h2><p>Можно закрыть окно.</p>");
      server.close();
      resolve(code);
    });
    server.on("error", (err) => {
      reject(
        new Error(
          `Не удалось слушать ${host}:${port} — ${err.message}. Занято? Смени порт в redirect URI.`,
        ),
      );
    });
    server.listen(port, host);
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("OAuth timeout (5 min)"));
    }, 5 * 60_000);
    server.on("close", () => clearTimeout(timer));
  });
}

export async function exchangeGoogleCode(opts: {
  clientId: string;
  clientSecret?: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<GoogleTokenResult> {
  const body = new URLSearchParams({
    client_id: opts.clientId,
    code: opts.code,
    redirect_uri: opts.redirectUri,
    grant_type: "authorization_code",
    code_verifier: opts.codeVerifier,
  });
  // Desktop / public clients often have no usable secret — PKCE is enough.
  if (opts.clientSecret?.trim()) {
    body.set("client_secret", opts.clientSecret.trim());
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(
      `Token exchange failed: ${data.error_description ?? data.error ?? res.status}`,
    );
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString(),
    clientId: opts.clientId,
    clientSecret: opts.clientSecret?.trim() || undefined,
  };
}
