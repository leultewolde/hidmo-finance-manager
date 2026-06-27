import { createHash } from 'node:crypto'

import type { CurrencyCode } from '@hidmo/finance-engine'

import type { PlaidTransaction } from './adapter.js'

export interface NormalizedPlaidTransaction {
  providerTransactionId: string
  providerAccountId: string
  pendingProviderTransactionId?: string
  authorizedDate?: string
  postedDate: string
  rawProviderAmountMinor: bigint
  normalizedAmountMinor: bigint
  currency: CurrencyCode
  merchantName?: string
  originalDescription: string
  state: 'pending' | 'posted'
  providerCategory?: string
  providerCategoryConfidenceBps?: number
  economicType: 'income' | 'expense' | 'refund' | 'unknown'
  appCategory: string
  deduplicationFingerprint: string
}

function toSignedMinorUnits(value: number): bigint {
  if (!Number.isFinite(value)) {
    throw new Error('Plaid transaction amount must be finite')
  }
  return BigInt(Math.round(value * 100))
}

function confidenceToBps(confidence?: string) {
  if (confidence === 'VERY_HIGH') return 9_500
  if (confidence === 'HIGH') return 8_000
  if (confidence === 'MEDIUM') return 6_000
  if (confidence === 'LOW') return 3_000
  return undefined
}

export function normalizePlaidTransaction(
  transaction: PlaidTransaction,
  connectionId: string,
): NormalizedPlaidTransaction {
  if (transaction.currency !== 'USD' && transaction.currency !== 'EUR') {
    throw new Error(`Unsupported transaction currency: ${transaction.currency}`)
  }

  const rawProviderAmountMinor = toSignedMinorUnits(transaction.amount)
  const normalizedAmountMinor = -rawProviderAmountMinor
  const economicType =
    normalizedAmountMinor > 0n
      ? 'income'
      : normalizedAmountMinor < 0n
        ? 'expense'
        : 'unknown'
  const providerCategoryConfidenceBps = confidenceToBps(
    transaction.categoryConfidence,
  )

  return {
    providerTransactionId: transaction.providerTransactionId,
    providerAccountId: transaction.providerAccountId,
    ...(transaction.pendingProviderTransactionId === undefined
      ? {}
      : {
          pendingProviderTransactionId:
            transaction.pendingProviderTransactionId,
        }),
    ...(transaction.authorizedDate === undefined
      ? {}
      : { authorizedDate: transaction.authorizedDate }),
    postedDate: transaction.postedDate,
    rawProviderAmountMinor,
    normalizedAmountMinor,
    currency: transaction.currency,
    ...(transaction.merchantName === undefined
      ? {}
      : { merchantName: transaction.merchantName }),
    originalDescription: transaction.description,
    state: transaction.pending ? 'pending' : 'posted',
    ...(transaction.category === undefined
      ? {}
      : { providerCategory: transaction.category }),
    ...(providerCategoryConfidenceBps === undefined
      ? {}
      : { providerCategoryConfidenceBps }),
    economicType,
    appCategory: transaction.category ?? 'Uncategorized',
    deduplicationFingerprint: createHash('sha256')
      .update(
        `plaid:${connectionId}:${transaction.providerTransactionId}`,
        'utf8',
      )
      .digest('hex'),
  }
}
