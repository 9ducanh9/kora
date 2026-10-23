export interface EvaluationCohortIdentity {
  suiteVersion: string;
  suiteSha256: string;
  systemPromptSha256: string;
  matcherVersion: string;
  provider: string;
  requestedModel: string;
  generationOptions: Record<string, unknown>;
}

export interface CohortComparison {
  comparable: boolean;
  differences: string[];
  variableDifferences: string[];
}

export function compareEvaluationCohorts(left: EvaluationCohortIdentity, right: EvaluationCohortIdentity): CohortComparison {
  const differences: string[] = [];
  for (const key of Object.keys(left) as Array<keyof EvaluationCohortIdentity>) {
    if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) differences.push(key);
  }
  const variableDifferences = differences.filter(key => key === 'systemPromptSha256');
  const cohortDifferences = differences.filter(key => key !== 'systemPromptSha256');
  return { comparable: cohortDifferences.length === 0, differences: cohortDifferences, variableDifferences };
}
