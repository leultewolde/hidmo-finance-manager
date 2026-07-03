import { describe, expect, it } from 'vitest'

import type { Transaction } from './domain.js'
import { syntheticHousehold } from './fixtures.js'
import { buildFinancialAnalysisSummary } from './analysis.js'

const june = { startDate: '2026-06-01', endDate: '2026-06-30' }

describe('financial analysis summary', () => {
  it('builds deterministic analysis inputs without asking AI to calculate core numbers', () => {
    const result = buildFinancialAnalysisSummary({
      period: { ...june, label: 'June 2026' },
      accounts: syntheticHousehold.accounts,
      debts: syntheticHousehold.debts,
      transactions: [
        ...syntheticHousehold.transactions,
        syntheticHousehold.loanPaymentTransaction,
      ],
      splits: syntheticHousehold.loanPaymentSplits,
      budgetLines: syntheticHousehold.budget,
    })

    expect(result.formulaVersion).toBe('financial-analysis-summary/v1')
    expect(result.value).toMatchObject({
      period: { ...june, label: 'June 2026' },
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
      },
    })
    expect(result.value.spendingByCategory).toEqual([
      {
        category: 'housing:rent',
        outflowMinor: 180_000n,
        refundMinor: 0n,
        netExpenseMinor: 180_000n,
        transactionCount: 1,
      },
      {
        category: 'food:groceries',
        outflowMinor: 62_000n,
        refundMinor: 7_000n,
        netExpenseMinor: 55_000n,
        transactionCount: 2,
      },
      {
        category: 'debt:interest',
        outflowMinor: 10_500n,
        refundMinor: 0n,
        netExpenseMinor: 10_500n,
        transactionCount: 2,
      },
      {
        category: 'debt:fees',
        outflowMinor: 1_000n,
        refundMinor: 0n,
        netExpenseMinor: 1_000n,
        transactionCount: 1,
      },
    ])
    expect(result.value.budgetBaseline.budgetVariance).toEqual([
      {
        category: 'housing:rent',
        plannedMinor: 180_000n,
        actualMinor: 180_000n,
        varianceMinor: 0n,
        remainingMinor: 0n,
      },
      {
        category: 'food:groceries',
        plannedMinor: 60_000n,
        actualMinor: 55_000n,
        varianceMinor: -5_000n,
        remainingMinor: 5_000n,
      },
      {
        category: 'debt:interest',
        plannedMinor: 5_000n,
        actualMinor: 10_500n,
        varianceMinor: 5_500n,
        remainingMinor: -5_500n,
      },
    ])
    expect(result.value.coverage).toMatchObject({
      accountsIncluded: 7,
      debtsIncluded: 3,
      transactionsAvailable: 11,
      transactionsIncluded: 10,
      splitsIncluded: 3,
    })
    expect(
      result.value.coverage.coverageNotes.map((note) => note.code),
    ).toEqual([
      'reviewed-transactions-only',
      'pending-transactions-excluded',
      'estimated-balances-present',
      'manual-balances-present',
      'investment-balances-included',
    ])
    expect(result.value.riskIndicators.map((risk) => risk.code)).toEqual([
      'high-interest-debt',
    ])
  })

  it('reports data quality and cash-flow risks', () => {
    const unreviewedExpense: Transaction = {
      id: 'unreviewed-expense',
      accountId: 'checking-1',
      postedDate: '2026-06-16',
      amountMinor: -600_000n,
      currency: 'USD',
      direction: 'outflow',
      economicType: 'expense',
      category: 'shopping:general',
      state: 'posted',
      reviewed: false,
    }
    const result = buildFinancialAnalysisSummary({
      period: june,
      accounts: syntheticHousehold.accounts,
      debts: syntheticHousehold.debts,
      transactions: [...syntheticHousehold.transactions, unreviewedExpense],
      reviewedTransactionsOnly: false,
      essentialCategoryPrefixes: ['housing'],
    })

    expect(result.value.cashFlow.freeCashFlowMinor).toBe(-338_500n)
    expect(
      result.value.coverage.coverageNotes.map((note) => note.code),
    ).toEqual([
      'pending-transactions-excluded',
      'estimated-balances-present',
      'manual-balances-present',
      'investment-balances-included',
      'budget-lines-missing',
    ])
    expect(result.value.riskIndicators.map((risk) => risk.code)).toEqual([
      'negative-free-cash-flow',
      'high-interest-debt',
      'unreviewed-data',
    ])
  })
})
