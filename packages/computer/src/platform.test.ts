import { test } from "node:test";
import assert from "node:assert/strict";
import { osKind, telegramComposerPoint } from "./index.js";

test("osKind returns a known platform", () => {
  const k = osKind();
  assert.ok(["win32", "darwin", "linux", "other"].includes(k));
});

test("composer point works for any OS geometry", () => {
  const pt = telegramComposerPoint({ left: 0, top: 0, right: 1200, bottom: 800 });
  assert.ok(pt);
  assert.ok(pt!.x > 600);
  assert.ok(pt!.y > 700);
});
