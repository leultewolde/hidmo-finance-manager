import type {
  RecommendationGroundingProvider,
  RecommendationGroundingResult,
} from '@hidmo/ai'
import type { createRepositories } from '@hidmo/database'
import {
  buildFinancialAnalysisSummary,
  buildRecommendationCandidates,
  formulaDefinitions,
  recommendationPolicyVersion,
  type AnalysisPeriod,
  type DeterministicFinancialSummary,
} from '@hidmo/finance-engine'

import { computeAnalysisInputHash } from './service.js'

type Repositories = Pick<
  ReturnType<typeof createRepositories>,
  'analysisInputs' | 'recommendations'
>

export type RecommendationGenerationStatus =
  | 'generated'
  | 'reused'
  | 'no_candidates'

export type RecommendationGenerationResult = {
  status: RecommendationGenerationStatus
  userId: string
  period: AnalysisPeriod
  inputHash: string
  formulaVersion: string
  policyVersion: typeof recommendationPolicyVersion
  deterministicSummary: DeterministicFinancialSummary
  recommendationCount: number
  aiMetadata?: RecommendationGroundingResult['metadata']
}

export type RecommendationGenerationServiceInput = {
  userId: string
  period: AnalysisPeriod
  repositories: Repositories
  groundingProvider: RecommendationGroundingProvider
  locale?: string
  maxPayloadBytes?: number
}

export class RecommendationGenerationError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'RECOMMENDATION_INPUT_UNAVAILABLE'
      | 'RECOMMENDATION_PROVIDER_FAILED'
      | 'RECOMMENDATION_STORAGE_FAILED',
    readonly originalError?: unknown,
  ) {
    super(message)
    this.name = 'RecommendationGenerationError'
  }
}

export async function generateRecommendations(
  input: RecommendationGenerationServiceInput,
): Promise<RecommendationGenerationResult> {
  const formulaVersion = formulaDefinitions.financialAnalysisSummary.version
  const analysisInput = await input.repositories.analysisInputs.buildForPeriod(
    input.userId,
    input.period,
  )
  const deterministicSummary =
    buildFinancialAnalysisSummary(analysisInput).value
  const inputHash = computeAnalysisInputHash(analysisInput)
  const policyResult = buildRecommendationCandidates(deterministicSummary)

  if (policyResult.candidates.length === 0) {
    return {
      status: 'no_candidates',
      userId: input.userId,
      period: input.period,
      inputHash,
      formulaVersion,
      policyVersion: recommendationPolicyVersion,
      deterministicSummary,
      recommendationCount: 0,
    }
  }

  let storedCandidates: Awaited<
    ReturnType<Repositories['recommendations']['upsertCandidateBatch']>
  >
  try {
    storedCandidates =
      await input.repositories.recommendations.upsertCandidateBatch({
        userId: input.userId,
        period: input.period,
        inputHash,
        formulaVersion,
        policyVersion: recommendationPolicyVersion,
        evidence: policyResult.evidence,
        candidates: policyResult.candidates,
      })
  } catch (error) {
    throw new RecommendationGenerationError(
      'Recommendation candidates could not be stored.',
      'RECOMMENDATION_STORAGE_FAILED',
      error,
    )
  }

  const cachedGrounded = storedCandidates.filter(
    (recommendation) => recommendation.modelMetadata !== undefined,
  )
  if (cachedGrounded.length === policyResult.candidates.length) {
    const reusedResult: RecommendationGenerationResult = {
      status: 'reused',
      userId: input.userId,
      period: input.period,
      inputHash,
      formulaVersion,
      policyVersion: recommendationPolicyVersion,
      deterministicSummary,
      recommendationCount: cachedGrounded.length,
    }
    if (cachedGrounded[0]?.modelMetadata !== undefined) {
      reusedResult.aiMetadata = cachedGrounded[0]
        .modelMetadata as RecommendationGroundingResult['metadata']
    }
    return reusedResult
  }

  let groundingResult: RecommendationGroundingResult
  try {
    groundingResult = await input.groundingProvider.rankAndExplain({
      evidence: policyResult.evidence,
      candidates: policyResult.candidates,
      ...(input.locale === undefined ? {} : { locale: input.locale }),
      ...(input.maxPayloadBytes === undefined
        ? {}
        : { maxPayloadBytes: input.maxPayloadBytes }),
    })
  } catch (error) {
    throw new RecommendationGenerationError(
      'Recommendation provider failed while grounding recommendations.',
      'RECOMMENDATION_PROVIDER_FAILED',
      error,
    )
  }

  try {
    await input.repositories.recommendations.applyGroundedRecommendations({
      userId: input.userId,
      period: input.period,
      inputHash,
      formulaVersion,
      policyVersion: recommendationPolicyVersion,
      recommendations: groundingResult.recommendations,
      metadata: groundingResult.metadata,
    })
  } catch (error) {
    throw new RecommendationGenerationError(
      'Grounded recommendations could not be stored.',
      'RECOMMENDATION_STORAGE_FAILED',
      error,
    )
  }

  return {
    status: 'generated',
    userId: input.userId,
    period: input.period,
    inputHash,
    formulaVersion,
    policyVersion: recommendationPolicyVersion,
    deterministicSummary,
    recommendationCount: groundingResult.recommendations.length,
    aiMetadata: groundingResult.metadata,
  }
}
