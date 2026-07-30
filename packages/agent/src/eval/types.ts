export type ExpectKind =
  | "domain"
  | "harness"
  | "orch_harness"
  | "forbidden_includes"
  | "forbidden_excludes"
  | "youtube_mode"
  | "notepad_genre"
  | "slot"
  | "failover_class"
  | "compaction";

export interface Expectation {
  kind: ExpectKind;
  value?: string;
  values?: string[];
  key?: string;
}

export interface EvalScenario {
  id: string;
  name: string;
  /** mock = no live UI/API; live = full agent (opt-in) */
  mode: "mock" | "live";
  input: string;
  expected: Expectation[];
  maxIterations?: number;
  timeoutMs?: number;
  tags?: string[];
}

export interface ExpectResult {
  expectation: Expectation;
  ok: boolean;
  detail: string;
}

export interface ScenarioResult {
  id: string;
  name: string;
  mode: string;
  passed: boolean;
  checks: ExpectResult[];
  predicted?: Record<string, unknown>;
  durationMs: number;
  error?: string;
}

export interface EvalReport {
  at: string;
  total: number;
  passed: number;
  failed: number;
  harnessHitRate: number;
  results: ScenarioResult[];
}
