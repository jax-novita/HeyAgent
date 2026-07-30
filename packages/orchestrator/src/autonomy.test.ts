import { test } from "node:test";
import assert from "node:assert/strict";
import { createEmptyWorldState, type ObservationRecord } from "@heyagent/shared";
import { ActionLedger, DuplicateWriteActionError, hashActionInput } from "./action-ledger.js";
import { planToGraph, transitionPlanGraph, validatePlanGraph } from "./plan-graph.js";
import { buildPlan } from "./planner.js";
import { routeTask } from "./router.js";
import { RecoveryEngine } from "./recovery.js";
import { createTaskContract, amendTaskContract } from "./task-contract.js";
import { WaitRegistry } from "./waits.js";
import { ConfirmedWorldStateStore } from "./world-state.js";
import { migrateMissionQueue } from "./persist.js";
import { verifyTaskContract } from "./criterion-verifier.js";

test("world state rejects assumptions and applies evidenced observations", () => {
  const store = new ConfirmedWorldStateStore(createEmptyWorldState("2026-01-01T00:00:00.000Z"));
  const observation: ObservationRecord = {
    id: "obs",
    source: "system_api",
    observedAt: "2026-01-01T00:00:01.000Z",
    summary: "active window observed",
    evidence: [{
      id: "e1",
      kind: "system_api",
      summary: "GetForegroundWindow",
      capturedAt: "2026-01-01T00:00:01.000Z",
    }],
  };
  const diff = store.applyObservation(observation, [{
    path: "desktop.activeWindowId",
    before: undefined,
    after: "42",
  }]);
  assert.equal(diff.baseVersion, 1);
  assert.equal(store.snapshot().desktop.activeWindowId, "42");
  assert.equal(store.snapshot().version, 2);
  assert.throws(
    () => store.applyObservation({ ...observation, evidence: [] }, []),
    /require.*evidence/i,
  );
});

test("action ledger stable hash and duplicate write guard survive reordered input", () => {
  assert.equal(hashActionInput({ b: 2, a: 1 }), hashActionInput({ a: 1, b: 2 }));
  const ledger = new ActionLedger();
  const record = ledger.begin({
    missionId: "m1",
    stepId: "s1",
    actionType: "telegram.send_message",
    input: { contact: "Ada", text: "hello" },
    idempotencyKey: "send:ada:hello",
  });
  ledger.complete(record.id, "succeeded");
  assert.throws(
    () => ledger.begin({
      missionId: "m1",
      stepId: "s1",
      actionType: "telegram.send_message",
      input: { text: "hello", contact: "Ada" },
      idempotencyKey: "send:ada:hello",
    }),
    DuplicateWriteActionError,
  );
});

test("linear plans remain supported through PlanGraph adapter", () => {
  const route = routeTask("open notepad");
  const plan = buildPlan("open notepad", route);
  const graph = planToGraph(plan);
  assert.deepEqual(validatePlanGraph(graph), []);
  if (plan.steps.length > 1) {
    assert.equal(transitionPlanGraph(graph, plan.steps[0]!.id, "success"), plan.steps[1]!.id);
  }
});

test("task contract amendments keep identity and increment schema version", () => {
  const original = createTaskContract("Find a hotel", {
    constraints: ["under 12000 RUB"],
    completionCriteria: ["price verified"],
  }, "2026-01-01T00:00:00.000Z");
  const amended = amendTaskContract(original, {
    constraints: ["under 10000 RUB"],
  }, "2026-01-01T00:01:00.000Z");
  assert.equal(amended.id, original.id);
  assert.equal(amended.version, 2);
  assert.equal(amended.constraints[0]?.description, "under 10000 RUB");
});

test("wait registry triggers external events and expires deadlines", () => {
  const waits = new WaitRegistry();
  const external = waits.create({
    missionId: "m1",
    stepId: "s1",
    source: "telegram",
    predicate: { kind: "event", name: "message", correlationId: "chat-7" },
  });
  assert.equal(
    waits.evaluate(external.id, { eventName: "message", correlationId: "chat-7" }).status,
    "triggered",
  );
  const expiring = waits.create({
    missionId: "m1",
    stepId: "s2",
    source: "time",
    predicate: { kind: "after", at: "2030-01-01T00:00:00.000Z" },
    deadline: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(
    waits.evaluate(expiring.id, {}, new Date("2026-01-02T00:00:00.000Z")).status,
    "expired",
  );
});

test("recovery engine advances strategy and stops at configured maximum", () => {
  const recovery = new RecoveryEngine(2);
  assert.equal(recovery.classify(new Error("element locator not found")), "element_not_found");
  assert.equal(recovery.next("m", "s", "element_not_found").strategy, "refresh_accessibility");
  assert.equal(recovery.next("m", "s", "element_not_found").strategy, "check_active_window");
  assert.equal(recovery.next("m", "s", "element_not_found").exhausted, true);
});

test("legacy mission queue is migrated with durable autonomy fields", () => {
  const route = routeTask("open notepad");
  const plan = buildPlan("open notepad", route);
  const migrated = migrateMissionQueue({
    items: [{
      id: "legacy",
      kind: "one_shot",
      domain: route.domain,
      agent: route.agent,
      status: "running",
      goal: "open notepad",
      plan,
      requiresUi: true,
      checkpoint: { planStepIndex: 0 },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }],
    activeUiId: "legacy",
  });
  assert.equal(migrated.version, 1);
  assert.equal(migrated.items[0]?.taskContract?.version, 1);
  assert.equal(migrated.items[0]?.planGraph?.version, 1);
  assert.deepEqual(migrated.items[0]?.activeWaits, []);
});

test("task verifier refuses false done without criterion evidence", async () => {
  const contract = createTaskContract("save a file", {
    completionCriteria: ["file exists", "content matches"],
  });
  const withoutEvidence = await verifyTaskContract(contract, async () => ({
    success: true,
    evidence: [],
  }));
  assert.equal(withoutEvidence.success, false);
  const evidenced = await verifyTaskContract(contract, async (criterion) => ({
    success: true,
    evidence: [{
      id: `e-${criterion.id}`,
      kind: "file",
      summary: criterion.description,
      capturedAt: new Date().toISOString(),
    }],
  }));
  assert.equal(evidenced.success, true);
  assert.equal(evidenced.confidence, 1);
});
