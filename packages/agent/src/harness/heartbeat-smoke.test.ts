import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureWorkspace, readHeartbeatChecklist } from "@heyagent/identity";
import { predictDispatch } from "../predict-dispatch.js";

test("heartbeat: workspace has HEARTBEAT.md checklist", async () => {
  await ensureWorkspace();
  const hb = await readHeartbeatChecklist();
  assert.match(hb, /HEARTBEAT/i);
  assert.match(hb, /digest|новост|cron/i);
});

test("predict: news digest harness", () => {
  const p = predictDispatch("собери новости мира и сделай pdf отчёт");
  assert.equal(p.effectiveHarness, "research.digest");
  assert.ok(p.forbiddenTools.includes("telegram.message"));
});

test("predict: presentation harness", () => {
  const p = predictDispatch("сделай презентацию про криптографию");
  assert.equal(p.effectiveHarness, "presentation.create");
});
