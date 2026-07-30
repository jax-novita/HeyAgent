import { test } from "node:test";
import assert from "node:assert/strict";
import { routeTask } from "./router.js";
import { buildPlan, nextPendingStep, markStep } from "./planner.js";
import {
  buildToolSelection,
  applyToolSelection,
  forbiddenToolsForRoute,
} from "./tool-select.js";
import { withRetry, withToolResultRetry } from "./retry.js";
import {
  beginStep,
  completeStep,
  patchScratch,
  formatScratchBlock,
  getCurrentStep,
  inferStepFromTool,
} from "./step-runner.js";
import type { Mission } from "./types.js";

test("tool-select: quiz open_tab forbids telegram", () => {
  const r = routeTask("пройди тест по математике");
  const forbid = forbiddenToolsForRoute(r);
  assert.ok(forbid.includes("telegram.message"));
  const plan = buildPlan("пройди тест", r);
  const sel = buildToolSelection(r, plan, nextPendingStep(plan));
  assert.ok(sel.preferred.some((t) => t.startsWith("browser")));
  assert.match(sel.planBlock, /NEXT STEP|ACTIVE PLAN/i);
});

test("tool-select: google docs forbids telegram and prefers docs tools", () => {
  const r = routeTask("напиши мне реферат в google docs по теме криптография");
  const forbid = forbiddenToolsForRoute(r);
  assert.ok(forbid.includes("telegram.message"));
  assert.ok(forbid.includes("telegram.wait_reply"));
  assert.ok(forbid.includes("youtube.open_lesson"));
  assert.ok(forbid.includes("screen.see"));
  const plan = buildPlan(r.slots.query || "docs", r);
  const sel = buildToolSelection(r, plan);
  assert.ok(sel.preferred.includes("google.docs.write"));
  assert.equal(sel.preferred.includes("screen.see"), false);
  assert.equal(sel.preferred.includes("telegram.message"), false);
});

test("tool-select: local essay prefers notepad.write", () => {
  const r = routeTask("напиши реферат по криптографии");
  const sel = buildToolSelection(r, buildPlan("essay", r));
  assert.ok(sel.preferred.includes("notepad.write"));
  assert.ok(forbiddenToolsForRoute(r).includes("telegram.message"));
});

test("tool-select: applyToolSelection drops forbidden and prefers browser", () => {
  const r = routeTask("я открыл тест пройди");
  const plan = buildPlan(r.slots.tabQuery || "тест", r);
  const sel = buildToolSelection(r, plan);
  const tools = applyToolSelection(
    [
      { name: "telegram.message" },
      { name: "browser.tabs.list" },
      { name: "file.read" },
      { name: "browser.tabs.focus" },
    ],
    sel,
  );
  assert.equal(tools.some((t) => t.name === "telegram.message"), false);
  assert.equal(tools[0]?.name.startsWith("browser"), true);
});

test("retry: withRetry succeeds on second attempt", async () => {
  let n = 0;
  const v = await withRetry(
    async () => {
      n++;
      if (n < 2) throw new Error("fail");
      return "ok";
    },
    { times: 3, baseMs: 1 },
  );
  assert.equal(v, "ok");
  assert.equal(n, 2);
});

test("retry: withToolResultRetry retries ERROR once", async () => {
  let n = 0;
  const v = await withToolResultRetry(
    async () => {
      n++;
      return n === 1 ? "ERROR: nope" : "OK done";
    },
    { times: 2, baseMs: 1 },
  );
  assert.equal(v, "OK done");
  assert.equal(n, 2);
});

test("step-runner: begin/complete keeps plan index", () => {
  const r = routeTask("открой блокнот");
  const plan = buildPlan("открой блокнот", r);
  let mission: Mission = {
    id: "m1",
    kind: "one_shot",
    domain: r.domain,
    agent: r.agent,
    status: "running",
    goal: "открой блокнот",
    plan,
    requiresUi: false,
    checkpoint: { planStepIndex: 0, transcript: [] },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  mission = beginStep(mission);
  assert.equal(getCurrentStep(mission.plan)?.status, "running");
  const stepId = getCurrentStep(mission.plan)!.id;
  mission = completeStep(mission, "done", "ok", stepId);
  assert.equal(mission.plan.steps.find((s) => s.id === stepId)?.status, "done");
  mission = patchScratch(mission, { lastTool: "app.open" });
  assert.match(formatScratchBlock(mission), /lastTool/);
});

test("planner: open_tab has multi-step quiz plan", () => {
  const r = routeTask("пройди тест который я открыл");
  const plan = buildPlan("пройди тест", r);
  assert.ok(plan.steps.length >= 2);
  assert.equal(plan.steps[0]?.kind, "browser_open_and_verify");
});

test("markStep / nextPendingStep still work", () => {
  const r = routeTask("выключи звук");
  let plan = buildPlan("выключи звук", r);
  const first = nextPendingStep(plan)!;
  plan = markStep(plan, first.id, "done");
  const next = nextPendingStep(plan);
  assert.ok(!next || next.id !== first.id);
});

test("step-runner: unrelated tool cannot consume a custom step", () => {
  const r = routeTask("открой сайт example.com");
  let plan = buildPlan("открыть сайт", r);
  plan = markStep(plan, plan.steps[0]!.id, "done");
  assert.equal(inferStepFromTool(plan, "web.search"), undefined);
  assert.equal(inferStepFromTool(plan, "screen.see")?.kind, "custom");
});

test("step-runner: tool advances the running step before pending steps", () => {
  const r = routeTask("выключи звук");
  let plan = buildPlan("выключи звук", r);
  plan = markStep(plan, plan.steps[0]!.id, "running");
  assert.equal(inferStepFromTool(plan, "system.control")?.id, plan.steps[0]!.id);
});
