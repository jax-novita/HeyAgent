import { test } from "node:test";
import assert from "node:assert/strict";
import { detectTimeIntent } from "./clock.js";
import {
  detectSystemControlIntent,
  validateSystemControlParams,
} from "./system-suite.js";
import {
  correctYoutubeQuery,
  detectYoutubeOpenMode,
  extractYoutubeLessonQuery,
} from "./youtube-open.js";
import { telegramComposerPoint } from "./index.js";

test("time intent detection", () => {
  assert.equal(detectTimeIntent("который час"), true);
  assert.equal(detectTimeIntent("сколько сейчас времени"), true);
  assert.equal(detectTimeIntent("какое сегодня число"), true);
  assert.equal(detectTimeIntent("открой блокнот"), false);
});

test("system control intent: volume / brightness / mute", () => {
  assert.equal(detectSystemControlIntent("выключи звук")?.action, "mute");
  assert.equal(detectSystemControlIntent("сделай громкость 40")?.action, "volume_set");
  assert.equal(detectSystemControlIntent("увеличь яркость на 20")?.action, "brightness_delta");
  assert.equal(detectSystemControlIntent("расскажи анекдот"), null);
});

test("system control validation is an explicit discriminated result", () => {
  assert.equal(validateSystemControlParams(null).ok, false);
  assert.equal(validateSystemControlParams({}).ok, false);
  assert.equal(validateSystemControlParams({ action: "not_real" }).ok, false);
  assert.equal(validateSystemControlParams({ action: "mute" }).ok, true);
});

test("youtube: typo correction normalizes place names", () => {
  // «васшингтон» → canonical washington token (regression for wrong-city bug)
  const fixed = correctYoutubeQuery("урок про васшингтон").toLowerCase();
  assert.match(fixed, /вашингтон|washington/);
});

test("youtube: lesson query extracted after «про»", () => {
  const q = extractYoutubeLessonQuery("открой видео на ютубе про Вашингтон");
  assert.ok(q, "should extract a topic");
  assert.match(q!.toLowerCase(), /вашингтон/);
});

test("youtube: «открой мне …» extracts query without saying youtube", () => {
  const q = extractYoutubeLessonQuery("открой мне дым сигарет с ментолом");
  assert.ok(q, "should extract topic");
  assert.match(q!.toLowerCase(), /дым/);
  assert.match(q!.toLowerCase(), /ментолом/);
});

test("youtube: Google Docs / реферат is NOT youtube", () => {
  assert.equal(
    extractYoutubeLessonQuery(
      "открой мне google documents в яндекс браузере и напиши там реферат по теме криптография",
    ),
    null,
  );
  assert.equal(extractYoutubeLessonQuery("открой google docs"), null);
});

test("youtube: open mode — quick by default, deep for lessons", () => {
  assert.equal(
    detectYoutubeOpenMode("дым сигарет с ментолом", "открой мне дым сигарет с ментолом"),
    "quick",
  );
  assert.equal(detectYoutubeOpenMode("python", "открой урок по python"), "deep");
  assert.equal(detectYoutubeOpenMode("react", "найди полный курс по react"), "deep");
});

test("telegram composer point: bottom of the chat pane, inside the window", () => {
  const rect = { left: 0, top: 0, right: 1000, bottom: 800 };
  const pt = telegramComposerPoint(rect)!;
  assert.ok(pt, "should compute a point for a normal window");
  assert.ok(pt.x > 500 && pt.x < 1000, "x is in the right-hand chat pane");
  assert.ok(pt.y > 700 && pt.y < 800, "y is near the bottom (composer)");
});

test("telegram composer point: tiny/hidden window returns null", () => {
  assert.equal(telegramComposerPoint({ left: 0, top: 0, right: 50, bottom: 50 }), null);
});
