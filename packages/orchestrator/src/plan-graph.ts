import type { Plan, PlanStep, StepStatus } from "./types.js";

export type TransitionCondition =
  | "success"
  | "failure"
  | "timeout"
  | "approval_granted"
  | "approval_denied"
  | "external_event"
  | "user_updated_task";

export interface PlannedAction {
  capability: string;
  input: Record<string, unknown>;
  write: boolean;
}

export interface StepCondition {
  type: string;
  expected?: unknown;
}

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
}

export interface RecoveryPolicy {
  maxAttempts: number;
  strategies?: string[];
}

export interface StepTransition {
  condition: TransitionCondition;
  nextStepId?: string;
}

export interface MissionStepNode {
  id: string;
  title: string;
  action: PlannedAction;
  preconditions: StepCondition[];
  successConditions: StepCondition[];
  timeoutMs?: number;
  retryPolicy: RetryPolicy;
  recoveryPolicy?: RecoveryPolicy;
  transitions: StepTransition[];
  compensationAction?: PlannedAction;
  status: StepStatus;
}

export interface PlanGraph {
  id: string;
  entryStepId: string;
  steps: Record<string, MissionStepNode>;
  version: number;
}

/** Backwards-compatible adapter: every existing linear Plan is also a graph. */
export function planToGraph(plan: Plan): PlanGraph {
  const steps: Record<string, MissionStepNode> = {};
  plan.steps.forEach((item, index) => {
    const next = plan.steps[index + 1];
    steps[item.id] = stepToNode(item, next?.id);
  });
  return {
    id: `graph_${plan.id}`,
    entryStepId: plan.steps[0]?.id ?? "",
    steps,
    version: 1,
  };
}

export function transitionPlanGraph(
  graph: PlanGraph,
  currentStepId: string,
  condition: TransitionCondition,
): string | undefined {
  return graph.steps[currentStepId]?.transitions.find((item) => item.condition === condition)?.nextStepId;
}

export function validatePlanGraph(graph: PlanGraph): string[] {
  const errors: string[] = [];
  if (!graph.entryStepId || !graph.steps[graph.entryStepId]) errors.push("entryStepId is missing");
  for (const node of Object.values(graph.steps)) {
    for (const transition of node.transitions) {
      if (transition.nextStepId && !graph.steps[transition.nextStepId]) {
        errors.push(`${node.id} points to missing step ${transition.nextStepId}`);
      }
    }
  }
  return errors;
}

function stepToNode(step: PlanStep, nextStepId?: string): MissionStepNode {
  return {
    id: step.id,
    title: step.title,
    action: {
      capability: step.kind,
      input: step.params ?? {},
      write: /send|write|delete|purchase|book|order|publish/i.test(step.kind),
    },
    preconditions: [],
    successConditions: step.verify ? [{ type: step.verify, expected: true }] : [],
    timeoutMs: step.timeoutMs,
    retryPolicy: {
      maxAttempts: step.retryPolicy === "none" ? 1 : 3,
      backoffMs: step.retryPolicy === "exponential" ? 1_000 : 500,
    },
    transitions: nextStepId ? [{ condition: "success", nextStepId }] : [],
    status: step.status,
  };
}
