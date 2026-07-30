/**
 * Pure prediction via harness match (same source of truth as runtime).
 */
import {
  routeTask,
  dispatchAgent,
  buildToolSelection,
  buildPlan,
  getCurrentStep,
} from "@heyagent/orchestrator";
import { matchHarness, type HarnessId } from "./harness/match.js";

export type EffectiveHarness = HarnessId;

export interface PredictedDispatch {
  domain: string;
  orchHarness: string;
  effectiveHarness: EffectiveHarness;
  confidence: number;
  forbiddenTools: string[];
  preferredTools: string[];
  slots: Record<string, string>;
  youtubeMode?: "quick" | "deep";
  notepadGenre?: string;
}

export function predictDispatch(input: string): PredictedDispatch {
  const text = input.trim();
  const route = routeTask(text);
  const dispatch = dispatchAgent(route);
  const plan = buildPlan(text, route);
  const toolSel = buildToolSelection(route, plan, getCurrentStep(plan));
  const orch = {
    route,
    plan,
    mission: {
      id: "predict",
      kind: route.missionKind,
      domain: route.domain,
      agent: route.agent,
      status: "queued" as const,
      goal: text,
      plan,
      requiresUi: route.requiresUi,
      checkpoint: { planStepIndex: 0 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    dispatch,
    memoryBlock: "",
    world: {},
  };

  const matched = matchHarness({
    userMessage: text,
    workingMessage: text,
    orch: orch as never,
    clockEnabled: true,
  });

  return {
    domain: route.domain,
    orchHarness: dispatch.harness,
    effectiveHarness: matched.id,
    confidence: route.priority,
    forbiddenTools: toolSel.forbidden,
    preferredTools: toolSel.preferred,
    slots: { ...route.slots },
    youtubeMode: matched.meta.mode as "quick" | "deep" | undefined,
    notepadGenre: (matched.meta.note as { genre?: string } | undefined)?.genre,
  };
}
