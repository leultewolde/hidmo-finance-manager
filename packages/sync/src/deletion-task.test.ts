import { randomBytes } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import { encryptAccessToken, type PlaidProvider } from '@hidmo/plaid'

import {
  DeletionRequestMismatchError,
  processConnectionDeletionTask,
  processUserDeletionTask,
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
    users: {
      deleteById: vi.fn().mockResolvedValue(true),
    },
    connections: {
      listDeletionTargetsForUser: vi
        .fn()
        .mockResolvedValue([{ id: '00000000-0000-4000-8000-000000000002' }]),
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
      getById: vi.fn().mockResolvedValue(input.request),
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

const userRequest = {
  id: '00000000-0000-4000-8000-000000000004',
  userId: '00000000-0000-4000-8000-000000000001',
  connectionId: null,
  scope: 'user' as const,
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

describe('user deletion task processing', () => {
  it('revokes all user connections before deleting the user', async () => {
    const wrappingKey = randomBytes(32)
    const repositories = createRepositories({
      request: userRequest,
      tokenEnvelope: encryptAccessToken('access-token-secret', wrappingKey),
    })
    repositories.connections.listDeletionTargetsForUser.mockResolvedValue([
      { id: '00000000-0000-4000-8000-000000000002' },
      { id: '00000000-0000-4000-8000-000000000005' },
    ])
    const provider = createProvider()

    await expect(
      processUserDeletionTask({
        userId: userRequest.userId,
        deletionRequestId: userRequest.id,
        provider,
        repositories,
        wrappingKey,
      }),
    ).resolves.toEqual({
      status: 'completed',
      revokedConnectionCount: 2,
      localTokenDestroyedCount: 2,
      failedConnectionCount: 0,
      userDeleted: true,
    })

    expect(provider.removeItem).toHaveBeenCalledTimes(2)
    expect(repositories.connections.revokeForUser).toHaveBeenCalledWith(
      userRequest.userId,
      '00000000-0000-4000-8000-000000000002',
    )
    expect(repositories.connections.revokeForUser).toHaveBeenCalledWith(
      userRequest.userId,
      '00000000-0000-4000-8000-000000000005',
    )
    expect(repositories.users.deleteById).toHaveBeenCalledWith(
      userRequest.userId,
    )
    expect(repositories.deletionRequests.markSucceeded).toHaveBeenCalledWith(
      userRequest.id,
      expect.objectContaining({
        scope: 'user',
        revokedConnectionCount: 2,
        localTokenDestroyedCount: 2,
        failedConnectionCount: 0,
        userDeleted: true,
      }),
    )
  })

  it('treats an already-succeeded user deletion request as idempotent completion', async () => {
    const repositories = createRepositories({
      request: { ...userRequest, userId: null, status: 'succeeded' },
    })

    await expect(
      processUserDeletionTask({
        userId: userRequest.userId,
        deletionRequestId: userRequest.id,
        provider: createProvider(),
        repositories,
        wrappingKey: randomBytes(32),
      }),
    ).resolves.toEqual({
      status: 'already_completed',
      revokedConnectionCount: 0,
      localTokenDestroyedCount: 0,
      failedConnectionCount: 0,
      userDeleted: true,
    })

    expect(repositories.deletionRequests.markRunning).not.toHaveBeenCalled()
    expect(repositories.users.deleteById).not.toHaveBeenCalled()
  })

  it('rejects user deletion task payloads for connection deletion requests', async () => {
    const repositories = createRepositories({ request })

    await expect(
      processUserDeletionTask({
        userId: request.userId,
        deletionRequestId: request.id,
        provider: createProvider(),
        repositories,
        wrappingKey: randomBytes(32),
      }),
    ).rejects.toBeInstanceOf(DeletionRequestMismatchError)

    expect(repositories.deletionRequests.markRunning).not.toHaveBeenCalled()
  })

  it('marks the user deletion request failed when local cleanup fails', async () => {
    const wrappingKey = randomBytes(32)
    const repositories = createRepositories({
      request: userRequest,
      tokenEnvelope: encryptAccessToken('access-token-secret', wrappingKey),
    })
    repositories.connections.revokeForUser.mockRejectedValue(
      new Error('database unavailable'),
    )

    await expect(
      processUserDeletionTask({
        userId: userRequest.userId,
        deletionRequestId: userRequest.id,
        provider: createProvider(),
        repositories,
        wrappingKey,
      }),
    ).rejects.toThrow('database unavailable')

    expect(repositories.deletionRequests.markFailed).toHaveBeenCalledWith(
      userRequest.id,
      'Error',
      expect.objectContaining({
        scope: 'user',
        userDeleted: false,
      }),
    )
    expect(repositories.users.deleteById).not.toHaveBeenCalled()
  })
})
