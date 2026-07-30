import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  generateId,
  PRODUCT_NAME,
  CLI_NAME,
  normalizeLocale,
  resolveLocale,
  preserveUserMessage,
} from "./index.js";

describe("shared", () => {
  it("has product constants", () => {
    assert.equal(PRODUCT_NAME, "HeyAgent");
    assert.equal(CLI_NAME, "hey");
  });

  it("generates unique ids", () => {
    const a = generateId("test");
    const b = generateId("test");
    assert.notEqual(a, b);
    assert.ok(a.startsWith("test_"));
  });

  it("normalizes supported product locales without inspecting user text", () => {
    assert.equal(normalizeLocale("ru"), "ru");
    assert.equal(normalizeLocale("en"), "en");
    assert.equal(normalizeLocale("de"), "ru");
    assert.equal(resolveLocale({ user: { locale: "ru" } }), "ru");
    assert.equal(resolveLocale({}), "ru");
  });

  it("preserves the exact user request independently of locale", () => {
    const original = "  Напиши report в Google Docs: Crypto?!\n";
    assert.equal(preserveUserMessage(original), original);
    assert.equal(preserveUserMessage(original), original);
  });
});
