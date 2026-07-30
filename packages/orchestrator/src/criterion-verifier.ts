import type { Evidence } from "@heyagent/shared";
import type { CompletionCriterion, TaskContract } from "./task-contract.js";

export interface ExternalBlocker {
  code: string;
  description: string;
  evidence: Evidence[];
}

export interface CriterionResult {
  criterionId: string;
  success: boolean;
  evidence: Evidence[];
  explanation?: string;
}

export interface TaskVerificationResult {
  success: boolean;
  confidence: number;
  criterionResults: CriterionResult[];
  blockers: ExternalBlocker[];
}

export type CriterionVerifier = (
  criterion: CompletionCriterion,
) => Promise<Omit<CriterionResult, "criterionId">>;

export async function verifyTaskContract(
  contract: TaskContract,
  verifier: CriterionVerifier,
  blockers: ExternalBlocker[] = [],
): Promise<TaskVerificationResult> {
  const criterionResults = await Promise.all(
    contract.completionCriteria.map(async (criterion) => ({
      criterionId: criterion.id,
      ...await verifier(criterion),
    })),
  );
  const required = contract.completionCriteria.filter((criterion) => criterion.required);
  const passedRequired = required.filter(
    (criterion) => criterionResults.find((result) => result.criterionId === criterion.id)?.success,
  );
  const evidenced = criterionResults.filter((result) => result.success && result.evidence.length > 0);
  const confidence =
    criterionResults.length === 0
      ? 0
      : Math.min(
          1,
          (passedRequired.length / Math.max(1, required.length)) * 0.7 +
          (evidenced.length / criterionResults.length) * 0.3,
        );
  return {
    success:
      required.length > 0 &&
      passedRequired.length === required.length &&
      blockers.length === 0 &&
      evidenced.length >= passedRequired.length,
    confidence,
    criterionResults,
    blockers: structuredClone(blockers),
  };
}
