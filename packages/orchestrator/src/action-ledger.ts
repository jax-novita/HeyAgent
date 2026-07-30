import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { Evidence, WorldStateDiff } from "@heyagent/shared";
import { ensureDir, generateId, getHeyAgentHome } from "@heyagent/shared";
import { join } from "node:path";

export type ActionStatus = "started" | "succeeded" | "failed" | "uncertain";

export interface ActionRecord {
  id: string;
  missionId: string;
  stepId: string;
  actionType: string;
  inputHash: string;
  idempotencyKey?: string;
  status: ActionStatus;
  evidence: Evidence[];
  stateDiff?: WorldStateDiff;
  startedAt: string;
  completedAt?: string;
}

export interface ActionLedgerSnapshot {
  version: number;
  records: ActionRecord[];
}

const NON_REPEATABLE = /(send|message|email|order|booking|pay|publish)/i;

export class ActionLedger {
  private records: ActionRecord[];

  constructor(records: ActionRecord[] = []) {
    this.records = structuredClone(records);
  }

  begin(input: {
    missionId: string;
    stepId: string;
    actionType: string;
    input: unknown;
    idempotencyKey?: string;
  }): ActionRecord {
    const inputHash = hashActionInput(input.input);
    const duplicate = this.findBlocking(input.actionType, inputHash, input.idempotencyKey);
    if (duplicate && (input.idempotencyKey || NON_REPEATABLE.test(input.actionType))) {
      throw new DuplicateWriteActionError(duplicate);
    }
    const record: ActionRecord = {
      id: generateId("action"),
      missionId: input.missionId,
      stepId: input.stepId,
      actionType: input.actionType,
      inputHash,
      idempotencyKey: input.idempotencyKey,
      status: "started",
      evidence: [],
      startedAt: new Date().toISOString(),
    };
    this.records.push(record);
    return structuredClone(record);
  }

  complete(
    id: string,
    status: Exclude<ActionStatus, "started">,
    evidence: Evidence[] = [],
    stateDiff?: WorldStateDiff,
  ): ActionRecord {
    const record = this.records.find((item) => item.id === id);
    if (!record) throw new Error(`Action record not found: ${id}`);
    record.status = status;
    record.evidence = structuredClone(evidence);
    record.stateDiff = stateDiff ? structuredClone(stateDiff) : undefined;
    record.completedAt = new Date().toISOString();
    return structuredClone(record);
  }

  canExecute(actionType: string, input: unknown, idempotencyKey?: string): boolean {
    return !this.findBlocking(actionType, hashActionInput(input), idempotencyKey);
  }

  list(missionId?: string): ActionRecord[] {
    return structuredClone(
      missionId ? this.records.filter((item) => item.missionId === missionId) : this.records,
    );
  }

  snapshot(): ActionLedgerSnapshot {
    return { version: 1, records: this.list() };
  }

  private findBlocking(
    actionType: string,
    inputHash: string,
    idempotencyKey?: string,
  ): ActionRecord | undefined {
    return this.records.find(
      (item) =>
        (item.status === "succeeded" || item.status === "uncertain") &&
        (idempotencyKey
          ? item.idempotencyKey === idempotencyKey
          : item.actionType === actionType && item.inputHash === inputHash),
    );
  }
}

export class DuplicateWriteActionError extends Error {
  readonly code = "DUPLICATE_WRITE_ACTION";

  constructor(readonly previous: ActionRecord) {
    super(`Write action already succeeded as ${previous.id}`);
    this.name = "DuplicateWriteActionError";
  }
}

export function hashActionInput(input: unknown): string {
  return createHash("sha256").update(stableStringify(input)).digest("hex");
}

export async function loadActionLedger(path = defaultLedgerPath()): Promise<ActionLedger> {
  if (!existsSync(path)) return new ActionLedger();
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    return new ActionLedger(validateLedgerSnapshot(parsed).records);
  } catch (error) {
    await rename(path, `${path}.corrupt-${Date.now()}`).catch(() => undefined);
    throw new Error(`Invalid action ledger: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function persistActionLedger(
  ledger: ActionLedger,
  path = defaultLedgerPath(),
): Promise<void> {
  await ensureDir(getHeyAgentHome(), { mkdir } as typeof import("node:fs/promises"));
  await writeFile(path, JSON.stringify(ledger.snapshot(), null, 2), "utf8");
}

export function validateLedgerSnapshot(value: unknown): ActionLedgerSnapshot {
  if (!value || typeof value !== "object") throw new Error("snapshot must be an object");
  const candidate = value as { version?: unknown; records?: unknown };
  if (candidate.version !== 1) throw new Error(`unsupported version: ${String(candidate.version)}`);
  if (!Array.isArray(candidate.records)) throw new Error("records must be an array");
  for (const record of candidate.records) {
    if (!isActionRecord(record)) throw new Error("invalid action record");
  }
  return { version: 1, records: candidate.records };
}

function isActionRecord(value: unknown): value is ActionRecord {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ActionRecord>;
  return (
    typeof item.id === "string" &&
    typeof item.missionId === "string" &&
    typeof item.stepId === "string" &&
    typeof item.actionType === "string" &&
    typeof item.inputHash === "string" &&
    ["started", "succeeded", "failed", "uncertain"].includes(item.status ?? "") &&
    Array.isArray(item.evidence) &&
    typeof item.startedAt === "string"
  );
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function defaultLedgerPath(): string {
  return join(getHeyAgentHome(), "action-ledger.json");
}
