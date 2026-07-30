import { createHash } from "node:crypto";
import { generateId } from "@heyagent/shared";

export interface TransactionPreview {
  action: string;
  merchant?: string;
  item: string;
  quantity: number;
  total: number;
  currency: string;
  dates?: { start: string; end: string };
  cancellation?: string;
  refundable?: boolean;
  fees: Array<{ description: string; amount: number }>;
}

export interface TransactionApproval {
  id: string;
  missionId: string;
  preview: TransactionPreview;
  fingerprint: string;
  status: "pending" | "approved" | "denied" | "expired" | "consumed" | "invalidated";
  createdAt: string;
  expiresAt: string;
  resolvedAt?: string;
  version: number;
}

export class TransactionApprovalRegistry {
  private approvals = new Map<string, TransactionApproval>();

  request(
    missionId: string,
    preview: TransactionPreview,
    ttlMs = 10 * 60_000,
  ): TransactionApproval {
    validatePreview(preview);
    const createdAt = new Date().toISOString();
    const approval: TransactionApproval = {
      id: generateId("transaction"),
      missionId,
      preview: structuredClone(preview),
      fingerprint: previewFingerprint(preview),
      status: "pending",
      createdAt,
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
      version: 1,
    };
    this.approvals.set(approval.id, approval);
    return structuredClone(approval);
  }

  resolve(id: string, approved: boolean, now = new Date()): TransactionApproval {
    const approval = this.require(id);
    this.expireIfNeeded(approval, now);
    if (approval.status !== "pending") throw new Error(`Approval is ${approval.status}`);
    approval.status = approved ? "approved" : "denied";
    approval.resolvedAt = now.toISOString();
    return structuredClone(approval);
  }

  consume(id: string, currentPreview: TransactionPreview, now = new Date()): TransactionApproval {
    const approval = this.require(id);
    this.expireIfNeeded(approval, now);
    if (approval.status !== "approved") throw new Error(`Approval is ${approval.status}`);
    if (previewFingerprint(currentPreview) !== approval.fingerprint) {
      approval.status = "invalidated";
      throw new Error("Transaction changed after approval");
    }
    approval.status = "consumed";
    return structuredClone(approval);
  }

  get(id: string): TransactionApproval | undefined {
    const approval = this.approvals.get(id);
    return approval ? structuredClone(approval) : undefined;
  }

  snapshot(): { version: number; approvals: TransactionApproval[] } {
    return { version: 1, approvals: [...this.approvals.values()].map((item) => structuredClone(item)) };
  }

  private require(id: string): TransactionApproval {
    const approval = this.approvals.get(id);
    if (!approval) throw new Error(`Approval not found: ${id}`);
    return approval;
  }

  private expireIfNeeded(approval: TransactionApproval, now: Date): void {
    if (now.getTime() > new Date(approval.expiresAt).getTime()) approval.status = "expired";
  }
}

export function previewFingerprint(preview: TransactionPreview): string {
  return createHash("sha256").update(JSON.stringify(normalize(preview))).digest("hex");
}

export function redactFinancialData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactFinancialData);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        /(card|pan|cvv|cvc|security.?code|payment.?token)/i.test(key)
          ? "[REDACTED]"
          : redactFinancialData(child),
      ]),
    );
  }
  if (typeof value === "string") {
    return value.replace(/\b(?:\d[ -]*?){13,19}\b/g, "[REDACTED_CARD]");
  }
  return value;
}

function validatePreview(preview: TransactionPreview): void {
  if (!preview.action || !preview.item) throw new Error("Transaction action and item are required");
  if (!Number.isFinite(preview.total) || preview.total < 0) throw new Error("Invalid total");
  if (!preview.currency || !/^[A-Z]{3}$/.test(preview.currency)) throw new Error("Currency must be ISO-4217");
  if (!Number.isInteger(preview.quantity) || preview.quantity < 1) throw new Error("Invalid quantity");
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)]),
    );
  }
  return value;
}
