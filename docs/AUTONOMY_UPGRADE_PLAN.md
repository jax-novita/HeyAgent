# HeyAgent autonomy upgrade plan

## Audit snapshot

This document records the implementation baseline found before the autonomy
upgrade and is intentionally tied to the existing architecture.

### Existing execution path

The runtime already follows the product-specific pipeline:

`channel -> reread/normalization -> memory -> router -> planner -> mission queue
-> specialized harness or LLM tool loop -> tools -> verifier -> timeline`.

The upgrade keeps the Telegram conversation, browser/quiz, YouTube, notepad,
document and background harnesses. It does not replace them with a generic
tool loop.

### Existing components

- `packages/orchestrator/src/types.ts` owns `Mission`, `MissionCheckpoint`,
  `Plan`, `PlanStep` and runtime status types.
- `planner.ts`, `router.ts`, `queue.ts`, `orchestrator.ts` and
  `step-runner.ts` implement routing, linear planning, single-flight desktop
  scheduling and step advancement.
- `persist.ts` stores the queue in `~/.heyagent/mission-queue.json`.
  Interrupted running missions are restored as waiting missions.
- Tool results are appended to the model transcript and summarized into
  mission scratch state in `packages/agent/src/index.ts`.
- `verifier.ts` contains pure verifiers. `AgentRuntime.verifyToolStep` records
  verifier evidence in the timeline before verified steps are completed.
- `timeline.ts` is a bounded in-memory event log with a persistence sink hook.
- `idempotency.ts` protects recent Telegram sends and open-chat state in one
  process. The durable Action Ledger added by this upgrade protects writes
  across restarts.
- `packages/policy/src/index.ts` owns tool policy and in-process approvals.
  Gateway and Telegram expose approval UI, but durable one-use transaction
  approvals are still a later stage.
- `packages/computer` already provides cross-platform input, screenshots,
  Windows UI Automation tree lookup, OCR-to-vision fallback, browser CDP,
  window listing/focus helpers and application/system actions.
- `packages/agent/src/harness/background.ts` ticks long-running messaging
  missions without keeping an LLM loop alive.
- `packages/agent/src/skills-loader.ts` loads repository and
  `~/.heyagent/skills` `SKILL.md` files into relevant runtime context.
- Cron is persisted by `packages/agent/src/cron.ts`; the gateway restores the
  mission queue and starts background/cron tickers on startup.

### Gaps found

- `WorldSnapshot` was a small hint object rather than a versioned,
  evidence-only state.
- Mission persistence used an unvalidated legacy JSON shape and non-atomic
  writes.
- Linear plans had no graph transitions.
- Idempotency did not survive process restart.
- Desktop observation APIs were spread across tools and did not return one
  typed snapshot.
- Monitor scale/negative coordinates and robust window actions were not a
  shared model.
- Wait conditions and recovery attempts were implicit in harness code.

## Implemented foundation

### Shared confirmed state

`packages/shared/src/autonomy.ts` defines the versioned `WorldState`,
desktop/monitor/window/application state, `Evidence`, `ObservationRecord`,
`WorldStateDiff` and `ToolExecutionResult`.

`ConfirmedWorldStateStore` only accepts changes accompanied by evidence from a
system API, CDP, accessibility, OCR, vision, screenshot, file check, tool
result or user confirmation. Model assumptions remain in `TaskContract`.

### Durable mission model

- `TaskContract` captures objective, deliverables, constraints, criteria,
  forbidden actions, assumptions, risk and budgets before planning.
- Existing linear `Plan` values are adapted to a versioned `PlanGraph`;
  specialized planners remain compatible.
- Mission persistence migrates legacy queue data, validates required fields,
  adds contract/graph/waits/action history/artifacts and writes atomically.
- `ActionLedger` hashes canonical input, records evidence/diffs and rejects a
  completed write with the same idempotency key.
- `WaitRegistry` represents time, Telegram, email, browser, filesystem,
  application, system and approval waits without an active LLM loop.
- `RecoveryEngine` classifies failures and advances through bounded,
  non-repeating strategy ladders.

### Desktop foundation

- `DesktopObserver` provides `observeDesktop`, `getActiveWindow`,
  `listWindows`, `waitForWindow`, `waitForWindowChange`,
  `waitForApplication`, `waitForVisualChange` and `getMonitorLayout`.
- The system backend reads Windows top-level windows, foreground state,
  responsiveness, geometry, cursor and clipboard type.
- Monitor math supports negative coordinates, mixed DPI, vertical displays
  and windows crossing display boundaries.
- `WindowsWindowManager` implements list/find/focus/move/resize/minimize/
  maximize/restore/close via Win32 calls and returns structured tool evidence.

## State migrations

1. Missing queue `version` is treated as legacy v0.
2. Each legacy mission receives schema version 1, a deterministic
   `TaskContract`, a graph adapted from its linear plan, empty wait/action
   history and artifacts.
3. Invalid top-level or mission fields stop restoration rather than silently
   inventing state.
4. Atomic temporary-file replacement prevents partial queue JSON.
5. Invalid Action Ledger JSON is moved aside with a `.corrupt-<timestamp>`
   suffix; it is never trusted as proof that a write completed.

## Remaining staged work

1. Accessibility service: expose typed `AccessibleElement` locators and
   actions over the existing UI Automation implementation.
2. Visual grounding: merge DOM, accessibility, OCR and vision candidates;
   add perceptual screen transitions and expected-change verifiers.
3. Runtime integration: wrap every mutating tool with Action Ledger
   begin/complete and apply confirmed observations to World State.
4. Durable waits: persist `WaitRegistry`, connect source-specific gateway
   watchers and resume the graph at `external_event`.
5. Mission amendments: pause, amend contract, preserve evidenced completed
   actions and replan the affected graph only.
6. Subagents: parent/child contracts, isolated context and a global desktop
   lease.
7. Capability registry: platform/risk/schema metadata checked by planner and
   policy.
8. Transaction approvals: immutable redacted preview, one-use token,
   expiry, price/currency invalidation and durable restore.
9. Shopping/booking domain: separate research, preparation and commit stages.
10. Draft skill creator: sandboxed draft, test, explicit activation and
    rollback.
11. Desktop UI: evidence view, recovery events, graph controls and bilingual
    mission commands.
12. Golden-task E2E on real Windows with mixed-DPI displays and restart
    boundaries.

## Risks

- PowerShell/Win32 observation can be blocked by security policy or elevation
  boundaries; failures must produce evidence-backed blockers.
- `screenshot-desktop` display order does not guarantee which display is
  primary on every driver. A native display-enumeration backend should replace
  the current primary fallback.
- UI Automation properties can be missing in custom-rendered applications;
  OCR/vision remain required fallbacks.
- A started write with no completion evidence is `uncertain`, never safe to
  retry automatically.
- Approval state currently exists in more than one channel-specific process
  map and must be unified before financial commit actions are enabled.

## Definition of done by stage

- Foundation: strict build passes; unit tests cover evidence gates, migration,
  graph compatibility, duplicate writes, waits, recovery, negative
  coordinates, mixed DPI and observer changes.
- Accessibility/vision: real UI elements are found by UIA, OCR and vision
  fallback tests; every click validates window/monitor bounds and verifies a
  transition.
- Durable runtime: restart tests restore contract, graph, wait, ledger,
  artifacts and confirmed state without repeating writes.
- Financial actions: denial prevents commit, price change invalidates approval,
  tokens cannot be reused and secrets never appear in logs or model context.
- Full release: all golden tasks have automated or recorded real-system
  evidence and False Done / Duplicate Write / Resume metrics are emitted.
