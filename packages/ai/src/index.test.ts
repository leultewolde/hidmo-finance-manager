import { describe, expect, it } from 'vitest'

import type { DeterministicFinancialSummary } from '@hidmo/finance-engine'

import {
  AnalysisAiError,
  buildFinancialAnalysisNarrativePrompt,
  createMockFinancialAnalysisProvider,
  financialAnalysisPromptVersion,
  serializeFinancialSummaryForAi,
  validateFinancialAnalysisNarrative,
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
