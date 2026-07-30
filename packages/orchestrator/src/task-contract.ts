import { generateId } from "@heyagent/shared";

export type RiskLevel = "low" | "medium" | "high" | "financial";
export type MissionApprovalPolicy = "none" | "sensitive" | "commit_required";

export interface Deliverable {
  id: string;
  description: string;
}

export interface TaskConstraint {
  id: string;
  description: string;
  required: boolean;
}

export interface CompletionCriterion {
  id: string;
  description: string;
  required: boolean;
  verifier?: string;
}

export interface ForbiddenAction {
  id: string;
  description: string;
}

export interface TaskAssumption {
  id: string;
  description: string;
  confirmed: boolean;
}

export interface MoneyBudget {
  amount: number;
  currency: string;
}

export interface TaskContract {
  id: string;
  originalRequest: string;
  objective: string;
  deliverables: Deliverable[];
  constraints: TaskConstraint[];
  completionCriteria: CompletionCriterion[];
  forbiddenActions: ForbiddenAction[];
  assumptions: TaskAssumption[];
  riskLevel: RiskLevel;
  approvalPolicy: MissionApprovalPolicy;
  timeBudget?: number;
  monetaryBudget?: MoneyBudget;
  stepBudget?: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface TaskContractDraft {
  objective?: string;
  deliverables?: string[];
  constraints?: string[];
  completionCriteria?: Array<string | Omit<CompletionCriterion, "id">>;
  forbiddenActions?: string[];
  assumptions?: string[];
  riskLevel?: RiskLevel;
  approvalPolicy?: MissionApprovalPolicy;
  timeBudget?: number;
  monetaryBudget?: MoneyBudget;
  stepBudget?: number;
}

/** Deterministic baseline contract; an LLM may enrich the draft before planning. */
export function createTaskContract(
  originalRequest: string,
  draft: TaskContractDraft = {},
  now = new Date().toISOString(),
): TaskContract {
  const objective = draft.objective?.trim() || originalRequest.trim();
  if (!objective) throw new Error("Task objective cannot be empty");
  const riskLevel = draft.riskLevel ?? inferRisk(originalRequest);
  return {
    id: generateId("contract"),
    originalRequest,
    objective,
    deliverables: stringsToItems(draft.deliverables ?? [objective]),
    constraints: (draft.constraints ?? []).map((description) => ({
      id: generateId("constraint"),
      description,
      required: true,
    })),
    completionCriteria: (draft.completionCriteria ?? [objective]).map((criterion) =>
      typeof criterion === "string"
        ? {
            id: generateId("criterion"),
            description: criterion,
            required: true,
          }
        : { id: generateId("criterion"), ...criterion },
    ),
    forbiddenActions: stringsToItems(draft.forbiddenActions ?? []),
    assumptions: (draft.assumptions ?? []).map((description) => ({
      id: generateId("assumption"),
      description,
      confirmed: false,
    })),
    riskLevel,
    approvalPolicy:
      draft.approvalPolicy ?? (riskLevel === "financial" ? "commit_required" : "sensitive"),
    timeBudget: draft.timeBudget,
    monetaryBudget: draft.monetaryBudget,
    stepBudget: draft.stepBudget,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

export function amendTaskContract(
  contract: TaskContract,
  patch: TaskContractDraft,
  now = new Date().toISOString(),
): TaskContract {
  const replacement = createTaskContract(contract.originalRequest, {
    objective: patch.objective ?? contract.objective,
    deliverables: patch.deliverables ?? contract.deliverables.map((item) => item.description),
    constraints: patch.constraints ?? contract.constraints.map((item) => item.description),
    completionCriteria:
      patch.completionCriteria ??
      contract.completionCriteria.map(({ description, required, verifier }) => ({
        description,
        required,
        verifier,
      })),
    forbiddenActions:
      patch.forbiddenActions ?? contract.forbiddenActions.map((item) => item.description),
    assumptions: patch.assumptions ?? contract.assumptions.map((item) => item.description),
    riskLevel: patch.riskLevel ?? contract.riskLevel,
    approvalPolicy: patch.approvalPolicy ?? contract.approvalPolicy,
    timeBudget: patch.timeBudget ?? contract.timeBudget,
    monetaryBudget: patch.monetaryBudget ?? contract.monetaryBudget,
    stepBudget: patch.stepBudget ?? contract.stepBudget,
  }, now);
  return {
    ...replacement,
    id: contract.id,
    createdAt: contract.createdAt,
    version: contract.version + 1,
  };
}

function stringsToItems(values: string[]): Array<{ id: string; description: string }> {
  return values.map((description) => ({ id: generateId("item"), description }));
}

function inferRisk(request: string): RiskLevel {
  if (/(buy|purchase|book|pay|order|куп|оплат|заказ|брони)/i.test(request)) return "financial";
  if (/(delete|remove|shutdown|restart|удал|выключ|перезапуст)/i.test(request)) return "high";
  return "low";
}
