import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyFailoverError,
  clearFailoverCooldowns,
  isModelCoolingDown,
  markModelCooldown,
  buildModelCandidateChain,
} from "./failover.js";

test("failover: classify 503 as timeout/retry", () => {
  const c = classifyFailoverError(new Error("Model API error (503): overloaded"));
  assert.equal(c.reason, "timeout");
  assert.equal(c.tryNext, true);
});

test("failover: cooldown skips dead model when alternate exists", () => {
  clearFailoverCooldowns();
  const primary = { provider: "openai", model: "gpt-4o" };
  const alt = { provider: "openai", model: "gpt-4.1-mini" };
  markModelCooldown(primary, "server_error");
  assert.equal(isModelCoolingDown(primary), true);
  const chain = buildModelCandidateChain(primary, [alt]);
  assert.equal(chain[0]?.model, "gpt-4.1-mini");
  clearFailoverCooldowns();
});
