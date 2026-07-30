import { test } from "node:test";
import assert from "node:assert/strict";
import { detectOfficeApp } from "./office-desktop.js";
import { buildReportHtml, sectionsFromMarkdown } from "./report-pdf.js";
import { buildRevealHtml } from "./presentation-deck.js";

test("detectOfficeApp: word / excel / powerpoint / wordpad", () => {
  assert.equal(detectOfficeApp("напиши в word документ"), "word");
  assert.equal(detectOfficeApp("открой excel таблицу"), "excel");
  assert.equal(detectOfficeApp("сделай powerpoint"), "powerpoint");
  assert.equal(detectOfficeApp("открой wordpad"), "wordpad");
  assert.equal(detectOfficeApp("google docs реферат"), null);
});

test("sectionsFromMarkdown + buildReportHtml", () => {
  const sections = sectionsFromMarkdown("## One\nHello\nhttps://example.com\n\n## Two\nWorld");
  assert.equal(sections.length, 2);
  const html = buildReportHtml("Digest", sections);
  assert.match(html, /Digest/);
  assert.match(html, /class="card"/);
});

test("buildRevealHtml has fragments", () => {
  const html = buildRevealHtml("Deck", [{ title: "A", bullets: ["x", "y"] }]);
  assert.match(html, /reveal\.js/);
  assert.match(html, /fragment/);
});
