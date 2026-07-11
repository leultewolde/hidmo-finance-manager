import { randomBytes } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import { encryptAccessToken, type PlaidProvider } from '@hidmo/plaid'

import {
  DeletionRequestMismatchError,
  processConnectionDeletionTask,
} from './deletion-task.js'

function createProvider(removeItem = vi.fn().mockResolvedValue(undefined)) {
  return {
    createLinkToken: vi.fn(),
    exchangePublicToken: vi.fn(),
    getItem: vi.fn(),
    getAccounts: vi.fn(),
    syncTransactions: vi.fn(),
    removeItem,
  } satisfies PlaidProvider
}

function createRepositories(input: {
  request?: {
    id: string
    userId: string | null
    connectionId: string | null
    scope: 'user' | 'connection'
    status: 'queued' | 'running' | 'succeeded' | 'failed'
  }
  tokenEnvelope?: ReturnType<typeof encryptAccessToken>
}) {
  return {
    connections: {
      getTokenEnvelopeForUser: vi.fn().mockResolvedValue(
        input.tokenEnvelope === undefined
          ? undefined
          : {
              id: 'connection-id',
              ...input.tokenEnvelope,
            },
      ),
      revokeForUser: vi.fn().mockResolvedValue(undefined),
    },
    deletionRequests: {
      getByIdForUser: vi.fn().mockResolvedValue(input.request),
      markRunning: vi.fn().mockResolvedValue({
        ...input.request,
        status: 'running',
      }),
      markSucceeded: vi.fn().mockResolvedValue({
        ...input.request,
        status: 'succeeded',
      }),
      markFailed: vi.fn().mockResolvedValue({
        ...input.request,
        status: 'failed',
      }),
    },
  }
}

const request = {
  id: '00000000-0000-4000-8000-000000000003',
  userId: '00000000-0000-4000-8000-000000000001',
  connectionId: '00000000-0000-4000-8000-000000000002',
  scope: 'connection' as const,
  status: 'queued' as const,
}

describe('connection deletion task processing', () => {
  it('marks the deletion request succeeded after Plaid revocation and local cleanup', async () => {
    const wrappingKey = randomBytes(32)
    const repositories = createRepositories({
      request,
      tokenEnvelope: encryptAccessToken('access-token-secret', wrappingKey),
    })
    const provider = createProvider()

    await expect(
      processConnectionDeletionTask({
        userId: request.userId,
        connectionId: request.connectionId,
        deletionRequestId: request.id,
        provider,
        repositories,
        wrappingKey,
      }),
    ).resolves.toEqual({
      status: 'completed',
      connectionId: request.connectionId,
      plaidItemRevoked: true,
      localTokenDestroyed: true,
    })

    expect(provider.removeItem).toHaveBeenCalledWith('access-token-secret')
    expect(repositories.deletionRequests.markRunning).toHaveBeenCalledWith(
      request.id,
    )
    expect(repositories.deletionRequests.markSucceeded).toHaveBeenCalledWith(
      request.id,
      expect.objectContaining({
        scope: 'connection',
        connectionId: request.connectionId,
        plaidItemRevoked: true,
        localTokenDestroyed: true,
      }),
    )
  })

  it('treats an already-succeeded deletion request as idempotent completion', async () => {
    const repositories = createRepositories({
      request: { ...request, status: 'succeeded' },
    })

    await expect(
      processConnectionDeletionTask({
        userId: request.userId,
        connectionId: request.connectionId,
        deletionRequestId: request.id,
        provider: createProvider(),
        repositories,
        wrappingKey: randomBytes(32),
      }),
    ).resolves.toEqual({
      status: 'already_completed',
      connectionId: request.connectionId,
      plaidItemRevoked: false,
      localTokenDestroyed: true,
    })

    expect(repositories.deletionRequests.markRunning).not.toHaveBeenCalled()
    expect(repositories.connections.revokeForUser).not.toHaveBeenCalled()
  })

  it('rejects task payloads that do not match the deletion request target', async () => {
    const repositories = createRepositories({
      request: {
        ...request,
        connectionId: '00000000-0000-4000-8000-000000009999',
      },
    })

    await expect(
      processConnectionDeletionTask({
        userId: request.userId,
        connectionId: request.connectionId,
        deletionRequestId: request.id,
        provider: createProvider(),
        repositories,
        wrappingKey: randomBytes(32),
      }),
    ).rejects.toBeInstanceOf(DeletionRequestMismatchError)

    expect(repositories.deletionRequests.markRunning).not.toHaveBeenCalled()
  })

  it('marks the deletion request failed when local cleanup fails', async () => {
    const wrappingKey = randomBytes(32)
    const repositories = createRepositories({
      request,
      tokenEnvelope: encryptAccessToken('access-token-secret', wrappingKey),
    })
    repositories.connections.revokeForUser.mockRejectedValue(
      new Error('database unavailable'),
    )

    await expect(
      processConnectionDeletionTask({
        userId: request.userId,
        connectionId: request.connectionId,
        deletionRequestId: request.id,
        provider: createProvider(),
        repositories,
        wrappingKey,
      }),
    ).rejects.toThrow('database unavailable')

    expect(repositories.deletionRequests.markFailed).toHaveBeenCalledWith(
      request.id,
      'Error',
      expect.objectContaining({
        scope: 'connection',
        connectionId: request.connectionId,
      }),
    )
  })
})
