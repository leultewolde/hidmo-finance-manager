import { randomBytes } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import {
  encryptAccessToken,
  type PlaidProvider,
  type TokenEnvelope,
} from '@hidmo/plaid'

import { revokePlaidConnectionForDeletion } from './plaid-revocation.js'

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

function createRepositories(tokenEnvelope: TokenEnvelope | undefined) {
  return {
    connections: {
      getTokenEnvelopeForUser: vi.fn().mockResolvedValue(
        tokenEnvelope === undefined
          ? undefined
          : {
              id: 'connection-id',
              ...tokenEnvelope,
            },
      ),
      revokeForUser: vi.fn().mockResolvedValue(undefined),
    },
  }
}

describe('Plaid deletion revocation', () => {
  it('removes the Plaid Item before destroying the local token envelope', async () => {
    const wrappingKey = randomBytes(32)
    const tokenEnvelope = encryptAccessToken('access-token-secret', wrappingKey)
    const provider = createProvider()
    const repositories = createRepositories(tokenEnvelope)

    await expect(
      revokePlaidConnectionForDeletion({
        userId: 'owner-id',
        connectionId: 'connection-id',
        provider,
        repositories,
        wrappingKey,
      }),
    ).resolves.toEqual({
      connectionId: 'connection-id',
      plaidItemRevoked: true,
      localTokenDestroyed: true,
    })

    expect(provider.removeItem).toHaveBeenCalledWith('access-token-secret')
    expect(repositories.connections.revokeForUser).toHaveBeenCalledWith(
      'owner-id',
      'connection-id',
    )
  })

  it('destroys the local token envelope even when Plaid revocation fails', async () => {
    const wrappingKey = randomBytes(32)
    const tokenEnvelope = encryptAccessToken('access-token-secret', wrappingKey)
    const provider = createProvider(
      vi.fn().mockRejectedValue({
        response: { data: { error_code: 'INVALID_ACCESS_TOKEN' } },
      }),
    )
    const repositories = createRepositories(tokenEnvelope)

    await expect(
      revokePlaidConnectionForDeletion({
        userId: 'owner-id',
        connectionId: 'connection-id',
        provider,
        repositories,
        wrappingKey,
      }),
    ).resolves.toEqual({
      connectionId: 'connection-id',
      plaidItemRevoked: false,
      localTokenDestroyed: true,
      plaidErrorCode: 'INVALID_ACCESS_TOKEN',
    })

    expect(repositories.connections.revokeForUser).toHaveBeenCalledWith(
      'owner-id',
      'connection-id',
    )
  })

  it('destroys the local token envelope when token decryption fails', async () => {
    const tokenEnvelope = encryptAccessToken(
      'access-token-secret',
      randomBytes(32),
    )
    const provider = createProvider()
    const repositories = createRepositories(tokenEnvelope)

    await expect(
      revokePlaidConnectionForDeletion({
        userId: 'owner-id',
        connectionId: 'connection-id',
        provider,
        repositories,
        wrappingKey: randomBytes(32),
      }),
    ).resolves.toEqual({
      connectionId: 'connection-id',
      plaidItemRevoked: false,
      localTokenDestroyed: true,
      tokenErrorCode: 'TOKEN_DECRYPTION_FAILED',
    })

    expect(provider.removeItem).not.toHaveBeenCalled()
    expect(repositories.connections.revokeForUser).toHaveBeenCalledWith(
      'owner-id',
      'connection-id',
    )
  })

  it('destroys incomplete local token envelopes without calling Plaid', async () => {
    const provider = createProvider()
    const repositories = {
      connections: {
        getTokenEnvelopeForUser: vi.fn().mockResolvedValue({
          id: 'connection-id',
          encryptedAccessToken: null,
          wrappedDataKey: null,
          encryptionNonce: null,
          encryptionTag: null,
          encryptionAlgorithm: null,
          kmsKeyName: null,
        }),
        revokeForUser: vi.fn().mockResolvedValue(undefined),
      },
    }

    await expect(
      revokePlaidConnectionForDeletion({
        userId: 'owner-id',
        connectionId: 'connection-id',
        provider,
        repositories,
        wrappingKey: randomBytes(32),
      }),
    ).resolves.toEqual({
      connectionId: 'connection-id',
      plaidItemRevoked: false,
      localTokenDestroyed: true,
      tokenErrorCode: 'TOKEN_ENVELOPE_MISSING',
    })

    expect(provider.removeItem).not.toHaveBeenCalled()
    expect(repositories.connections.revokeForUser).toHaveBeenCalledWith(
      'owner-id',
      'connection-id',
    )
  })

  it('treats a missing connection as already locally destroyed', async () => {
    const provider = createProvider()
    const repositories = createRepositories(undefined)

    await expect(
      revokePlaidConnectionForDeletion({
        userId: 'owner-id',
        connectionId: 'connection-id',
        provider,
        repositories,
        wrappingKey: randomBytes(32),
      }),
    ).resolves.toEqual({
      connectionId: 'connection-id',
      plaidItemRevoked: false,
      localTokenDestroyed: true,
      tokenErrorCode: 'CONNECTION_NOT_FOUND',
    })

    expect(provider.removeItem).not.toHaveBeenCalled()
    expect(repositories.connections.revokeForUser).not.toHaveBeenCalled()
  })
})
