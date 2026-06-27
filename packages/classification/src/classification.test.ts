import { describe, expect, it } from 'vitest'

import { calculateCashFlow, type Transaction } from '@hidmo/finance-engine'

import { classifyTransaction } from './precedence.js'
import { findTransferCandidates } from './transfer-matching.js'

describe('classification precedence', () => {
  const input = {
    accountId: 'account',
    amountMinor: -1_000n,
    merchantName: 'Example Store',
    providerCategory: 'GENERAL_MERCHANDISE',
    existingEconomicType: 'expense' as const,
    existingCategory: 'User category',
    userReviewed: false,
  }

  it('preserves reviewed user decisions over every suggestion', () => {
    expect(
      classifyTransaction({ ...input, userReviewed: true }, [
        {
          id: 'rule',
          priority: 1,
          merchantContains: 'example',
          economicType: 'expense',
          category: 'Rule category',
        },
      ]),
    ).toMatchObject({ source: 'user', category: 'User category' })
  })

  it('applies rules before provider categories', () => {
    expect(
      classifyTransaction(input, [
        {
          id: 'rule',
          priority: 1,
          merchantContains: 'example',
          economicType: 'expense',
          category: 'Household',
        },
      ]),
    ).toMatchObject({ source: 'rule', category: 'Household' })
  })
})

describe('transfer matching', () => {
  it('matches card payments and makes ambiguous matches reviewable', () => {
    expect(
      findTransferCandidates([
        {
          id: 'checking-out',
          accountId: 'checking',
          accountClass: 'asset',
          postedDate: '2026-06-10',
          amountMinor: -5_000n,
          description: 'Credit card payment',
          category: 'TRANSFER_OUT',
          removed: false,
        },
        {
          id: 'card-in',
          accountId: 'card',
          accountClass: 'liability',
          postedDate: '2026-06-11',
          amountMinor: 5_000n,
          description: 'Online payment',
          category: 'TRANSFER_IN',
          removed: false,
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        method: 'credit_card_payment',
        autoAccept: true,
      }),
    ])
  })

  it('keeps transfers and card payments out of income and expense totals', () => {
    const transactions: Transaction[] = [
      {
        id: 'transfer-out',
        accountId: 'checking',
        postedDate: '2026-06-10',
        amountMinor: -5_000n,
        currency: 'USD',
        direction: 'outflow',
        economicType: 'transfer',
        category: 'Transfer',
        state: 'posted',
        reviewed: true,
      },
      {
        id: 'transfer-in',
        accountId: 'savings',
        postedDate: '2026-06-10',
        amountMinor: 5_000n,
        currency: 'USD',
        direction: 'inflow',
        economicType: 'transfer',
        category: 'Transfer',
        state: 'posted',
        reviewed: true,
      },
      {
        id: 'card-payment',
        accountId: 'checking',
        postedDate: '2026-06-11',
        amountMinor: -2_000n,
        currency: 'USD',
        direction: 'outflow',
        economicType: 'debt_payment',
        category: 'Credit card payment',
        state: 'posted',
        reviewed: true,
      },
    ]

    expect(
      calculateCashFlow(transactions, {
        startDate: '2026-06-01',
        endDate: '2026-06-30',
      }).value,
    ).toMatchObject({
      incomeMinor: 0n,
      expenseOutflowsMinor: 0n,
      freeCashFlowMinor: 0n,
    })
  })
})
