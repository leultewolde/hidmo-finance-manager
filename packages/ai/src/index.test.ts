import { describe, expect, it } from 'vitest'

import {
  createRecommendationCandidateId,
  createRecommendationEvidenceId,
  type DeterministicFinancialSummary,
  type RecommendationCandidate,
  type RecommendationEvidenceReference,
} from '@hidmo/finance-engine'

import {
  AnalysisAiError,
  buildFinancialAnalysisNarrativePrompt,
  buildRecommendationGroundingPrompt,
  createMockFinancialAnalysisProvider,
  createMockRecommendationGroundingProvider,
  financialAnalysisPromptVersion,
  recommendationGroundingPromptVersion,
  serializeFinancialSummaryForAi,
  serializeRecommendationGroundingInput,
  validateFinancialAnalysisNarrative,
  validateGroundedRecommendationResponse,
} from './index.js'

const summary: DeterministicFinancialSummary = {
  period: {
    startDate: '2026-06-01',
    endDate: '2026-06-30',
    label: 'June 2026',
  },
  currency: 'USD',
  balanceSheet: {
    totalAssetsMinor: 5_950_000n,
    totalLiabilitiesMinor: 1_940_000n,
    netWorthMinor: 4_010_000n,
    liquidCashMinor: 1_250_000n,
  },
  cashFlow: {
    incomeMinor: 500_000n,
    expenseOutflowsMinor: 253_500n,
    refundsMinor: 7_000n,
    netExpensesMinor: 246_500n,
    freeCashFlowMinor: 253_500n,
    savingsRateBps: 5_070,
  },
  income: {
    incomeMinor: 500_000n,
    transactionCount: 1,
    sourceCount: 1,
  },
  spendingByCategory: [
    {
      category: 'housing:rent',
      outflowMinor: 180_000n,
      refundMinor: 0n,
      netExpenseMinor: 180_000n,
      transactionCount: 1,
    },
  ],
  debt: {
    totalDebtMinor: 1_940_000n,
    minimumPaymentsMinor: 55_000n,
    weightedAprBps: 974,
    highInterestDebtMinor: 210_000n,
    creditUtilizationBps: 2_100,
    accountsWithoutCreditLimit: 0,
  },
  emergencyFundCoverageMonthsHundredths: 532,
  budgetBaseline: {
    essentialExpensesMinor: 235_000n,
    discretionaryExpensesMinor: 11_500n,
    debtMinimumsMinor: 55_000n,
    savingsCapacityAfterMinimumDebtMinor: 198_500n,
    budgetVariance: [
      {
        category: 'housing:rent',
        plannedMinor: 180_000n,
        actualMinor: 180_000n,
        varianceMinor: 0n,
        remainingMinor: 0n,
      },
    ],
  },
  coverage: {
    accountsIncluded: 7,
    debtsIncluded: 3,
    transactionsAvailable: 11,
    transactionsIncluded: 10,
    splitsIncluded: 3,
    coverageNotes: [
      {
        code: 'investment-balances-included',
        severity: 'info',
        message:
          'Investment account balances are included in net worth; investment transactions are outside the current analysis scope.',
      },
    ],
  },
  riskIndicators: [
    {
      code: 'high-interest-debt',
      severity: 'warning',
      message: 'High-interest debt is present and should be prioritized.',
    },
  ],
}

const freeCashFlowEvidenceId = createRecommendationEvidenceId(
  'metric',
  'free-cash-flow',
)
const debtEvidenceId = createRecommendationEvidenceId(
  'metric',
  'high-interest-debt',
)
const cashFlowCandidateId = createRecommendationCandidateId(
  'negative_free_cash_flow',
  'current-period',
)
const debtCandidateId = createRecommendationCandidateId(
  'high_interest_debt',
  'current-period',
)

const recommendationEvidence: RecommendationEvidenceReference[] = [
  {
    id: freeCashFlowEvidenceId,
    kind: 'metric',
    label: 'Free cash flow',
    period: summary.period,
    amountMinor: -55_000n,
    currency: 'USD',
    severity: 'critical',
  },
  {
    id: debtEvidenceId,
    kind: 'metric',
    label: 'High-interest debt balance',
    period: summary.period,
    amountMinor: 210_000n,
    currency: 'USD',
    severity: 'warning',
  },
]

