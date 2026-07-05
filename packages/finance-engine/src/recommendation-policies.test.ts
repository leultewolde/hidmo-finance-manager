import { describe, expect, it } from 'vitest'

import type { DeterministicFinancialSummary } from './analysis.js'
import {
  buildRecommendationCandidates,
  type RecommendationPolicyResult,
} from './recommendation-policies.js'
import {
  assertRecommendationPayloadSafe,
  validateRecommendationCandidate,
} from './recommendations.js'

const period = { startDate: '2026-06-01', endDate: '2026-06-30' }

const riskySummary = {
  period,
  currency: 'USD',
  balanceSheet: {
    totalAssetsMinor: 160_000n,
    totalLiabilitiesMinor: 700_000n,
    netWorthMinor: -540_000n,
    liquidCashMinor: 75_000n,
  },
  cashFlow: {
    incomeMinor: 500_000n,
    expenseOutflowsMinor: 555_000n,
    refundsMinor: 0n,
    netExpensesMinor: 555_000n,
    freeCashFlowMinor: -55_000n,
    savingsRateBps: -1_100,
  },
  income: {
    incomeMinor: 500_000n,
    transactionCount: 1,
    sourceCount: 1,
  },
  spendingByCategory: [
    {
      category: 'dining:restaurants',
      outflowMinor: 140_000n,
      refundMinor: 0n,
      netExpenseMinor: 140_000n,
      transactionCount: 8,
    },
    {
      category: 'debt:interest',
      outflowMinor: 10_500n,
      refundMinor: 0n,
      netExpenseMinor: 10_500n,
      transactionCount: 2,
    },
  ],
  debt: {
    totalDebtMinor: 700_000n,
    minimumPaymentsMinor: 80_000n,
    weightedAprBps: 1_980,
    highInterestDebtMinor: 450_000n,
    creditUtilizationBps: 4_600,
    accountsWithoutCreditLimit: 0,
  },
  emergencyFundCoverageMonthsHundredths: 75,
  budgetBaseline: {
    essentialExpensesMinor: 100_000n,
    discretionaryExpensesMinor: 455_000n,
    debtMinimumsMinor: 80_000n,
    savingsCapacityAfterMinimumDebtMinor: -135_000n,
    budgetVariance: [
      {
        category: 'debt:interest',
        plannedMinor: 5_000n,
        actualMinor: 10_500n,
        varianceMinor: 5_500n,
        remainingMinor: -5_500n,
      },
      {
        category: 'dining:restaurants',
        plannedMinor: 120_000n,
        actualMinor: 140_000n,
        varianceMinor: 20_000n,
        remainingMinor: -20_000n,
      },
      {
        category: 'food:groceries',
        plannedMinor: 70_000n,
        actualMinor: 60_000n,
        varianceMinor: -10_000n,
        remainingMinor: 10_000n,
      },
    ],
  },
  coverage: {
    accountsIncluded: 4,
    debtsIncluded: 2,
    transactionsAvailable: 12,
    transactionsIncluded: 10,
    splitsIncluded: 0,
    coverageNotes: [
      {
        code: 'unknown-transactions-present',
        severity: 'warning',
        message: 'Some transactions still need categories.',
      },
      {
        code: 'pending-transactions-excluded',
        severity: 'info',
        message: 'Pending transactions were excluded.',
      },
    ],
  },
  riskIndicators: [
    {
      code: 'negative-free-cash-flow',
      severity: 'critical',
      message: 'Free cash flow is negative for the current period.',
    },
    {
      code: 'low-emergency-fund',
      severity: 'critical',
      message: 'Emergency-fund coverage is below the target floor.',
    },
    {
      code: 'high-credit-utilization',
      severity: 'warning',
      message:
        'Credit-card utilization is high enough to pressure flexibility.',
    },
    {
      code: 'high-interest-debt',
      severity: 'warning',
      message: 'High-interest debt is present and should be prioritized.',
    },
    {
      code: 'unreviewed-data',
      severity: 'info',
      message: 'Unreviewed transactions may change the final recommendation.',
    },
  ],
} satisfies DeterministicFinancialSummary

