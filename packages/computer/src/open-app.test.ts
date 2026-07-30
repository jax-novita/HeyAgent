import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeAppKey } from "./index.js";

test("normalizeAppKey: Visual Studio Code aliases", () => {
  for (const name of [
    "Visual Studio Code",
    "visual studio code",
    "VS Code",
    "vscode",
    "code",
    "Code",
  ]) {
    assert.equal(normalizeAppKey(name), "code", name);
  }
});

test("normalizeAppKey: browsers and telegram", () => {
  assert.equal(normalizeAppKey("Яндекс Браузер"), "yandex");
  assert.equal(normalizeAppKey("Google Chrome"), "chrome");
  assert.equal(normalizeAppKey("telegram"), "telegram");
});
