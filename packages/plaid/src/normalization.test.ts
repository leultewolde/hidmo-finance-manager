import { describe, expect, it } from 'vitest'

import { normalizePlaidAccount } from './normalization.js'

describe('Plaid account normalization', () => {
  it.each([
    ['depository', 'checking', 'checking', 'asset'],
    ['credit', 'credit card', 'credit_card', 'liability'],
    ['loan', 'auto', 'auto_loan', 'liability'],
    ['investment', '401k', 'retirement', 'asset'],
    ['investment', 'brokerage', 'brokerage', 'asset'],
  ])('maps %s/%s to %s', (type, subtype, expectedKind, expectedClass) => {
    expect(
      normalizePlaidAccount(
        {
          providerAccountId: 'provider-id',
          name: 'Account',
          type,
          subtype,
          currentBalance: 123.45,
          currency: 'USD',
        },
        new Date('2026-06-25T00:00:00Z'),
      ),
    ).toMatchObject({
      kind: expectedKind,
      accountClass: expectedClass,
      currentBalanceMinor: 12_345n,
      balanceAsOf: '2026-06-25',
    })
  })

  it('rejects unsupported account types and currencies', () => {
    expect(() =>
      normalizePlaidAccount({
        providerAccountId: 'provider-id',
        name: 'Account',
        type: 'other',
        currentBalance: 1,
        currency: 'USD',
      }),
    ).toThrow()

    expect(() =>
      normalizePlaidAccount({
        providerAccountId: 'provider-id',
        name: 'Account',
        type: 'depository',
        currentBalance: 1,
        currency: 'GBP',
      }),
    ).toThrow()
  })
})