const healthySummary = {
  ...riskySummary,
  balanceSheet: {
    totalAssetsMinor: 1_200_000n,
    totalLiabilitiesMinor: 100_000n,
    netWorthMinor: 1_100_000n,
    liquidCashMinor: 700_000n,
  },
  cashFlow: {
    incomeMinor: 500_000n,
    expenseOutflowsMinor: 300_000n,
    refundsMinor: 0n,
    netExpensesMinor: 300_000n,
    freeCashFlowMinor: 200_000n,
    savingsRateBps: 4_000,
  },
  debt: {
    totalDebtMinor: 100_000n,
    minimumPaymentsMinor: 10_000n,
    weightedAprBps: 500,
    highInterestDebtMinor: 0n,
    creditUtilizationBps: 1_500,
    accountsWithoutCreditLimit: 0,
  },
  emergencyFundCoverageMonthsHundredths: 700,
  budgetBaseline: {
    essentialExpensesMinor: 100_000n,
    discretionaryExpensesMinor: 200_000n,
    debtMinimumsMinor: 10_000n,
    savingsCapacityAfterMinimumDebtMinor: 190_000n,
    budgetVariance: [
      {
        category: 'food:groceries',
        plannedMinor: 70_000n,
        actualMinor: 60_000n,
        varianceMinor: -10_000n,
        remainingMinor: 10_000n,
      },
    ],
  },
  coverage: {
    accountsIncluded: 4,
    debtsIncluded: 1,
    transactionsAvailable: 10,
    transactionsIncluded: 10,
    splitsIncluded: 0,
    coverageNotes: [],
  },
  riskIndicators: [],
} satisfies DeterministicFinancialSummary

function expectValidResult(result: RecommendationPolicyResult) {
  assertRecommendationPayloadSafe(result)
  for (const candidate of result.candidates) {
    expect(validateRecommendationCandidate(candidate, result.evidence)).toEqual(
      candidate,
    )
  }
}

describe('recommendation policy engine', () => {
  it('builds deterministic grounded candidates from analysis facts', () => {
    const result = buildRecommendationCandidates(riskySummary)

    expect(result).toEqual(buildRecommendationCandidates(riskySummary))
    expectValidResult(result)

    expect(result.candidates.map((candidate) => candidate.id)).toEqual([
      'rec:negative_free_cash_flow:current-period',
      'rec:low_emergency_fund:current-period',
      'rec:high_interest_debt:current-period',
      'rec:high_credit_utilization:current-period',
      'rec:category_overspend:dining-restaurants',
      'rec:category_overspend:debt-interest',
      'rec:data_quality_gap:current-period',
    ])
    expect(result.candidates.map((candidate) => candidate.priority)).toEqual([
      'high',
      'high',
      'high',
      'medium',
      'low',
      'medium',
      'medium',
    ])
    expect(
      result.candidates.find(
        (candidate) => candidate.type === 'negative_free_cash_flow',
      )?.estimatedMonthlyImpactMinor,
    ).toBe(55_000n)
    expect(
      result.evidence.map((entry) => [entry.id, entry.kind] as const),
    ).toContainEqual(['ev:metric:free-cash-flow', 'metric'])
    expect(
      result.evidence.map((entry) => [entry.id, entry.kind] as const),
    ).toContainEqual([
      'ev:coverage_note:unknown-transactions-present',
      'coverage_note',
    ])
  })

  it('limits category overspend candidates by largest positive variance', () => {
    const result = buildRecommendationCandidates(riskySummary, {
      maxCategoryRecommendations: 1,
    })

    expectValidResult(result)
    expect(
      result.candidates
        .filter((candidate) => candidate.type === 'category_overspend')
        .map((candidate) => candidate.id),
    ).toEqual(['rec:category_overspend:dining-restaurants'])
  })

  it('allows policy thresholds to be tightened without AI involvement', () => {
    const result = buildRecommendationCandidates(healthySummary, {
      emergencyFundTargetMonthsHundredths: 900,
      highCreditUtilizationBps: 1_000,
    })

    expectValidResult(result)
    expect(result.candidates.map((candidate) => candidate.type)).toEqual([
      'low_emergency_fund',
      'high_credit_utilization',
    ])
  })

  it('returns no candidates when deterministic facts do not trigger policies', () => {
    const result = buildRecommendationCandidates(healthySummary)

    expect(result).toEqual({
      evidence: [],
      candidates: [],
    })
  })
})
