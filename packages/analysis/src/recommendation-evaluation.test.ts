import { describe, expect, it, vi } from 'vitest'

import {
  AnalysisAiError,
  createMockRecommendationGroundingProvider,
  serializeFinancialSummaryForAi,
  serializeRecommendationGroundingInput,
  validateGroundedRecommendationResponse,
  type RecommendationGroundingProvider,
} from '@hidmo/ai'
import type {
  RecommendationReadModel,
  createRepositories,
} from '@hidmo/database'
import {
  buildFinancialAnalysisSummary,
  buildRecommendationCandidates,
  syntheticHousehold,
  type AnalysisInput,
  type AnalysisPeriod,
  type GroundedRecommendationOutput,
  type RecommendationCandidate,
  type RecommendationEvidenceReference,
  type RecommendationProviderMetadata,
} from '@hidmo/finance-engine'

import { generateRecommendations } from './recommendation-service.js'

type Repositories = Pick<
  ReturnType<typeof createRepositories>,
  'analysisInputs' | 'recommendations'
>

const period: AnalysisPeriod = {
  startDate: '2026-06-01',
  endDate: '2026-06-30',
  label: 'June 2026',
}

const ownerId = '00000000-0000-4000-8000-000000000001'

const healthyInput: AnalysisInput = {
  period,
  accounts: [
    {
      id: 'checking-1',
      name: 'Checking',
      kind: 'checking',
      balanceMinor: 700_000n,
      currency: 'USD',
      balanceAsOf: '2026-06-30',
      balanceSource: 'connected',
      dataQuality: 'verified',
    },
    {
      id: 'savings-1',
      name: 'Emergency savings',
      kind: 'savings',
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

const riskyDebtInput: AnalysisInput = {
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

const cashFlowAndDataQualityInput: AnalysisInput = {
  ...riskyDebtInput,
  accounts: [
    {
      id: 'checking-1',
      name: 'Checking',
      kind: 'checking',
      balanceMinor: 75_000n,
      currency: 'USD',
      balanceAsOf: '2026-06-30',
      balanceSource: 'connected',
      dataQuality: 'verified',
    },
    {
      id: 'credit-card-1',
      name: 'Credit card',
      kind: 'credit_card',
      balanceMinor: 500_000n,
      creditLimitMinor: 1_000_000n,
      currency: 'USD',
      balanceAsOf: '2026-06-30',
      balanceSource: 'connected',
      dataQuality: 'verified',
    },
  ],
  transactions: [
    {
      id: 'payroll',
      accountId: 'checking-1',
      postedDate: '2026-06-01',
      amountMinor: 300_000n,
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
      amountMinor: -180_000n,
      currency: 'USD',
      direction: 'outflow',
      economicType: 'expense',
      category: 'housing:rent',
      state: 'posted',
      reviewed: true,
    },
    {
      id: 'dining',
      accountId: 'credit-card-1',
      postedDate: '2026-06-06',
      amountMinor: -140_000n,
      currency: 'USD',
      direction: 'outflow',
      economicType: 'expense',
      category: 'dining:restaurants',
      state: 'posted',
      reviewed: true,
    },
    {
      id: 'uncertain',
      accountId: 'credit-card-1',
      postedDate: '2026-06-07',
      amountMinor: -25_000n,
      currency: 'USD',
      direction: 'outflow',
      economicType: 'unknown',
      category: 'uncategorized',
      state: 'posted',
      reviewed: false,
    },
  ],
  budgetLines: [
    { category: 'housing:rent', plannedMinor: 180_000n },
    { category: 'dining:restaurants', plannedMinor: 40_000n },
  ],
  debts: [
    {
      id: 'credit-card-1',
      name: 'Credit card',
      kind: 'credit_card',
      balanceMinor: 500_000n,
      aprBps: 2_499,
      minimumPaymentMinor: 15_000n,
      currency: 'USD',
    },
  ],
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
  evidence: readonly RecommendationEvidenceReference[]
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

function createEvaluationRepositories(input: AnalysisInput) {
  const rows = new Map<string, RecommendationReadModel>()

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
              evidence: batch.evidence,
            })
          rows.set(key, readModel)
          return readModel
        })
      },
      async applyGroundedRecommendations(batch: {
        inputHash: string
        recommendations: readonly GroundedRecommendationOutput[]
        metadata: RecommendationProviderMetadata
      }) {
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

  return { repositories, rows }
}

async function evaluate(input: AnalysisInput) {
  const fake = createEvaluationRepositories(input)
  const result = await generateRecommendations({
    userId: ownerId,
    period,
    repositories: fake.repositories,
    groundingProvider: createMockRecommendationGroundingProvider(),
  })

  return {
    result,
    rows: [...fake.rows.values()],
    deterministicSummary: buildFinancialAnalysisSummary(input).value,
    policyResult: buildRecommendationCandidates(
      buildFinancialAnalysisSummary(input).value,
    ),
  }
}

function assertNoPrivatePromptContent(value: unknown) {
  const json = JSON.stringify(value).toLowerCase()

  expect(json).not.toContain('access_token')
  expect(json).not.toContain('item_id')
  expect(json).not.toContain('provider_account_id')
  expect(json).not.toContain('provider_transaction_id')
  expect(json).not.toContain('routing')
  expect(json).not.toContain('account_number')
  expect(json).not.toContain('merchant')
  expect(json).not.toContain('description')
  expect(json).not.toContain('leulwoldegabriel')
}

describe('recommendation evaluation suite', () => {
  it('matches golden deterministic candidates for common financial states', async () => {
    const healthy = await evaluate(healthyInput)
    const riskyDebt = await evaluate(riskyDebtInput)
    const cashFlow = await evaluate(cashFlowAndDataQualityInput)

    expect(healthy.result.status).toBe('no_candidates')
    expect(healthy.policyResult.candidates).toEqual([])

    expect(riskyDebt.policyResult.candidates.map((candidate) => candidate.id))
      .toMatchInlineSnapshot(`
        [
          "rec:high_interest_debt:current-period",
          "rec:category_overspend:debt-interest",
          "rec:data_quality_gap:current-period",
        ]
      `)
    expect(
      riskyDebt.rows.map((recommendation) => recommendation.status),
    ).toEqual(['active', 'active', 'active'])

    expect(cashFlow.policyResult.candidates.map((candidate) => candidate.id))
      .toMatchInlineSnapshot(`
        [
          "rec:negative_free_cash_flow:current-period",
          "rec:low_emergency_fund:current-period",
          "rec:high_interest_debt:current-period",
          "rec:high_credit_utilization:current-period",
          "rec:category_overspend:dining-restaurants",
          "rec:data_quality_gap:current-period",
        ]
      `)
  })

  it('keeps grounded recommendation evidence within supplied candidate evidence', async () => {
    const { rows, policyResult } = await evaluate(cashFlowAndDataQualityInput)
    const candidateEvidence = new Map(
      policyResult.candidates.map((candidate) => [
        candidate.id,
        new Set(candidate.evidenceIds),
      ]),
    )

    for (const recommendation of rows) {
      const allowed = candidateEvidence.get(recommendation.id)
      expect(allowed).toBeDefined()
      for (const evidenceId of recommendation.evidenceIds) {
        expect(allowed?.has(evidenceId)).toBe(true)
      }
    }
  })

  it('rejects unknown evidence references from provider output', () => {
    const summary = buildFinancialAnalysisSummary(
      cashFlowAndDataQualityInput,
    ).value
    const { evidence, candidates } = buildRecommendationCandidates(summary)

    expect(() =>
      validateGroundedRecommendationResponse(
        {
          recommendations: [
            {
              candidateId: candidates[0]!.id,
              rank: 1,
              priority: 'high',
              title: 'Use supplied evidence only',
              rationale: 'This is grounded in supplied evidence.',
              evidenceIds: ['ev:metric:not-supplied'],
              assumptions: [],
              confidenceBps: 8_000,
            },
          ],
        },
        candidates,
        evidence,
      ),
    ).toThrow(AnalysisAiError)
  })

  it('rejects prohibited certainty and advice claims from provider output', () => {
    const summary = buildFinancialAnalysisSummary(
      cashFlowAndDataQualityInput,
    ).value
    const { evidence, candidates } = buildRecommendationCandidates(summary)

    expect(() =>
      validateGroundedRecommendationResponse(
        {
          recommendations: [
            {
              candidateId: candidates[0]!.id,
              rank: 1,
              priority: 'high',
              title: 'Guaranteed savings',
              rationale:
                'This will definitely create guaranteed savings and is tax advice.',
              evidenceIds: candidates[0]!.evidenceIds,
              assumptions: [],
              confidenceBps: 8_000,
            },
          ],
        },
        candidates,
        evidence,
      ),
    ).toThrow(AnalysisAiError)
  })

  it('keeps prompt payloads free of private identifiers and raw descriptions', () => {
    const summary = buildFinancialAnalysisSummary(
      cashFlowAndDataQualityInput,
    ).value
    const policyResult = buildRecommendationCandidates(summary)

    assertNoPrivatePromptContent(serializeFinancialSummaryForAi(summary))
    assertNoPrivatePromptContent(
      serializeRecommendationGroundingInput(policyResult),
    )
  })

  it('leaves candidates retryable when provider fails or returns invalid schema', async () => {
    const failingProvider: RecommendationGroundingProvider = {
      rankAndExplain: vi
        .fn()
        .mockRejectedValue(
          new AnalysisAiError('provider failed', 'AI_PROVIDER_REQUEST_FAILED'),
        ),
    }
    const invalidProvider: RecommendationGroundingProvider = {
      rankAndExplain: vi
        .fn()
        .mockRejectedValue(
          new AnalysisAiError('schema failed', 'AI_OUTPUT_INVALID'),
        ),
    }

    for (const provider of [failingProvider, invalidProvider]) {
      const fake = createEvaluationRepositories(cashFlowAndDataQualityInput)
      await expect(
        generateRecommendations({
          userId: ownerId,
          period,
          repositories: fake.repositories,
          groundingProvider: provider,
        }),
      ).rejects.toMatchObject({
        code: 'RECOMMENDATION_PROVIDER_FAILED',
      })

      expect([...fake.rows.values()]).not.toHaveLength(0)
      expect(
        [...fake.rows.values()].every(
          (recommendation) =>
            recommendation.status === 'candidate' &&
            recommendation.modelMetadata === undefined,
        ),
      ).toBe(true)
    }
  })
})
