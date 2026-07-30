import { test } from "node:test";
import assert from "node:assert/strict";
import { detectNotepadComposeIntent } from "./notepad-compose.js";

test("notepad compose: рассказ о мальчике → story, not poem", () => {
  const i = detectNotepadComposeIntent(
    "создай файл в блокноте и напиши мне там рассказ о маленьком мальчике",
  );
  assert.ok(i);
  assert.equal(i!.genre, "story");
  assert.match(i!.topic.toLowerCase(), /мальчик/);
  assert.equal(i!.destination, "desktop");
});

test("notepad compose: стишок stays poem", () => {
  const i = detectNotepadComposeIntent("открой блокнот и напиши короткий стишок про кота");
  assert.ok(i);
  assert.equal(i!.genre, "poem");
});

test("notepad compose: ignores unrelated chat", () => {
  assert.equal(detectNotepadComposeIntent("открой ютуб"), null);
  assert.equal(detectNotepadComposeIntent("который час"), null);
});

test("notepad compose: Google Docs essay is NOT notepad", () => {
  assert.equal(
    detectNotepadComposeIntent(
      "открой мне google documents в яндекс браузере и напиши там реферат по теме криптография",
    ),
    null,
  );
});

test("notepad compose: Git workflow is NOT a text-note request", () => {
  assert.equal(
    detectNotepadComposeIntent(
      "Создай Git-репозиторий, добавь README.md с текстом HeyAgent audit и сделай commit",
    ),
    null,
  );
});
