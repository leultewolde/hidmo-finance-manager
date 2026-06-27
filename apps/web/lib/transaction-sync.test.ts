import { randomBytes } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import {
  encryptAccessToken,
  type PlaidProvider,
  type PlaidTransactionSyncPage,
} from '@hidmo/plaid'

import {
  SyncAlreadyRunningError,
  synchronizePlaidConnection,
} from './transaction-sync'

const transaction = {
  providerTransactionId: 'provider-transaction-id',
  providerAccountId: 'provider-account-id',
  amount: 12.34,
  currency: 'USD',
  postedDate: '2026-06-26',
  description: 'Sandbox merchant',
  pending: false,
}

function page(
  nextCursor: string,
  hasMore: boolean,
  added = [transaction],
): PlaidTransactionSyncPage {
  return {
    added,
    modified: [],
    removedProviderTransactionIds: [],
    nextCursor,
    hasMore,
  }
}

function setup(syncTransactions: PlaidProvider['syncTransactions']) {
  const wrappingKey = randomBytes(32)
  const tokenEnvelope = encryptAccessToken('sandbox-access-token', wrappingKey)
  const applyPlaidSync = vi.fn().mockResolvedValue({
    added: 1,
    modified: 0,
    removed: 0,
  })
  const repositories = {
    connections: {
      getTokenEnvelopeForUser: vi.fn().mockResolvedValue({
        id: 'connection-id',
        transactionCursor: null,
        ...tokenEnvelope,
      }),
      recordSyncError: vi.fn(),
    },
    transactions: { applyPlaidSync },
    taskExecutions: {
      claim: vi.fn().mockResolvedValue(true),
      complete: vi.fn(),
      fail: vi.fn(),
    },
  }
  const provider: PlaidProvider = {
    createLinkToken: vi.fn(),
    exchangePublicToken: vi.fn(),
    getItem: vi.fn(),
    getAccounts: vi.fn(),
    syncTransactions,
    removeItem: vi.fn(),
  }

  return { applyPlaidSync, provider, repositories, wrappingKey }
}

describe('incremental transaction synchronization', () => {
  it('collects every page and advances the cursor only during persistence', async () => {
    const syncTransactions = vi
      .fn()
      .mockResolvedValueOnce(page('page-2', true))
      .mockResolvedValueOnce(page('final-cursor', false, []))
    const test = setup(syncTransactions)

    await expect(
      synchronizePlaidConnection({
        userId: 'owner-id',
        connectionId: 'connection-id',
        ...test,
        sleep: vi.fn(),
      }),
    ).resolves.toMatchObject({ added: 1, providerAttempts: 2 })

    expect(syncTransactions).toHaveBeenNthCalledWith(
      1,
      'sandbox-access-token',
      undefined,
    )
    expect(syncTransactions).toHaveBeenNthCalledWith(
      2,
      'sandbox-access-token',
      'page-2',
    )
    expect(test.applyPlaidSync).toHaveBeenCalledWith(
      expect.objectContaining({
        startingCursor: null,
        finalCursor: 'final-cursor',
      }),
    )
  })

  it('restarts pagination from the original cursor after mutation', async () => {
    const mutationError = {
      response: {
        data: {
          error_code: 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION',
        },
      },
    }
    const syncTransactions = vi
      .fn()
      .mockResolvedValueOnce(page('page-2', true))
      .mockRejectedValueOnce(mutationError)
      .mockResolvedValueOnce(page('final-cursor', false))
    const test = setup(syncTransactions)

    await synchronizePlaidConnection({
      userId: 'owner-id',
      connectionId: 'connection-id',
      ...test,
      sleep: vi.fn(),
    })

    expect(syncTransactions.mock.calls.map((call) => call[1])).toEqual([
      undefined,
      'page-2',
      undefined,
    ])
    expect(test.applyPlaidSync).toHaveBeenCalledTimes(1)
  })

  it('does not persist a cursor when pagination fails', async () => {
    const syncTransactions = vi.fn().mockRejectedValue(new Error('offline'))
    const test = setup(syncTransactions)

    await expect(
      synchronizePlaidConnection({
        userId: 'owner-id',
        connectionId: 'connection-id',
        ...test,
        sleep: vi.fn(),
      }),
    ).rejects.toThrow('offline')

    expect(test.applyPlaidSync).not.toHaveBeenCalled()
    expect(test.repositories.taskExecutions.fail).toHaveBeenCalled()
  })

  it('retries transient provider failures with bounded backoff', async () => {
    const rateLimitError = {
      response: { data: { error_code: 'RATE_LIMIT_EXCEEDED' } },
    }
    const syncTransactions = vi
      .fn()
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce(page('final-cursor', false))
    const test = setup(syncTransactions)
    const sleep = vi.fn()

    await expect(
      synchronizePlaidConnection({
        userId: 'owner-id',
        connectionId: 'connection-id',
        ...test,
        sleep,
      }),
    ).resolves.toMatchObject({ providerAttempts: 2 })
    expect(sleep).toHaveBeenCalledWith(100)
  })

  it('rejects overlapping local sync attempts for one connection', async () => {
    let finishPage: ((value: PlaidTransactionSyncPage) => void) | undefined
    const syncTransactions = vi.fn(
      () =>
        new Promise<PlaidTransactionSyncPage>((resolve) => {
          finishPage = resolve
        }),
    )
    const test = setup(syncTransactions)
    const first = synchronizePlaidConnection({
      userId: 'owner-id',
      connectionId: 'connection-id',
      ...test,
      sleep: vi.fn(),
    })

    await vi.waitFor(() => expect(syncTransactions).toHaveBeenCalled())
    await expect(
      synchronizePlaidConnection({
        userId: 'owner-id',
        connectionId: 'connection-id',
        ...test,
        sleep: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(SyncAlreadyRunningError)

    finishPage?.(page('final-cursor', false))
    await first
  })
})
