import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PolicyEngine } from "./index.js";
import { CapabilityRegistry } from "./capabilities.js";
import {
  TransactionApprovalRegistry,
  redactFinancialData,
  type TransactionPreview,
} from "./transaction-approvals.js";

describe("policy", () => {
  it("requires approval for sensitive tools in ask mode", () => {
    const policy = new PolicyEngine("ask");
    assert.ok(policy.requiresApproval("file.delete", { path: "/tmp/x" }));
    assert.ok(policy.requiresApproval("gmail.send", { to: "a@b.com" }));
  });

  it("allows safe tools without approval", () => {
    const policy = new PolicyEngine("ask");
    assert.ok(!policy.requiresApproval("browser.open", { url: "https://youtube.com" }));
    assert.ok(!policy.requiresApproval("file.read", { path: "x" }));
  });

  it("resolves approvals", () => {
    const policy = new PolicyEngine("ask");
    const req = policy.createApproval("shell.exec", { command: "ls" }, "Run ls");
    assert.equal(req.status, "pending");
    const resolved = policy.resolveApproval(req.id, true);
    assert.equal(resolved?.status, "approved");
  });
});

describe("capabilities and transaction approvals", () => {
  it("blocks unsupported or unapproved capabilities", () => {
    const registry = new CapabilityRegistry();
    assert.equal(
      registry.check("booking.confirm", {
        platform: "win32",
        policyAllows: true,
        approvalGranted: false,
      }).reason,
      "approval_required",
    );
    assert.equal(
      registry.check("booking.confirm", {
        platform: "win32",
        policyAllows: true,
        approvalGranted: true,
      }).available,
      true,
    );
  });

  it("invalidates approval when final price changes and cannot reuse it", () => {
    const preview: TransactionPreview = {
      action: "booking.confirm",
      item: "Hotel room",
      quantity: 1,
      total: 120,
      currency: "USD",
      fees: [{ description: "tax", amount: 20 }],
      refundable: true,
    };
    const approvals = new TransactionApprovalRegistry();
    const requested = approvals.request("m1", preview);
    approvals.resolve(requested.id, true);
    assert.throws(
      () => approvals.consume(requested.id, { ...preview, total: 125 }),
      /changed/i,
    );
    assert.equal(approvals.get(requested.id)?.status, "invalidated");
  });

  it("consumes a matching approval exactly once and redacts card data", () => {
    const preview: TransactionPreview = {
      action: "shopping.submit_order",
      item: "Keyboard",
      quantity: 1,
      total: 50,
      currency: "USD",
      fees: [],
    };
    const approvals = new TransactionApprovalRegistry();
    const requested = approvals.request("m1", preview);
    approvals.resolve(requested.id, true);
    assert.equal(approvals.consume(requested.id, preview).status, "consumed");
    assert.throws(() => approvals.consume(requested.id, preview), /consumed/i);
    assert.deepEqual(
      redactFinancialData({ cardNumber: "4111111111111111", nested: { cvv: "123" } }),
      { cardNumber: "[REDACTED]", nested: { cvv: "[REDACTED]" } },
    );
  });
});
