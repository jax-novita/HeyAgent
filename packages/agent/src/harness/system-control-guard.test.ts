import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentIdentity } from "@heyagent/identity";
import type { ModelRef } from "@heyagent/models";
import type { AgentSession } from "@heyagent/shared";
import type { OrchestrateResult } from "@heyagent/orchestrator";
import { validateSystemControlParams } from "@heyagent/computer";
import { executeHarness, type HarnessExecContext } from "./execute.js";

function invalidContext(
  statuses: { status: string; detail?: string }[],
): HarnessExecContext {
  const now = new Date().toISOString();
  return {
    userMessage: "[SYSTEM HEARTBEAT] periodic autonomy check",
    workingMessage: "[SYSTEM HEARTBEAT] periodic autonomy check",
    rereadPrefix: "",
    session: {
      id: "system-control-guard-test",
      channel: "cli",
      messages: [],
      createdAt: now,
      updatedAt: now,
    } satisfies AgentSession,
    identity: {} as AgentIdentity,
    modelRef: { provider: "test", model: "test" } as ModelRef,
    orch: {
      mission: { id: "invalid-system-mission", requiresUi: false },
    } as unknown as OrchestrateResult,
    options: {
      onStatus: (status, detail) => statuses.push({ status, detail }),
    },
  };
}

test("system.control accepts a valid parsed command", () => {
  const parsed = validateSystemControlParams({ action: "volume_set", level: 40 });
  assert.deepEqual(parsed, {
    ok: true,
    value: { action: "volume_set", level: 40 },
  });
});

test("system.control parser null is controlled and falls through without throwing", async () => {
  const statuses: { status: string; detail?: string }[] = [];
  const previousWarn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => warnings.push(args);
  try {
    const result = await executeHarness(
      { id: "system.control", priority: 80, meta: { sys: null } },
      invalidContext(statuses),
    );
    assert.equal(result, null);
    assert.equal(statuses.at(-1)?.status, "error");
    assert.match(statuses.at(-1)?.detail ?? "", /invalid or unrecognized command/);
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = previousWarn;
  }
});

test("system.control rejects an object with missing or invalid action", async () => {
  assert.deepEqual(validateSystemControlParams({ level: 40 }), {
    ok: false,
    error: "INVALID_SYSTEM_CONTROL_COMMAND",
    reason: "missing_action",
  });
  assert.deepEqual(validateSystemControlParams({ action: "explode_the_moon" }), {
    ok: false,
    error: "INVALID_SYSTEM_CONTROL_COMMAND",
    reason: "invalid_action",
  });

  const statuses: { status: string; detail?: string }[] = [];
  const previousWarn = console.warn;
  console.warn = () => undefined;
  try {
    const result = await executeHarness(
      {
        id: "system.control",
        priority: 80,
        meta: { sys: { action: "explode_the_moon" } },
      },
      invalidContext(statuses),
    );
    assert.equal(result, null);
    assert.equal(statuses.at(-1)?.status, "error");
  } finally {
    console.warn = previousWarn;
  }
});

