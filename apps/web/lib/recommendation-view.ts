import type { RecommendationReadModel } from '@hidmo/database'

export function serializeRecommendationView(
  recommendation: RecommendationReadModel,
) {
  const modelMetadata = recommendation.modelMetadata ?? {}
  const modelProvider =
    typeof modelMetadata.provider === 'string' ? modelMetadata.provider : null
  const modelName =
    typeof modelMetadata.model === 'string' ? modelMetadata.model : null
  const promptVersion =
    typeof modelMetadata.promptVersion === 'string'
      ? modelMetadata.promptVersion
      : null

  return {
    rowId: recommendation.rowId,
    candidateId: recommendation.id,
    type: recommendation.type,
    status: recommendation.status,
    priority: recommendation.priority,
    rank: recommendation.rank ?? null,
    title: recommendation.title,
    rationale: recommendation.rationale,
    evidence: recommendation.evidence.map((evidence) => ({
      id: evidence.id,
      kind: evidence.kind,
      label: evidence.label,
      amountMinor: evidence.amountMinor?.toString() ?? null,
      percentageBps: evidence.percentageBps ?? null,
      currency: evidence.currency ?? null,
      severity: evidence.severity ?? null,
    })),
    assumptions: recommendation.assumptions,
    estimatedMonthlyImpactMinor:
      recommendation.estimatedMonthlyImpactMinor?.toString() ?? null,
    currency: recommendation.currency,
    confidenceBps: recommendation.confidenceBps,
    formulaVersion: recommendation.formulaVersion,
    policyVersion: recommendation.policyVersion,
    modelProvider,
    modelName,
    promptVersion,
    updatedAt: recommendation.updatedAt.toISOString(),
  }
}
