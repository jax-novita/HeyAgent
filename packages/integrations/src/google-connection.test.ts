import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GOOGLE_WORKSPACE_SCOPES,
  buildGoogleAuthUrl,
  findGoogleClientSecretJson,
} from "./google-oauth.js";
import { IntegrationsHub } from "./index.js";

test("Google Workspace OAuth scopes intentionally exclude Gmail", () => {
  assert.match(GOOGLE_WORKSPACE_SCOPES, /documents/);
  assert.match(GOOGLE_WORKSPACE_SCOPES, /drive/);
  assert.match(GOOGLE_WORKSPACE_SCOPES, /spreadsheets/);
  assert.match(GOOGLE_WORKSPACE_SCOPES, /presentations/);
  assert.doesNotMatch(GOOGLE_WORKSPACE_SCOPES, /gmail/i);
  const url = buildGoogleAuthUrl("client", "http://127.0.0.1:19876", "challenge");
  assert.doesNotMatch(decodeURIComponent(url), /gmail/i);
});

test("OAuth JSON is automatically discovered in a download directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "heyagent-google-test-"));
  const path = join(root, "client_secret_example.apps.googleusercontent.com.json");
  await writeFile(path, JSON.stringify({
    installed: {
      client_id: "example.apps.googleusercontent.com",
      client_secret: "secret",
    },
  }), "utf8");
  assert.equal(await findGoogleClientSecretJson(undefined, [root]), path);
});

test("legacy Gmail credentials migrate separately before Workspace OAuth is saved", async () => {
  const previousHome = process.env.HEYAGENT_HOME;
  const root = await mkdtemp(join(tmpdir(), "heyagent-credentials-test-"));
  process.env.HEYAGENT_HOME = root;
  try {
    const hub = new IntegrationsHub();
    await hub.saveGoogleCredentials({
      mode: "imap",
      email: "owner@example.com",
      appPassword: "abcdefghijklmnop",
    });
    assert.equal(await hub.hasCredentials("gmail"), true);
    assert.equal(await hub.hasCredentials("google"), false);

    await hub.saveGoogleCredentials({
      mode: "oauth",
      accessToken: `ya29.${"x".repeat(48)}`,
      refreshToken: "refresh",
      expiresAt: "2099-01-01T00:00:00.000Z",
      clientId: "client",
      clientSecret: "secret",
    });
    assert.equal(await hub.hasCredentials("gmail"), true);
    assert.equal(await hub.hasCredentials("google"), true);
    const gmail = JSON.parse(
      await readFile(join(root, "credentials", "gmail.json"), "utf8"),
    ) as { email?: string };
    assert.equal(gmail.email, "owner@example.com");
  } finally {
    if (previousHome === undefined) delete process.env.HEYAGENT_HOME;
    else process.env.HEYAGENT_HOME = previousHome;
  }
});
