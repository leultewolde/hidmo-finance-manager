import { describe, expect, it } from 'vitest'

import type { RecommendationGroundingProvider } from '@hidmo/ai'
import { createMockRecommendationGroundingProvider } from '@hidmo/ai'
import type {
  RecommendationReadModel,
  createRepositories,
} from '@hidmo/database'
import type {
  AnalysisInput,
  AnalysisPeriod,
  GroundedRecommendationOutput,
  RecommendationCandidate,
  RecommendationEvidenceReference,
  RecommendationProviderMetadata,
} from '@hidmo/finance-engine'
import { syntheticHousehold } from '@hidmo/finance-engine'

import { generateRecommendations } from './recommendation-service.js'
import type { RecommendationGenerationError } from './recommendation-service.js'

type Repositories = Pick<
  ReturnType<typeof createRepositories>,
  'analysisInputs' | 'recommendations'
>

const period: AnalysisPeriod = {
  startDate: '2026-06-01',
  endDate: '2026-06-30',
  label: 'June 2026',
}

const riskyAnalysisInput: AnalysisInput = {
  period,
  accounts: syntheticHousehold.accounts,
  debts: syntheticHousehold.debts,
  transactions: [
    ...syntheticHousehold.transactions,
    syntheticHousehold.loanPaymentTransaction,
  ],
  splits: syntheticHousehold.loanPaymentSplits,
  budgetLines: syntheticHousehold.budget,
  reviewedTransactionsOnly: true,
}

const healthyAnalysisInput: AnalysisInput = {
  period,
  accounts: [
    {
      id: 'checking-1',
      name: 'Checking',
      kind: 'checking',
      balanceMinor: 900_000n,
      currency: 'USD',
      balanceAsOf: '2026-06-30',
      balanceSource: 'connected',
      dataQuality: 'verified',
    },
  ],
  debts: [],
  transactions: [
    {
      id: 'payroll',
      accountId: 'checking-1',
      postedDate: '2026-06-01',
      amountMinor: 500_000n,
      currency: 'USD',
      direction: 'inflow',
      economicType: 'income',
      category: 'income:payroll',
      state: 'posted',
      reviewed: true,
    },
    {
      id: 'rent',
      accountId: 'checking-1',
      postedDate: '2026-06-02',
      amountMinor: -100_000n,
      currency: 'USD',
      direction: 'outflow',
      economicType: 'expense',
      category: 'housing:rent',
      state: 'posted',
      reviewed: true,
    },
  ],
  splits: [],
  budgetLines: [{ category: 'housing:rent', plannedMinor: 100_000n }],
  reviewedTransactionsOnly: true,
}

function priorityRank(priority: RecommendationCandidate['priority']) {
  return priority === 'high' ? 1 : priority === 'medium' ? 2 : 3
}

function toReadModel(input: {
  userId: string
  period: AnalysisPeriod
  inputHash: string
  formulaVersion: string
  policyVersion: string
  candidate: RecommendationCandidate
  evidence: RecommendationEvidenceReference[]
  modelMetadata?: RecommendationProviderMetadata
}): RecommendationReadModel {
  const readModel: RecommendationReadModel = {
    ...input.candidate,
    rowId: `row:${input.candidate.id}`,
    userId: input.userId,
    period: input.period,
    inputHash: input.inputHash,
    formulaVersion: input.formulaVersion,
    policyVersion: input.policyVersion,
    rank: priorityRank(input.candidate.priority),
    evidence: input.evidence.filter((evidence) =>
      input.candidate.evidenceIds.includes(evidence.id),
    ),
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
  }
  if (input.modelMetadata !== undefined) {
    readModel.modelMetadata = input.modelMetadata
  }
  return readModel
}

function createRepositoriesFake(input: AnalysisInput = riskyAnalysisInput) {
  const rows = new Map<string, RecommendationReadModel>()
  const transitions: string[] = []

  function keyFor(inputHash: string, candidateId: string) {
    return `${inputHash}:${candidateId}`
  }

  const repositories = {
    analysisInputs: {
      async buildForPeriod() {
        return input
      },
    },
    recommendations: {
      async upsertCandidateBatch(batch: {
        userId: string
        period: AnalysisPeriod
        inputHash: string
        formulaVersion: string
        policyVersion: string
        evidence: readonly RecommendationEvidenceReference[]
        candidates: readonly RecommendationCandidate[]
      }) {
        transitions.push('recommendations:upsert-candidates')
        return batch.candidates.map((candidate) => {
          const key = keyFor(batch.inputHash, candidate.id)
          const existing = rows.get(key)
          const readModel =
            existing ??
            toReadModel({
              userId: batch.userId,
              period: batch.period,
              inputHash: batch.inputHash,
              formulaVersion: batch.formulaVersion,
              policyVersion: batch.policyVersion,
              candidate,
              evidence: [...batch.evidence],
            })
          rows.set(key, readModel)
          return readModel
        })
      },
      async applyGroundedRecommendations(batch: {
        userId: string
        period: AnalysisPeriod
        inputHash: string
        formulaVersion: string
        policyVersion: string
        recommendations: readonly GroundedRecommendationOutput[]
        metadata: RecommendationProviderMetadata
      }) {
        transitions.push('recommendations:apply-grounded')
        return batch.recommendations.map((recommendation) => {
          const key = keyFor(batch.inputHash, recommendation.candidateId)
          const existing = rows.get(key)
          if (existing === undefined) {
            throw new Error('missing candidate')
          }
          const updated: RecommendationReadModel = {
            ...existing,
            status: 'active',
            rank: recommendation.rank,
            priority: recommendation.priority,
            title: recommendation.title,
            rationale: recommendation.rationale,
            evidenceIds: recommendation.evidenceIds,
            assumptions: recommendation.assumptions,
            confidenceBps: recommendation.confidenceBps,
            modelMetadata: batch.metadata,
            updatedAt: new Date('2026-07-01T00:01:00.000Z'),
          }
          rows.set(key, updated)
          return updated
        })
      },
    },
  } as unknown as Repositories

  return {
    repositories,
    rows,
    transitions,
  }
}

