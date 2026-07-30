import { test } from "node:test";
import assert from "node:assert/strict";
import { ToolLoopGuard } from "./tool-loop.js";

test("tool loop guard warns then breaks", () => {
  const g = new ToolLoopGuard(4);
  assert.equal(g.check("browser.open", { url: "x" }), null);
  assert.equal(g.check("browser.open", { url: "x" }), null);
  const warn = g.check("browser.open", { url: "x" });
  assert.ok(warn?.startsWith("LOOP_WARN"));
  const br = g.check("browser.open", { url: "x" });
  assert.ok(br?.startsWith("LOOP_BREAK"));
});

test("different args do not loop", () => {
  const g = new ToolLoopGuard(3);
  assert.equal(g.check("a", { n: 1 }), null);
  assert.equal(g.check("a", { n: 2 }), null);
  assert.equal(g.check("a", { n: 3 }), null);
});
