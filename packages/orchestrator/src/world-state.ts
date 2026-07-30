import {
  createEmptyWorldState,
  type ObservationRecord,
  type WorldState,
  type WorldStateChange,
  type WorldStateDiff,
} from "@heyagent/shared";
import type { WorldSnapshot } from "./types.js";

/**
 * World-state helpers. Actual OS probing is injected by the computer package
 * via a provider so orchestrator stays free of heavy native deps.
 */
export type WorldStateProvider = () => Promise<Partial<WorldSnapshot>>;

let provider: WorldStateProvider | null = null;

export function setWorldStateProvider(p: WorldStateProvider): void {
  provider = p;
}

export async function captureWorldState(
  hints?: Partial<WorldSnapshot>,
): Promise<WorldSnapshot> {
  const base: WorldSnapshot = {
    at: new Date().toISOString(),
    notes: [],
    ...hints,
  };
  if (!provider) return base;
  try {
    const live = await provider();
    return {
      ...base,
      ...live,
      at: new Date().toISOString(),
      telegram: { ...base.telegram, ...live.telegram },
      browser: { ...base.browser, ...live.browser },
      notes: [...(base.notes ?? []), ...(live.notes ?? [])],
    };
  } catch (err) {
    return {
      ...base,
      notes: [
        ...(base.notes ?? []),
        `world-state provider error: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }
}

/** Merge lastOpenedChat from computer module into a snapshot hint. */
export function telegramWorldHint(contact: string | null, searchBarText?: string | null): Partial<WorldSnapshot> {
  return {
    telegram: {
      chatOpen: contact,
      searchBarText: searchBarText ?? null,
    },
  };
}

const CONFIRMED_SOURCES = new Set<ObservationRecord["source"]>([
  "system_api",
  "cdp",
  "accessibility",
  "ocr",
  "vision",
  "screenshot",
  "file",
  "tool_result",
  "user_confirmation",
]);

/**
 * Versioned confirmed world state. Mutations require evidence attached to a
 * real observation; planner/model assumptions must stay in TaskContract.
 */
export class ConfirmedWorldStateStore {
  private state: WorldState;

  constructor(initial: WorldState = createEmptyWorldState()) {
    this.state = structuredClone(initial);
  }

  snapshot(): WorldState {
    return structuredClone(this.state);
  }

  applyObservation(
    observation: ObservationRecord,
    changes: Omit<WorldStateChange, "evidenceIds">[],
  ): WorldStateDiff {
    if (!CONFIRMED_SOURCES.has(observation.source) || observation.evidence.length === 0) {
      throw new Error("World state changes require a confirmed observation with evidence");
    }
    const evidenceIds = observation.evidence.map((item) => item.id);
    const diff: WorldStateDiff = {
      baseVersion: this.state.version,
      observedAt: observation.observedAt,
      changes: changes.map((change) => ({ ...change, evidenceIds })),
    };
    for (const change of diff.changes) setPath(this.state, change.path, change.after);
    this.state.version += 1;
    this.state.updatedAt = observation.observedAt;
    this.state.observations = [...this.state.observations.slice(-199), observation];
    return diff;
  }

  replaceConfirmed(next: WorldState, observation: ObservationRecord): void {
    if (!CONFIRMED_SOURCES.has(observation.source) || observation.evidence.length === 0) {
      throw new Error("World state replacement requires evidence");
    }
    this.state = {
      ...structuredClone(next),
      version: Math.max(this.state.version + 1, next.version),
      updatedAt: observation.observedAt,
      observations: [...next.observations.slice(-199), observation],
    };
  }
}

function setPath(target: WorldState, path: string, value: unknown): void {
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0) throw new Error("World state path cannot be empty");
  let cursor: Record<string, unknown> = target as unknown as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) {
    const current = cursor[part];
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      cursor[part] = {};
    }
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]!] = structuredClone(value);
}
