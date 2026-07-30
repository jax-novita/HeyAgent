import { generateId } from "@heyagent/shared";
import { routeTask } from "./router.js";
import { buildPlan } from "./planner.js";
import { globalMissionQueue, MissionQueue } from "./queue.js";
import { globalTimeline, Timeline } from "./timeline.js";
import { globalIdempotency, IdempotencyGuard } from "./idempotency.js";
import { dispatchAgent, type AgentDispatch } from "./agents/dispatch.js";
import { memoryContextBlock, recordEpisode, findPerson, rememberPerson } from "./memory-ext.js";
import { captureWorldState } from "./world-state.js";
import { verify, looksLikeSearchBarPollution } from "./verifier.js";
import { createTaskContract, type TaskContract } from "./task-contract.js";
import { planToGraph, type PlanGraph } from "./plan-graph.js";
import type {
  Mission,
  OrchestratorProgress,
  RouteDecision,
  Plan,
  VerifyResult,
  WorldSnapshot,
} from "./types.js";

export interface OrchestrateInput {
  goal: string;
  /** Prefer clarified/reread text when available. */
  clarifiedGoal?: string;
}

export interface OrchestrateResult {
  route: RouteDecision;
  plan: Plan;
  mission: Mission;
  dispatch: AgentDispatch;
  memoryBlock: string;
  world: WorldSnapshot;
  taskContract: TaskContract;
  planGraph: PlanGraph;
}

export type ProgressFn = (p: OrchestratorProgress) => void;

/**
 * Central orchestrator: route → plan → enqueue → dispatch.
 * Does NOT execute tools itself — AgentRuntime / harnesses do, following the plan.
 */
export class Orchestrator {
  constructor(
    private queue: MissionQueue = globalMissionQueue,
    private timeline: Timeline = globalTimeline,
    private idem: IdempotencyGuard = globalIdempotency,
  ) {}

  async orchestrate(
    input: OrchestrateInput,
    onProgress?: ProgressFn,
  ): Promise<OrchestrateResult> {
    const goalRaw = (input.goal || "").trim();
    const goalClarified = (input.clarifiedGoal || "").trim();
    // Prefer raw for routing when reread would hijack quiz → Telegram («Ответь на вопросы…»)
    const routeRaw = goalRaw ? routeTask(goalRaw) : null;
    const routeClarified = goalClarified ? routeTask(goalClarified) : null;
    let route =
      routeRaw?.domain === "browser" && routeRaw.slots.openTab === "1"
        ? routeRaw
        : routeClarified?.domain === "browser" && routeClarified.slots.openTab === "1"
          ? routeClarified
          : routeClarified || routeRaw || routeTask(goalClarified || goalRaw);
    // Never let clarified messaging override a quiz/browser open_tab from the raw text
    if (
      routeRaw?.slots.openTab === "1" &&
      route.domain === "messaging"
    ) {
      route = routeRaw;
    }
    const goal = goalClarified || goalRaw;
    onProgress?.({ status: "thinking", detail: "route" });

    await this.timeline.push({
      kind: "route",
      name: route.domain,
      detail: `${route.reason} → agent=${route.agent} ui=${route.requiresUi}`,
    });

    // Enrich contact from long-term people memory — skip garbage contacts
    if (route.slots.contact && route.slots.contact.length >= 2) {
      const person = await findPerson(route.slots.contact);
      if (person) {
        route.slots.contact = person.name;
        if (person.handle) route.slots.handle = person.handle;
        if (person.tone) route.slots.tone = person.tone;
      } else {
        await rememberPerson({
          name: route.slots.contact,
          aliases: [],
          channel: route.slots.channel || "telegram",
        });
      }
    }

    const taskContract = createTaskContract(goal);
    onProgress?.({ status: "thinking", detail: "plan" });
    const plan = buildPlan(taskContract.objective, route);
    const planGraph = planToGraph(plan);
    await this.timeline.push({
      kind: "plan",
      name: plan.id,
      detail: plan.steps.map((s) => s.kind).join(" → "),
    });

    const dispatch = dispatchAgent(route);
    const now = new Date().toISOString();
    const mission: Mission = {
      version: 1,
      id: generateId("mission"),
      kind: route.missionKind,
      domain: route.domain,
      agent: route.agent,
      status: "queued",
      goal,
      plan,
      requiresUi: route.requiresUi,
      checkpoint: {
        planStepIndex: 0,
        transcript: [],
      },
      createdAt: now,
      updatedAt: now,
      taskContract,
      planGraph,
      activeWaits: [],
      actionHistory: [],
      artifacts: [],
    };

    // Cancel path clears the UI queue
    if (dispatch.harness === "cancel") {
      const cancelled = this.queue.cancel();
      this.idem.clearChat();
      await this.timeline.push({
        kind: "status",
        name: "cancel",
        detail: `cancelled ${cancelled.length} mission(s)`,
      });
    } else {
      this.queue.enqueue(mission);
    }

    const memoryBlock = await memoryContextBlock(goal);
    const world = await captureWorldState();

    onProgress?.({
      status: "working",
      detail: dispatch.harness,
      missionId: mission.id,
      domain: route.domain,
    });

    return { route, plan, mission, dispatch, memoryBlock, world, taskContract, planGraph };
  }

  /** Claim next runnable mission (respects UI single-flight). */
  claimNext(): Mission | null {
    return this.queue.dequeueRunnable();
  }

  async verifyStep(
    missionId: string,
    name: Parameters<typeof verify>[0]["name"],
    ctx: Omit<Parameters<typeof verify>[0], "name">,
  ): Promise<VerifyResult> {
    const result = verify({ name, ...ctx });
    await this.timeline.verify(name, result.verdict, result.reason, result.screenshotPath, missionId);
    return result;
  }

  async noteEpisode(
    goal: string,
    domain: Mission["domain"],
    tried: string,
    outcome: "success" | "fail",
    lesson: string,
  ): Promise<void> {
    await recordEpisode({ goal, domain, tried, outcome, lesson });
  }

  /** Update mission plan/checkpoint after a tool step (keeps state between iterations). */
  advanceMission(mission: Mission): void {
    this.queue.update(mission.id, {
      plan: mission.plan,
      checkpoint: mission.checkpoint,
      status: mission.status,
      error: mission.error,
      updatedAt: new Date().toISOString(),
    });
  }

  getQueue(): MissionQueue {
    return this.queue;
  }

  getTimeline(): Timeline {
    return this.timeline;
  }

  getIdempotency(): IdempotencyGuard {
    return this.idem;
  }

  /** Helpers re-exported for harnesses. */
  looksLikeSearchPollution(search: string | null | undefined, message: string): boolean {
    return looksLikeSearchBarPollution(search, message);
  }
}

export const globalOrchestrator = new Orchestrator();
