import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildGoogleDocsFormatting } from "./google-docs-format.js";
import { IntegrationsHub } from "./index.js";

function requestsOf(
  formatted: ReturnType<typeof buildGoogleDocsFormatting>,
  key: string,
): Record<string, unknown>[] {
  return formatted.requests.filter((request) => key in request);
}

test("Google Docs formatting removes markup and creates native text styles", () => {
  const formatted = buildGoogleDocsFormatting(
    [
      "# Криптография: история и применение",
      "",
      "## Введение",
      "Это **важный термин**, *пояснение* и <u>ключевой вывод</u>.",
    ].join("\n"),
  );

  assert.doesNotMatch(formatted.plainText, /\*\*|<u>|<\/u>|^#/m);
  assert.match(formatted.plainText, /важный термин/);
  assert.match(formatted.plainText, /пояснение/);
  assert.match(formatted.plainText, /ключевой вывод/);

  const textStyles = requestsOf(formatted, "updateTextStyle");
  assert.ok(
    textStyles.some((request) =>
      JSON.stringify(request).includes('"textStyle":{"bold":true}'),
    ),
  );
  assert.ok(
    textStyles.some((request) =>
      JSON.stringify(request).includes('"textStyle":{"italic":true}'),
    ),
  );
  assert.ok(
    textStyles.some((request) =>
      JSON.stringify(request).includes('"textStyle":{"underline":true}'),
    ),
  );
});

test("Google Docs formatting creates title, headings and real lists", () => {
  const formatted = buildGoogleDocsFormatting(
    [
      "**Реферат: Криптография**",
      "**Введение**",
      "- Конфиденциальность",
      "- Целостность",
      "1. Симметричные алгоритмы",
      "2. Асимметричные алгоритмы",
    ].join("\n"),
  );
  const serialized = JSON.stringify(formatted.requests);

  assert.doesNotMatch(formatted.plainText, /\*\*/);
  assert.match(serialized, /"namedStyleType":"TITLE"/);
  assert.match(serialized, /"namedStyleType":"HEADING_1"/);
  assert.match(serialized, /BULLET_DISC_CIRCLE_SQUARE/);
  assert.match(serialized, /NUMBERED_DECIMAL_NESTED/);
  assert.match(serialized, /"alignment":"JUSTIFIED"/);
});

test("Google Docs formatting converts LaTeX formulas before insertion", () => {
  const formatted = buildGoogleDocsFormatting(
    "**Формулы**\n\\( \\psi = c\\_1 \\psi\\_1 + c\\_2 \\psi\\_2 \\)\n\\[ \\Delta x \\cdot \\Delta p \\geq \\frac{\\hbar}{2}. \\]",
  );

  assert.match(formatted.plainText, /ψ = c₁ ψ₁ \+ c₂ ψ₂/);
  assert.match(formatted.plainText, /Δ x · Δ p ≥ ℏ\/2/);
  assert.doesNotMatch(formatted.plainText, /\\|frac|cdot|\*\*/);
});

test("googleDocsWrite sends clean text and formatting operations in one batchUpdate", async () => {
  const previousHome = process.env.HEYAGENT_HOME;
  const previousFetch = globalThis.fetch;
  const root = await mkdtemp(join(tmpdir(), "heyagent-docs-format-test-"));
  process.env.HEYAGENT_HOME = root;
  let batchBody: { requests?: Record<string, unknown>[] } | undefined;

  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url === "https://docs.googleapis.com/v1/documents") {
      return new Response(JSON.stringify({ documentId: "formatted-doc-id" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes(":batchUpdate")) {
      batchBody = JSON.parse(String(init?.body)) as {
        requests?: Record<string, unknown>[];
      };
      return new Response(JSON.stringify({ replies: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const hub = new IntegrationsHub();
    await hub.saveGoogleCredentials({
      mode: "oauth",
      accessToken: `ya29.${"x".repeat(64)}`,
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    const result = await hub.googleDocsWrite(
      "Реферат: Криптография",
      "# Криптография\nЭто **важно** и <u>нужно подчеркнуть</u>.",
    );
    const serialized = JSON.stringify(batchBody);

    assert.match(result, /formatted-doc-id/);
    assert.doesNotMatch(serialized, /\*\*|<u>|<\/u>/);
    assert.match(serialized, /"bold":true/);
    assert.match(serialized, /"underline":true/);
    assert.match(serialized, /"namedStyleType":"TITLE"/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousHome === undefined) delete process.env.HEYAGENT_HOME;
    else process.env.HEYAGENT_HOME = previousHome;
  }
});

test("googleDocsWrite rejects a successful HTTP response with no documentId", async () => {
  const previousHome = process.env.HEYAGENT_HOME;
  const previousFetch = globalThis.fetch;
  const root = await mkdtemp(join(tmpdir(), "heyagent-docs-invalid-test-"));
  process.env.HEYAGENT_HOME = root;
  let batchCalled = false;

  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url === "https://docs.googleapis.com/v1/documents") {
      return new Response(JSON.stringify({ documentId: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    batchCalled = true;
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const hub = new IntegrationsHub();
    await hub.saveGoogleCredentials({
      mode: "oauth",
      accessToken: `ya29.${"x".repeat(64)}`,
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    const result = await hub.googleDocsWrite("Test", "Content");
    assert.match(result, /^ERROR: .*documentId/);
    assert.equal(batchCalled, false);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousHome === undefined) delete process.env.HEYAGENT_HOME;
    else process.env.HEYAGENT_HOME = previousHome;
  }
});
