import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeDocumentRequest } from "../task-normalization.js";
import {
  buildGoogleDocsWritePayload,
  buildConstrainedDocumentContent,
  formatDocsSuccess,
  prepareDocsCompose,
} from "./docs-compose.js";

const SIMPLE_REQUEST = "напиши мне реферат в google docs по теме криптография";

test("clean request produces a structured task with no corrections", () => {
  const normalized = normalizeDocumentRequest(SIMPLE_REQUEST);

  assert.equal(normalized.originalUserMessage, SIMPLE_REQUEST);
  assert.deepEqual(normalized.task, {
    action: "create_document",
    destination: "google_docs",
    topic: "Криптография",
    documentType: "реферат",
  });
  assert.deepEqual(normalized.corrections, []);
});

test("unrelated prompt-example words are never invented", () => {
  const normalized = normalizeDocumentRequest(SIMPLE_REQUEST);
  const serialized = JSON.stringify(normalized);

  assert.doesNotMatch(serialized, /vaschnington/i);
  assert.doesNotMatch(serialized, /пайтон/i);
  assert.doesNotMatch(serialized, /вашингтон/i);
});

test("title contains only document type and topic", () => {
  const prepared = prepareDocsCompose(SIMPLE_REQUEST);
  assert.equal(prepared.title, "Реферат: Криптография");
  assert.doesNotMatch(prepared.title, /исправлено|перечитал|correction/iu);
  const prompt = JSON.stringify(prepared.generationMessages);
  assert.match(prompt, /# для названия/);
  assert.match(prompt, /\*\*текст\*\*/);
  assert.match(prompt, /<u>текст<\/u>/);
});

test("correction metadata is excluded from generation prompt and Docs payload", () => {
  const prepared = prepareDocsCompose(SIMPLE_REQUEST, (originalUserMessage) => ({
    originalUserMessage,
    task: {
      action: "create_document",
      destination: "google_docs",
      topic: "Криптография",
      documentType: "реферат",
    },
    corrections: [
      { from: "vaschnington", to: "Вашингтон", start: 999 },
      { from: "пайтон", to: "Python", start: 999 },
    ],
  }));
  const prompt = JSON.stringify(prepared.generationMessages);
  const payload = buildGoogleDocsWritePayload(
    prepared,
    [
      "<think>internal chain of thought</think>",
      "Перечитал задание (2×)",
      "исправлено: vaschnington → Вашингтон",
      "уточнена платформа: Google Docs",
      "стиль сохранён",
      "Введение",
      "Криптография защищает информацию.",
    ].join("\n"),
  );
  const serializedPayload = JSON.stringify(payload);

  assert.doesNotMatch(prompt, /vaschnington|пайтон|corrections|перечитал|исправлено/iu);
  assert.equal(payload.title, "Реферат: Криптография");
  assert.doesNotMatch(
    serializedPayload,
    /vaschnington|пайтон|вашингтон|перечитал|исправлено|уточнена платформа|стиль сохранён|chain of thought/iu,
  );
  assert.match(payload.content, /Криптография защищает информацию/);
});

test("normalization is called exactly once per compose preparation", () => {
  let calls = 0;
  prepareDocsCompose(SIMPLE_REQUEST, (message) => {
    calls += 1;
    return normalizeDocumentRequest(message);
  });
  assert.equal(calls, 1);
});

test("final response contains no internal reasoning or correction logs", () => {
  const normalized = normalizeDocumentRequest(SIMPLE_REQUEST);
  const response = formatDocsSuccess(normalized);

  assert.equal(
    response,
    "Готово — реферат по теме «Криптография» создан в Google Docs.",
  );
  assert.doesNotMatch(response, /перечитал|исправлено|correction|reasoning|think/iu);
});

test("explicit Google Docs title and sections are isolated from command metadata", () => {
  const request =
    "Создай тестовый Google Docs документ с точным названием «Тест HeyAgent». Добавь заголовок и ровно три раздела: «Цель», «Проверка», «Результат».";
  const prepared = prepareDocsCompose(request);
  assert.equal(prepared.title, "Тест HeyAgent");
  assert.deepEqual(prepared.normalized.task.requestedSections, [
    "Цель",
    "Проверка",
    "Результат",
  ]);
  assert.equal(prepared.normalized.task.oneSentencePerSection, undefined);
  assert.doesNotMatch(prepared.title, /Добавь|раздел|точным названием/iu);
  assert.match(JSON.stringify(prepared.generationMessages), /Цель, Проверка, Результат/);
});

test("Google Docs success returns the verified document URL", () => {
  const normalized = normalizeDocumentRequest(SIMPLE_REQUEST);
  const url = "https://docs.google.com/document/d/test-id/edit";
  assert.match(formatDocsSuccess(normalized, "ru", url), /test-id\/edit/);
});

test("one-sentence section constraint overrides the generic long-document prompt", () => {
  const prepared = prepareDocsCompose(
    "Создай документ с точным названием «Тест». Добавь ровно три раздела: «Цель», «Проверка», «Результат». В каждом разделе напиши одно короткое тестовое предложение.",
  );
  assert.equal(prepared.normalized.task.oneSentencePerSection, true);
  const prompt = JSON.stringify(prepared.generationMessages);
  assert.match(prompt, /exactly one short sentence/);
  assert.doesNotMatch(prompt, /800|1400|введение|introduction/iu);
  const content = buildConstrainedDocumentContent(prepared);
  assert.match(content ?? "", /^# Тест/m);
  assert.equal((content?.match(/^## /gm) ?? []).length, 3);
  assert.doesNotMatch(content ?? "", /\d{3,}|SLA|успешн\w*\s+аудит/iu);
});
