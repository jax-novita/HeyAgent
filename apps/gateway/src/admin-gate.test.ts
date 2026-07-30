import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldRequestAdmin } from "./index.js";

test("admin is opt-in: default (undefined) does NOT request UAC", () => {
  assert.equal(shouldRequestAdmin(undefined, {}, "win32"), false);
});

test("admin requested when explicitly enabled in config", () => {
  assert.equal(shouldRequestAdmin(true, {}, "win32"), true);
});

test("admin requested via HEYAGENT_ADMIN=1 env", () => {
  assert.equal(shouldRequestAdmin(undefined, { HEYAGENT_ADMIN: "1" }, "win32"), true);
});

test("HEYAGENT_NO_ADMIN always wins", () => {
  assert.equal(
    shouldRequestAdmin(true, { HEYAGENT_ADMIN: "1", HEYAGENT_NO_ADMIN: "1" }, "win32"),
    false,
  );
});

test("never requests admin off Windows", () => {
  assert.equal(shouldRequestAdmin(true, { HEYAGENT_ADMIN: "1" }, "linux"), false);
  assert.equal(shouldRequestAdmin(true, {}, "darwin"), false);
});
