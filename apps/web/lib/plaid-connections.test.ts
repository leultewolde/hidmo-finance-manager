import { randomBytes } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import { decryptAccessToken, type PlaidProvider } from '@hidmo/plaid'

import { connectPlaidItem } from './plaid-connections'

function createProvider(): PlaidProvider {
  return {
    createLinkToken: vi.fn(),
    exchangePublicToken: vi.fn().mockResolvedValue({
      accessToken: 'access-token-secret',
      plaidItemId: 'provider-item-id',
    }),
    getItem: vi.fn().mockResolvedValue({
      plaidItemId: 'provider-item-id',
      institutionId: 'provider-institution-id',
      institutionName: 'Sandbox Bank',
    }),
    getAccounts: vi.fn().mockResolvedValue([
      {
        providerAccountId: 'provider-account-id',
        name: 'Checking',
        mask: '1234',
        type: 'depository',
        subtype: 'checking',
        currentBalance: 123.45,
        currency: 'USD',
      },
    ]),
    syncTransactions: vi.fn(),
    removeItem: vi.fn().mockResolvedValue(undefined),
  }
}

describe('Plaid connection orchestration', () => {
  it('encrypts tokens and persists normalized accounts', async () => {
    const provider = createProvider()
    const wrappingKey = randomBytes(32)
    const createPlaidConnection = vi.fn().mockImplementation((input) => {
      expect(input.tokenEnvelope.encryptedAccessToken).not.toContain(
        'access-token-secret',
      )
      expect(decryptAccessToken(input.tokenEnvelope, wrappingKey)).toBe(
        'access-token-secret',
      )
      expect(input.accounts[0]).toMatchObject({
        name: 'Checking',
        kind: 'checking',
        currentBalanceMinor: 12_345n,
      })
      return 'internal-connection-id'
    })

    await expect(
      connectPlaidItem({
        userId: 'internal-owner-id',
        publicToken: 'temporary-public-token',
        provider,
        wrappingKey,
        persistence: {
          createPlaidConnection,
          getTokenEnvelopeForUser: vi.fn(),
          revokeForUser: vi.fn(),
        },
      }),
    ).resolves.toEqual({
      connectionId: 'internal-connection-id',
      accountCount: 1,
    })
  })

  it('removes the Plaid Item when local persistence fails', async () => {
    const provider = createProvider()

    await expect(
      connectPlaidItem({
        userId: 'internal-owner-id',
        publicToken: 'temporary-public-token',
        provider,
        wrappingKey: randomBytes(32),
        persistence: {
          createPlaidConnection: vi
            .fn()
            .mockRejectedValue(new Error('duplicate item')),
          getTokenEnvelopeForUser: vi.fn(),
          revokeForUser: vi.fn(),
        },
      }),
    ).rejects.toThrow('duplicate item')

    expect(provider.removeItem).toHaveBeenCalledWith('access-token-secret')
  })
})
