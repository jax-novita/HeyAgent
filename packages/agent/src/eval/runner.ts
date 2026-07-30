import {
  classifyFailoverError,
  runWithModelFallback,
  FallbackSummaryError,
} from "@heyagent/models";
import { predictDispatch } from "../predict-dispatch.js";
import {
  maybeCompactSession,
  heuristicSummarize,
  type CompactableSession,
} from "../compaction.js";
import { listScenarios } from "./scenarios.js";
import type {
  EvalReport,
  EvalScenario,
  ExpectResult,
  Expectation,
  ScenarioResult,
} from "./types.js";

function checkExpectation(
  exp: Expectation,
  pred: ReturnType<typeof predictDispatch> | null,
  special?: { compactionOk?: boolean; failoverOk?: boolean },
): ExpectResult {
  const fail = (detail: string): ExpectResult => ({ expectation: exp, ok: false, detail });
  const pass = (detail: string): ExpectResult => ({ expectation: exp, ok: true, detail });

  if (exp.kind === "compaction") {
    return special?.compactionOk
      ? pass("compaction archived + kept recent")
      : fail("compaction did not run as expected");
  }
  if (exp.kind === "failover_class") {
    return special?.failoverOk
      ? pass("500/503 classified + chain advances")
      : fail("failover checks failed");
  }
  if (!pred) return fail("no prediction");

  switch (exp.kind) {
    case "domain":
      return pred.domain === exp.value
        ? pass(`domain=${pred.domain}`)
        : fail(`domain=${pred.domain} want=${exp.value}`);
    case "harness":
      return pred.effectiveHarness === exp.value
        ? pass(`harness=${pred.effectiveHarness}`)
        : fail(`harness=${pred.effectiveHarness} want=${exp.value}`);
    case "orch_harness":
      return pred.orchHarness === exp.value
        ? pass(`orch=${pred.orchHarness}`)
        : fail(`orch=${pred.orchHarness} want=${exp.value}`);
    case "youtube_mode":
      return pred.youtubeMode === exp.value
        ? pass(`youtubeMode=${pred.youtubeMode}`)
        : fail(`youtubeMode=${pred.youtubeMode} want=${exp.value}`);
    case "notepad_genre":
      return pred.notepadGenre === exp.value
        ? pass(`genre=${pred.notepadGenre}`)
        : fail(`genre=${pred.notepadGenre} want=${exp.value}`);
    case "slot":
      return pred.slots[exp.key ?? ""] === exp.value
        ? pass(`slot ${exp.key}=${exp.value}`)
        : fail(`slot ${exp.key}=${pred.slots[exp.key ?? ""]} want=${exp.value}`);
    case "forbidden_includes": {
      const need = exp.values ?? (exp.value ? [exp.value] : []);
      if (!need.length) return pass("no forbidden required");
      const missing = need.filter((t) => !pred.forbiddenTools.includes(t));
      return missing.length
        ? fail(`missing forbidden: ${missing.join(",")}`)
        : pass(`forbidden ok (${need.length})`);
    }
    case "forbidden_excludes": {
      const bad = (exp.values ?? []).filter((t) => pred.forbiddenTools.includes(t));
      return bad.length ? fail(`unexpected forbidden: ${bad.join(",")}`) : pass("no false forbid");
    }
    default:
      return fail(`unknown expectation ${exp.kind}`);
  }
}

async function runCompactionScenario(): Promise<{ ok: boolean; detail: string }> {
  const messages = [];
  for (let i = 0; i < 16; i++) {
    messages.push({
      role: "user" as const,
      content: `step user ${i}: сделай действие ${i}`,
    });
    messages.push({
      role: "assistant" as const,
      content:
        i % 4 === 0
          ? `[actions]\n- shell.exec: ok ${i}\nDONE часть ${i}`
          : `[actions]\n- file.write: path=/tmp/x${i}.txt`,
    });
  }
  const session: CompactableSession = {
    id: "eval-compact",
    channel: "cli",
    messages,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    currentTask: "eval long session",
  };
  // Avoid disk write to real sessions — patch save via in-memory only
  const before = session.messages.length;
  const h = heuristicSummarize(session.messages.slice(0, -6), session.currentTask);
  if (!h.completed.length && !h.text) return { ok: false, detail: "heuristic empty" };

  // Run compaction with force + no LLM, but saveSession writes — use force and then we accept disk
  const ran = await maybeCompactSession(session, {
    force: true,
    keepRecent: 6,
    useLlm: false,
  });
  const after = session.messages.filter((m) => m.role === "user" || m.role === "assistant").length;
  const ok =
    ran &&
    after <= 6 &&
    (session.archivedSummaries?.length ?? 0) >= 1 &&
    !!session.workingSummary &&
    before > after;
  return {
    ok,
    detail: `ran=${ran} before=${before} after=${after} archives=${session.archivedSummaries?.length}`,
  };
}

