import type { RouteDecision } from "./types.js";
import { classifyIntent } from "./intent-signals.js";

/**
 * Hard domain router — thin wrapper over classifyIntent (SSOT).
 */
export function routeTask(text: string): RouteDecision {
  const c = classifyIntent(text);
  return {
    domain: c.domain,
    agent: c.agent,
    requiresUi: c.requiresUi,
    missionKind: c.missionKind,
    priority: c.priority,
    reason: c.reason,
    slots: c.slots,
  };
}

export {
  classifyIntent,
  isGoogleDocsTask,
  extractMessagingContact,
  type ClassifiedIntent,
  type OrchHarnessHint,
} from "./intent-signals.js";
