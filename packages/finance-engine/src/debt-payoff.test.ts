import { describe, expect, it } from 'vitest'

import { simulateDebtPayoff } from './debt-payoff.js'
import { syntheticHousehold } from './fixtures.js'

describe('debt payoff simulation', () => {
  it('pays all debts without negative ending balances', () => {
    const result = simulateDebtPayoff(syntheticHousehold.debts, {
      strategy: 'avalanche',
      extraPaymentMinor: 25_000n,
      startDate: '2026-07-01',
    })

    expect(result.months).toBeGreaterThan(0)
    expect(result.schedule.at(-1)?.endingBalanceMinor).toBe(0n)
    expect(
      result.schedule.every((month) => month.endingBalanceMinor >= 0n),
    ).toBe(true)
    expect(result.totalPaidMinor).toBe(
      syntheticHousehold.debts.reduce(
        (total, debt) => total + debt.balanceMinor,
        result.totalInterestMinor,
      ),
    )
  })

  it('uses extra payments to reduce payoff time and interest', () => {
    const minimum = simulateDebtPayoff(syntheticHousehold.debts, {
      strategy: 'minimum',
      startDate: '2026-07-01',
    })
    const avalanche = simulateDebtPayoff(syntheticHousehold.debts, {
      strategy: 'avalanche',
      extraPaymentMinor: 25_000n,
      startDate: '2026-07-01',
    })

    expect(avalanche.months).toBeLessThan(minimum.months)
    expect(avalanche.totalInterestMinor).toBeLessThan(
      minimum.totalInterestMinor,
    )
  })

  it('supports snowball ordering deterministically', () => {
    const result = simulateDebtPayoff(syntheticHousehold.debts, {
      strategy: 'snowball',
      extraPaymentMinor: 25_000n,
      startDate: '2026-07-01',
    })

    expect(result.strategy).toBe('snowball')
    expect(result.payoffDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(result.schedule.at(-1)?.endingBalanceMinor).toBe(0n)
  })

  it('clamps payoff dates to the last valid day of a month', () => {
    const result = simulateDebtPayoff(
      [
        {
          id: 'zero-interest',
          name: 'Zero-interest debt',
          kind: 'personal_loan',
          balanceMinor: 10_000n,
          aprBps: 0,
          minimumPaymentMinor: 10_000n,
          currency: 'USD',
        },
      ],
      {
        strategy: 'minimum',
        startDate: '2027-01-31',
      },
    )

    expect(result.payoffDate).toBe('2027-02-28')
  })

  it('returns an immediate payoff for zero-balance debt', () => {
    const result = simulateDebtPayoff(
      [
        {
          id: 'paid',
          name: 'Paid debt',
          kind: 'personal_loan',
          balanceMinor: 0n,
          aprBps: 1_000,
          minimumPaymentMinor: 0n,
          currency: 'USD',
        },
      ],
      {
        strategy: 'minimum',
        startDate: '2027-01-31',
      },
    )

    expect(result).toMatchObject({
      months: 0,
      payoffDate: '2027-01-31',
      totalInterestMinor: 0n,
      totalPaidMinor: 0n,
      schedule: [],
    })
  })
})
