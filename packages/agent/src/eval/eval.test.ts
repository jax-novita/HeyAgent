import { test } from "node:test";
import assert from "node:assert/strict";
import { runEvalPack } from "./runner.js";
import { predictDispatch } from "../predict-dispatch.js";
import { heuristicSummarize } from "../compaction.js";

test("eval pack: all mock scenarios pass", async () => {
  const report = await runEvalPack({});
  assert.equal(report.total, 29, `expected 29 scenarios, got ${report.total}`);
  if (report.failed) {
    const fails = report.results
      .filter((r) => !r.passed)
      .map((r) => `${r.id}: ${r.error ?? r.checks.filter((c) => !c.ok).map((c) => c.detail).join("; ")}`);
    assert.fail(`failed:\n${fails.join("\n")}`);
  }
  assert.ok(report.harnessHitRate > 0.5);
});

test("predict: quiz not telegram", () => {
  const p = predictDispatch("я открыл тест по математике пройди его");
  assert.equal(p.effectiveHarness, "open_tab");
  assert.ok(p.forbiddenTools.includes("telegram.message"));
});

test("heuristic summarize extracts actions", () => {
  const s = heuristicSummarize(
    [
      { role: "user", content: "task" },
      { role: "assistant", content: "[actions]\n- notepad.write: ok\nDONE" },
    ],
    "task",
  );
  assert.ok(s.completed.some((c) => /notepad/i.test(c)));
});
