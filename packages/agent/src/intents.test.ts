import { test } from "node:test";
import assert from "node:assert/strict";
import { detectMailIntent } from "./harness/intents.js";
import { cleanupLine } from "./cleanup.js";
import { predictDispatch } from "./predict-dispatch.js";
import { detectCronScheduleIntent } from "./harness/cron-intent.js";

test("mail intent: explicit mail requests are detected", () => {
  assert.equal(detectMailIntent("проверь почту")?.kind, "check");
  assert.equal(detectMailIntent("открой gmail")?.kind, "open");
  assert.equal(detectMailIntent("напиши письмо ivan@mail.ru")?.kind, "compose");
  assert.equal(detectMailIntent("ответь на письмо: спасибо")?.kind, "reply");
});

test("mail intent: telegram/other channels never route to Gmail", () => {
  assert.equal(detectMailIntent("ответь алексу в telegram"), null);
  assert.equal(detectMailIntent("напиши алексу в телеграм привет"), null);
  assert.equal(detectMailIntent("ответь ему в whatsapp"), null);
  assert.equal(detectMailIntent("ответь в тг"), null);
  assert.equal(detectMailIntent("ответь ему что все ок"), null);
});

test("chat-until: router+harness picks contact (not pronoun)", () => {
  const p = predictDispatch("напиши алексу и общайся с ним до прощания");
  assert.equal(p.effectiveHarness, "telegram_conversation");
  assert.match((p.slots.contact || "").toLowerCase(), /алекс/);
});

test("chat-until: plain message is one-shot or not conversation", () => {
  const p = predictDispatch("напиши алексу привет");
  assert.notEqual(p.effectiveHarness, "telegram_conversation");
});

test("cron NL intent", () => {
  const c = detectCronScheduleIntent("напоминай мне каждые 30 минут проверить почту");
  assert.ok(c);
  assert.equal(c!.everyMinutes, 30);
  assert.match(c!.prompt.toLowerCase(), /почт/);
});

test("cleanupLine strips quotes and label prefixes the model adds", () => {
  assert.equal(cleanupLine('"Привет, как дела?"'), "Привет, как дела?");
  assert.equal(cleanupLine("«Ну норм»"), "Ну норм");
  assert.equal(cleanupLine("сообщение: Привет"), "Привет");
  assert.equal(cleanupLine("Reply: hi there"), "hi there");
});

test("cleanupLine strips leaked <think> blocks", () => {
  const dirty = `<think>
Here's a thinking process:
1. Analyze
</think>

Открой ментоловый дым.`;
  assert.equal(cleanupLine(dirty), "Открой ментоловый дым.");
});