async function runFailoverScenario(): Promise<{ ok: boolean; detail: string }> {
  const c500 = classifyFailoverError(new Error("Model API error (500): server_error"));
  const c503 = classifyFailoverError(
    new Error("Model API error (503): upstream connect error"),
  );
  const calls: string[] = [];
  try {
    await runWithModelFallback(
      { provider: "openai", model: "broken" },
      [{ provider: "openai", model: "ok" }],
      async (ref) => {
        calls.push(ref.model);
        if (ref.model === "broken") throw new Error("Model API error (500): x");
        return "ok";
      },
      { sameModelRetries: 0 },
    );
  } catch (e) {
    if (!(e instanceof FallbackSummaryError) && String(e).includes("ok")) {
      /* ignore */
    }
  }
  const ok =
    c500.tryNext &&
    c500.reason === "server_error" &&
    c503.tryNext &&
    calls.includes("broken") &&
    calls.includes("ok");
  return { ok, detail: `class500=${c500.reason} class503=${c503.reason} calls=${calls.join(",")}` };
}

export async function runScenario(scenario: EvalScenario): Promise<ScenarioResult> {
  const t0 = Date.now();
  try {
    if (scenario.mode === "live") {
      return {
        id: scenario.id,
        name: scenario.name,
        mode: scenario.mode,
        passed: false,
        checks: [],
        durationMs: Date.now() - t0,
        error: "live scenarios require --live (not implemented in mock pack)",
      };
    }

    if (scenario.input === "__compaction__") {
      const r = await runCompactionScenario();
      const checks = scenario.expected.map((e) =>
        checkExpectation(e, null, { compactionOk: r.ok }),
      );
      return {
        id: scenario.id,
        name: scenario.name,
        mode: scenario.mode,
        passed: checks.every((c) => c.ok),
        checks,
        predicted: { detail: r.detail },
        durationMs: Date.now() - t0,
      };
    }

    if (scenario.input === "__failover__") {
      const r = await runFailoverScenario();
      const checks = scenario.expected.map((e) =>
        checkExpectation(e, null, { failoverOk: r.ok }),
      );
      return {
        id: scenario.id,
        name: scenario.name,
        mode: scenario.mode,
        passed: checks.every((c) => c.ok),
        checks,
        predicted: { detail: r.detail },
        durationMs: Date.now() - t0,
      };
    }

    const pred = predictDispatch(scenario.input);
    const checks = scenario.expected.map((e) => checkExpectation(e, pred));
    return {
      id: scenario.id,
      name: scenario.name,
      mode: scenario.mode,
      passed: checks.every((c) => c.ok),
      checks,
      predicted: {
        domain: pred.domain,
        harness: pred.effectiveHarness,
        orch: pred.orchHarness,
        youtubeMode: pred.youtubeMode,
        notepadGenre: pred.notepadGenre,
        forbidden: pred.forbiddenTools,
      },
      durationMs: Date.now() - t0,
    };
  } catch (err) {
    return {
      id: scenario.id,
      name: scenario.name,
      mode: scenario.mode,
      passed: false,
      checks: [],
      durationMs: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runEvalPack(opts?: {
  id?: string;
  tag?: string;
  live?: boolean;
}): Promise<EvalReport> {
  const scenarios = listScenarios(opts);
  const results: ScenarioResult[] = [];
  for (const s of scenarios) {
    results.push(await runScenario(s));
  }
  const passed = results.filter((r) => r.passed).length;
  const harnessHits = results.filter(
    (r) =>
      r.passed &&
      typeof r.predicted?.harness === "string" &&
      r.predicted.harness !== "llm_loop",
  ).length;
  const harnessDenom = results.filter(
    (r) => r.predicted && "harness" in r.predicted,
  ).length;
  return {
    at: new Date().toISOString(),
    total: results.length,
    passed,
    failed: results.length - passed,
    harnessHitRate: harnessDenom ? harnessHits / harnessDenom : 0,
    results,
  };
}

export function formatEvalReport(report: EvalReport, json = false): string {
  if (json) return JSON.stringify(report, null, 2);
  const lines = [
    `HeyAgent eval — ${report.at}`,
    `total=${report.total} passed=${report.passed} failed=${report.failed} harnessHitRate=${(report.harnessHitRate * 100).toFixed(0)}%`,
    "",
  ];
  for (const r of report.results) {
    const mark = r.passed ? "PASS" : "FAIL";
    lines.push(`${mark}  ${r.id}  ${r.name}  (${r.durationMs}ms)`);
    if (!r.passed) {
      if (r.error) lines.push(`      error: ${r.error}`);
      for (const c of r.checks.filter((x) => !x.ok)) {
        lines.push(`      ✗ ${c.expectation.kind}: ${c.detail}`);
      }
      if (r.predicted) lines.push(`      got: ${JSON.stringify(r.predicted)}`);
    }
  }
  return lines.join("\n");
}