function createCountingGroundingProvider(
  calls: string[],
): RecommendationGroundingProvider {
  const provider = createMockRecommendationGroundingProvider()
  return {
    async rankAndExplain(request) {
      calls.push(request.candidates.length.toString())
      return provider.rankAndExplain(request)
    },
  }
}

describe('recommendation generation service', () => {
  it('generates deterministic candidates, grounds them, and stores metadata', async () => {
    const fake = createRepositoriesFake()
    const providerCalls: string[] = []

    const result = await generateRecommendations({
      userId: '00000000-0000-4000-8000-000000000001',
      period,
      repositories: fake.repositories,
      groundingProvider: createCountingGroundingProvider(providerCalls),
    })

    expect(result).toMatchObject({
      status: 'generated',
      formulaVersion: 'financial-analysis-summary/v1',
      policyVersion: 'recommendation-policies/v1',
      recommendationCount: 3,
      aiMetadata: {
        provider: 'mock',
        model: 'mock-recommendation-grounding-v1',
      },
    })
    expect(result.inputHash).toMatch(/^[0-9a-f]{64}$/)
    expect(providerCalls).toEqual(['3'])
    expect(fake.transitions).toEqual([
      'recommendations:upsert-candidates',
      'recommendations:apply-grounded',
    ])
    expect(
      [...fake.rows.values()].every(
        (recommendation) =>
          recommendation.status === 'active' &&
          recommendation.modelMetadata?.provider === 'mock',
      ),
    ).toBe(true)
  })

  it('reuses grounded recommendations for the same input hash without calling the provider', async () => {
    const fake = createRepositoriesFake()
    const providerCalls: string[] = []

    await generateRecommendations({
      userId: '00000000-0000-4000-8000-000000000001',
      period,
      repositories: fake.repositories,
      groundingProvider: createCountingGroundingProvider(providerCalls),
    })
    providerCalls.length = 0

    const reused = await generateRecommendations({
      userId: '00000000-0000-4000-8000-000000000001',
      period,
      repositories: fake.repositories,
      groundingProvider: createCountingGroundingProvider(providerCalls),
    })

    expect(reused).toMatchObject({
      status: 'reused',
      recommendationCount: 3,
      aiMetadata: {
        provider: 'mock',
      },
    })
    expect(providerCalls).toHaveLength(0)
  })

  it('leaves candidates retryable when the grounding provider fails', async () => {
    const fake = createRepositoriesFake()
    const failingProvider: RecommendationGroundingProvider = {
      async rankAndExplain() {
        throw Object.assign(new Error('provider failed'), {
          code: 'AI_OUTPUT_INVALID',
        })
      },
    }

    await expect(
      generateRecommendations({
        userId: '00000000-0000-4000-8000-000000000001',
        period,
        repositories: fake.repositories,
        groundingProvider: failingProvider,
      }),
    ).rejects.toMatchObject({
      code: 'RECOMMENDATION_PROVIDER_FAILED',
    } satisfies Partial<RecommendationGenerationError>)

    expect(fake.transitions).toEqual(['recommendations:upsert-candidates'])
    expect(
      [...fake.rows.values()].every(
        (recommendation) =>
          recommendation.status === 'candidate' &&
          recommendation.modelMetadata === undefined,
      ),
    ).toBe(true)
  })

  it('returns no_candidates without calling the provider when no policy triggers', async () => {
    const fake = createRepositoriesFake(healthyAnalysisInput)
    const providerCalls: string[] = []

    const result = await generateRecommendations({
      userId: '00000000-0000-4000-8000-000000000001',
      period,
      repositories: fake.repositories,
      groundingProvider: createCountingGroundingProvider(providerCalls),
    })

    expect(result).toMatchObject({
      status: 'no_candidates',
      recommendationCount: 0,
    })
    expect(providerCalls).toHaveLength(0)
    expect(fake.transitions).toEqual([])
  })
})