const recommendationCandidates: RecommendationCandidate[] = [
  {
    id: debtCandidateId,
    type: 'high_interest_debt',
    title: 'Prioritize extra payments toward high-interest debt',
    rationale:
      'High-interest balances are present, so extra repayment should come before lower-impact optimizations.',
    priority: 'high',
    status: 'candidate',
    evidenceIds: [debtEvidenceId],
    assumptions: ['APR thresholds are policy-defined.'],
    estimatedMonthlyImpactMinor: 198_500n,
    currency: 'USD',
    confidenceBps: 8_500,
  },
  {
    id: cashFlowCandidateId,
    type: 'negative_free_cash_flow',
    title: 'Close the monthly cash-flow gap',
    rationale:
      'Expenses and debt minimums are currently outrunning income for the analysis period.',
    priority: 'high',
    status: 'candidate',
    evidenceIds: [freeCashFlowEvidenceId],
    assumptions: ['Uses posted transactions in the deterministic period.'],
    estimatedMonthlyImpactMinor: 55_000n,
    currency: 'USD',
    confidenceBps: 9_000,
  },
]

describe('financial analysis AI guardrails', () => {
  it('serializes deterministic summaries into JSON-safe aggregate payloads', () => {
    const payload = serializeFinancialSummaryForAi(summary)

    expect(JSON.stringify(payload)).toContain('"freeCashFlowMinor":"253500"')
    expect(JSON.stringify(payload)).not.toContain('access_token')
    expect(JSON.stringify(payload)).not.toContain('provider_transaction_id')
  })

  it('rejects blocked fields before prompt construction', () => {
    const unsafeSummary = {
      ...summary,
      providerTransactionId: 'provider-transaction-id',
    } as unknown as DeterministicFinancialSummary

    expect(() =>
      buildFinancialAnalysisNarrativePrompt({ summary: unsafeSummary }),
    ).toThrow(AnalysisAiError)
  })

  it('rejects payloads that exceed the configured size limit', () => {
    expect(() =>
      buildFinancialAnalysisNarrativePrompt({
        summary,
        maxPayloadBytes: 100,
      }),
    ).toThrow(/exceeding limit 100/)
  })

  it('builds a versioned prompt for schema-only JSON output', () => {
    const prompt = buildFinancialAnalysisNarrativePrompt({ summary })

    expect(prompt.promptVersion).toBe(financialAnalysisPromptVersion)
    expect(prompt.systemInstruction).toContain('Return only JSON')
    expect(prompt.userPrompt).toContain('recommendedActions')
    expect(prompt.payloadBytes).toBeGreaterThan(0)
  })
})

describe('financial analysis narrative validation', () => {
  it('accepts the strict narrative schema', () => {
    expect(
      validateFinancialAnalysisNarrative({
        currentStanding: 'Stable.',
        budgetSummary: 'Budget has room.',
        recommendedActions: [
          {
            priority: 'high',
            title: 'Pay high-interest debt',
            rationale: 'High-interest debt is present.',
          },
        ],
        caveats: ['Reviewed data only.'],
        disclaimer: 'Planning assistance only.',
      }),
    ).toMatchObject({ currentStanding: 'Stable.' })
  })

  it('rejects extra fields and invalid priorities', () => {
    expect(() =>
      validateFinancialAnalysisNarrative({
        currentStanding: 'Stable.',
        budgetSummary: 'Budget has room.',
        recommendedActions: [
          {
            priority: 'urgent',
            title: 'Pay high-interest debt',
            rationale: 'High-interest debt is present.',
          },
        ],
        caveats: [],
        disclaimer: 'Planning assistance only.',
        extra: 'not allowed',
      }),
    ).toThrow(AnalysisAiError)
  })
})

describe('mock financial analysis provider', () => {
  it('returns deterministic schema-valid narrative and metadata', async () => {
    const provider = createMockFinancialAnalysisProvider()

    await expect(
      provider.generateNarrative({ summary }),
    ).resolves.toMatchObject({
      narrative: {
        recommendedActions: expect.arrayContaining([
          expect.objectContaining({
            priority: 'high',
            title: 'Prioritize high-interest debt',
          }),
        ]),
        disclaimer:
          'This is planning assistance based on your app data, not financial, legal, tax, or investment advice.',
      },
      metadata: {
        provider: 'mock',
        model: 'mock-financial-analysis-v1',
        promptVersion: financialAnalysisPromptVersion,
        outputSchemaVersion: 1,
      },
    })
  })
})

