import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IntegrationsHub } from "./index.js";

async function withHub(
  fetchImpl: typeof fetch,
  run: (hub: IntegrationsHub) => Promise<void>,
): Promise<void> {
  const previousHome = process.env.HEYAGENT_HOME;
  const previousFetch = globalThis.fetch;
  process.env.HEYAGENT_HOME = await mkdtemp(join(tmpdir(), "heyagent-workspace-format-"));
  globalThis.fetch = fetchImpl;
  try {
    const hub = new IntegrationsHub();
    await hub.saveGoogleCredentials({
      mode: "oauth",
      accessToken: `ya29.${"x".repeat(64)}`,
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    await run(hub);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousHome === undefined) delete process.env.HEYAGENT_HOME;
    else process.env.HEYAGENT_HOME = previousHome;
  }
}

test("Sheets receives Unicode values plus native header/table formatting", async () => {
  let appended = "";
  let formatted = "";
  await withHub(
    (async (input, init) => {
      const url = String(input);
      if (url === "https://sheets.googleapis.com/v4/spreadsheets") {
        return new Response(
          JSON.stringify({
            spreadsheetId: "sheet-id",
            sheets: [{ properties: { sheetId: 7 } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/values/")) appended = String(init?.body);
      else if (url.endsWith(":batchUpdate")) formatted = String(init?.body);
      else throw new Error(`Unexpected fetch: ${url}`);
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
    async (hub) => {
      await hub.googleSheetsCreate(
        "**Физика**",
        "Формула,Значение\nНеопределённость,\\Delta x \\cdot \\Delta p \\geq \\frac{\\hbar}{2}",
      );
    },
  );

  assert.match(appended, /Δ x · Δ p ≥ ℏ\/2/);
  assert.doesNotMatch(appended, /\\|frac|cdot|\*\*/);
  assert.match(formatted, /frozenRowCount/);
  assert.match(formatted, /"bold":true/);
  assert.match(formatted, /autoResizeDimensions/);
});
test("Slides receives clean Unicode text and native slide typography", async () => {
  let batch = "";
  await withHub(
    (async (input, init) => {
      const url = String(input);
      if (url === "https://slides.googleapis.com/v1/presentations") {
        return new Response(
          JSON.stringify({
            presentationId: "presentation-id",
            slides: [{ objectId: "default-slide" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith(":batchUpdate")) {
        batch = String(init?.body);
        return new Response("{}", { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch,
    async (hub) => {
      await hub.googleSlidesCreate(
        "**Квантовая физика**",
        JSON.stringify([
          {
            title: "**Принцип неопределённости**",
            bullets: ["\\Delta x \\cdot \\Delta p \\geq \\frac{\\hbar}{2}"],
          },
        ]),
      );
    },
  );

  assert.match(batch, /Δ x · Δ p ≥ ℏ\/2/);
  assert.doesNotMatch(batch, /\\Delta|\\frac|\*\*/);
  assert.match(batch, /createShape/);
  assert.match(batch, /"bold":true/);
  assert.match(batch, /createParagraphBullets/);
  assert.match(batch, /deleteObject/);
});
