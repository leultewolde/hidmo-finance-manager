import { describe, expect, it } from 'vitest'

import { normalizePlaidTransaction } from './transaction-normalization.js'

const baseTransaction = {
  providerTransactionId: 'transaction-id',
  providerAccountId: 'account-id',
  amount: 12.34,
  currency: 'USD',
  postedDate: '2026-06-26',
  description: 'Coffee shop',
  pending: false,
}

describe('Plaid transaction normalization', () => {
  it('converts Plaid spending to a single internal outflow sign', () => {
    expect(
      normalizePlaidTransaction(baseTransaction, 'connection-id'),
    ).toMatchObject({
      rawProviderAmountMinor: 1_234n,
      normalizedAmountMinor: -1_234n,
      economicType: 'expense',
      state: 'posted',
    })
  })

  it('converts negative Plaid amounts to internal inflows', () => {
    expect(
      normalizePlaidTransaction(
        { ...baseTransaction, amount: -100.01 },
        'connection-id',
      ),
    ).toMatchObject({
      rawProviderAmountMinor: -10_001n,
      normalizedAmountMinor: 10_001n,
      economicType: 'income',
    })
  })

  it('preserves pending replacement metadata and stable fingerprints', () => {
    const normalized = normalizePlaidTransaction(
      {
        ...baseTransaction,
        pending: false,
        pendingProviderTransactionId: 'pending-id',
      },
      'connection-id',
    )

    expect(normalized.pendingProviderTransactionId).toBe('pending-id')
    expect(normalized.deduplicationFingerprint).toHaveLength(64)
    expect(
      normalizePlaidTransaction(baseTransaction, 'connection-id')
        .deduplicationFingerprint,
    ).toBe(
      normalizePlaidTransaction(baseTransaction, 'connection-id')
        .deduplicationFingerprint,
    )
  })
})