describe('recommendation grounding AI guardrails', () => {
  it('serializes only grounded recommendation candidate and evidence payloads', () => {
    const payload = serializeRecommendationGroundingInput({
      evidence: recommendationEvidence,
      candidates: recommendationCandidates,
    })
    const json = JSON.stringify(payload)

    expect(json).toContain('"amountMinor":"-55000"')
    expect(json).toContain(cashFlowCandidateId)
    expect(json).not.toContain('provider_transaction_id')
    expect(json).not.toContain('access_token')
  })

  it('rejects blocked fields before recommendation prompt construction', () => {
    expect(() =>
      serializeRecommendationGroundingInput({
        evidence: recommendationEvidence,
        candidates: recommendationCandidates.map((candidate) => ({
          ...candidate,
          providerTransactionId: 'provider-transaction-id',
        })) as unknown as RecommendationCandidate[],
      }),
    ).toThrow()
  })

  it('builds a versioned recommendation grounding prompt', () => {
    const prompt = buildRecommendationGroundingPrompt({
      evidence: recommendationEvidence,
      candidates: recommendationCandidates,
    })

    expect(prompt.promptVersion).toBe(recommendationGroundingPromptVersion)
    expect(prompt.systemInstruction).toContain('Return only JSON')
    expect(prompt.userPrompt).toContain('candidateId')
    expect(prompt.payloadBytes).toBeGreaterThan(0)
  })

  it('rejects unknown candidate and evidence references', () => {
    expect(() =>
      validateGroundedRecommendationResponse(
        {
          recommendations: [
            {
              candidateId: 'rec:high_interest_debt:unknown',
              rank: 1,
              priority: 'high',
              title: 'Prioritize extra payments',
              rationale: 'High-interest debt evidence supports this.',
              evidenceIds: [debtEvidenceId],
              assumptions: [],
              confidenceBps: 8_000,
            },
          ],
        },
        recommendationCandidates,
        recommendationEvidence,
      ),
    ).toThrow()

    expect(() =>
      validateGroundedRecommendationResponse(
        {
          recommendations: [
            {
              candidateId: debtCandidateId,
              rank: 1,
              priority: 'high',
              title: 'Prioritize extra payments',
              rationale: 'High-interest debt evidence supports this.',
              evidenceIds: ['ev:metric:not-supplied'],
              assumptions: [],
              confidenceBps: 8_000,
            },
          ],
        },
        recommendationCandidates,
        recommendationEvidence,
      ),
    ).toThrow()
  })

  it('rejects prohibited claims from recommendation grounding output', () => {
    expect(() =>
      validateGroundedRecommendationResponse(
        {
          recommendations: [
            {
              candidateId: debtCandidateId,
              rank: 1,
              priority: 'high',
              title: 'Guaranteed debt payoff',
              rationale: 'This will definitely create guaranteed savings.',
              evidenceIds: [debtEvidenceId],
              assumptions: [],
              confidenceBps: 8_000,
            },
          ],
        },
        recommendationCandidates,
        recommendationEvidence,
      ),
    ).toThrow()
  })
})

describe('mock recommendation grounding provider', () => {
  it('returns deterministic schema-valid recommendations and metadata', async () => {
    const provider = createMockRecommendationGroundingProvider()

    await expect(
      provider.rankAndExplain({
        evidence: recommendationEvidence,
        candidates: recommendationCandidates,
      }),
    ).resolves.toMatchObject({
      recommendations: [
        {
          candidateId: debtCandidateId,
          rank: 1,
          priority: 'high',
          evidenceIds: [debtEvidenceId],
        },
        {
          candidateId: cashFlowCandidateId,
          rank: 2,
          priority: 'high',
          evidenceIds: [freeCashFlowEvidenceId],
        },
      ],
      metadata: {
        provider: 'mock',
        model: 'mock-recommendation-grounding-v1',
        promptVersion: recommendationGroundingPromptVersion,
        outputSchemaVersion: 1,
      },
    })
  })
})
