import { describe, expect, it } from 'vitest'

import type { Account } from './domain.js'
import { syntheticHousehold } from './fixtures.js'
import {
  applyPrincipalPayment,
  assertTransactionSplits,
  calculateBalanceSheet,
  calculateBudgetVariance,
  calculateCashFlow,
  calculateCreditUtilization,
  calculateEmergencyFundCoverage,
  calculateLiquidCash,
  calculateNetWorth,
  calculateSavingsRate,
  calculateWeightedApr,
} from './metrics.js'

const june = { startDate: '2026-06-01', endDate: '2026-06-30' }

describe('balance-sheet metrics', () => {
  it('includes investments in net worth but excludes them from liquid cash', () => {
    const result = calculateBalanceSheet(syntheticHousehold.accounts)

    expect(result.value).toEqual({
      currency: 'USD',
      totalAssetsMinor: 5_950_000n,
      totalLiabilitiesMinor: 1_940_000n,
      netWorthMinor: 4_010_000n,
      liquidCashMinor: 1_250_000n,
    })
    expect(calculateNetWorth(syntheticHousehold.accounts)).toMatchObject({
      formulaVersion: 'net-worth/v1',
      value: 4_010_000n,
    })
    expect(calculateLiquidCash(syntheticHousehold.accounts)).toMatchObject({
      formulaVersion: 'liquid-cash/v1',
      value: 1_250_000n,
    })
  })

  it('calculates credit utilization only from known credit limits', () => {
    expect(
      calculateCreditUtilization(syntheticHousehold.accounts).value,
    ).toEqual({
      currency: 'USD',
      balanceMinor: 210_000n,
      balanceWithKnownLimitMinor: 210_000n,
      knownLimitMinor: 1_000_000n,
      utilizationBps: 2_100,
      accountsWithoutLimit: 0,
    })
  })

  it('excludes cards with unknown limits from the utilization ratio', () => {
    const cardWithoutLimit: Account = {
      id: 'credit-card-without-limit',
      name: 'Card without imported limit',
      kind: 'credit_card',
      balanceMinor: 90_000n,
      currency: 'USD',
      balanceAsOf: '2026-06-30',
      balanceSource: 'connected',
      dataQuality: 'estimated',
    }
    const result = calculateCreditUtilization([
      ...syntheticHousehold.accounts,
      cardWithoutLimit,
    ])

    expect(result.value).toMatchObject({
      balanceMinor: 300_000n,
      balanceWithKnownLimitMinor: 210_000n,
      knownLimitMinor: 1_000_000n,
      utilizationBps: 2_100,
      accountsWithoutLimit: 1,
    })
  })
})

describe('cash-flow metrics', () => {
  it('excludes transfers, debt payments, and pending expenses', () => {
    const result = calculateCashFlow(syntheticHousehold.transactions, june)

    expect(result.value).toEqual({
      currency: 'USD',
      incomeMinor: 500_000n,
      expenseOutflowsMinor: 245_500n,
      refundsMinor: 7_000n,
      netExpensesMinor: 238_500n,
      freeCashFlowMinor: 261_500n,
      savingsRateBps: 5_230,
    })
    expect(calculateSavingsRate(261_500n, 500_000n)).toEqual({
      formulaVersion: 'savings-rate/v1',
      value: 5_230,
    })
  })

  it('counts only interest and fees from a split loan payment as expense', () => {
    const transactions = [
      ...syntheticHousehold.transactions,
      syntheticHousehold.loanPaymentTransaction,
    ]
    const result = calculateCashFlow(
      transactions,
      june,
      syntheticHousehold.loanPaymentSplits,
    )

    expect(result.value.expenseOutflowsMinor).toBe(253_500n)
    expect(result.value.netExpensesMinor).toBe(246_500n)
  })

  it('calculates category budget variance net of refunds', () => {
    const result = calculateBudgetVariance(
      syntheticHousehold.budget,
      syntheticHousehold.transactions,
      june,
    )

    expect(result.value).toEqual([
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
        actualMinor: 3_500n,
        varianceMinor: -1_500n,
        remainingMinor: 1_500n,
      },
    ])
  })
})

describe('debt and resilience metrics', () => {
  it('validates transaction splits exactly', () => {
    expect(() =>
      assertTransactionSplits(
        syntheticHousehold.loanPaymentTransaction,
        syntheticHousehold.loanPaymentSplits,
      ),
    ).not.toThrow()
  })

  it('keeps net worth unchanged when principal is paid', () => {
    const result = applyPrincipalPayment(300_000n, 200_000n, 50_000n)

    expect(result).toEqual({
      cashBalanceMinor: 250_000n,
      debtBalanceMinor: 150_000n,
      netWorthBeforeMinor: 100_000n,
      netWorthAfterMinor: 100_000n,
    })
  })

  it('calculates weighted APR and emergency coverage', () => {
    expect(calculateWeightedApr(syntheticHousehold.debts).value).toBe(974)
    expect(calculateEmergencyFundCoverage(1_250_000n, 250_000n).value).toBe(500)
  })
})
