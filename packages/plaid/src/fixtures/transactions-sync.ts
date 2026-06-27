import type { PlaidTransactionSyncPage } from '../adapter.js'

export const sanitizedTransactionsSyncPages = [
  {
    added: [
      {
        providerTransactionId: 'sandbox-transaction-added',
        providerAccountId: 'sandbox-account-checking',
        amount: 12.34,
        currency: 'USD',
        authorizedDate: '2026-06-25',
        postedDate: '2026-06-26',
        merchantName: 'Sandbox Merchant',
        description: 'SANITIZED PURCHASE',
        pending: false,
        category: 'FOOD_AND_DRINK',
        categoryConfidence: 'HIGH',
      },
    ],
    modified: [],
    removedProviderTransactionIds: [],
    nextCursor: 'sanitized-cursor-page-2',
    hasMore: true,
  },
  {
    added: [],
    modified: [
      {
        providerTransactionId: 'sandbox-transaction-posted',
        providerAccountId: 'sandbox-account-checking',
        pendingProviderTransactionId: 'sandbox-transaction-pending',
        amount: 45.67,
        currency: 'USD',
        postedDate: '2026-06-26',
        merchantName: 'Sandbox Merchant',
        description: 'SANITIZED POSTED PURCHASE',
        pending: false,
      },
    ],
    removedProviderTransactionIds: ['sandbox-transaction-removed'],
    nextCursor: 'sanitized-cursor-final',
    hasMore: false,
  },
] satisfies PlaidTransactionSyncPage[]
