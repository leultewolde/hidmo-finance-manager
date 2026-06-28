import { describe, expect, it, vi } from 'vitest'

import { createPlaidProvider } from './adapter.js'

function setupProvider(webhookUrl?: string) {
  const client = {
    linkTokenCreate: vi.fn().mockResolvedValue({
      data: { link_token: 'link-sandbox-token' },
    }),
    itemPublicTokenExchange: vi.fn(),
    itemGet: vi.fn(),
    accountsGet: vi.fn(),
    transactionsSync: vi.fn(),
    itemRemove: vi.fn(),
  }

  const configuration = {
    clientId: 'client-id',
    secret: 'sandbox-secret',
    environment: 'sandbox' as const,
    client,
    ...(webhookUrl === undefined ? {} : { webhookUrl }),
  }

  return {
    client,
    provider: createPlaidProvider(configuration),
  }
}

describe('Plaid provider', () => {
  it('includes the configured webhook URL when creating Link tokens', async () => {
    const { client, provider } = setupProvider(
      'https://finance-web.example.com/api/plaid/webhook',
    )

    await expect(provider.createLinkToken('owner-id')).resolves.toBe(
      'link-sandbox-token',
    )

    expect(client.linkTokenCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        products: ['transactions'],
        webhook: 'https://finance-web.example.com/api/plaid/webhook',
        user: { client_user_id: 'owner-id' },
      }),
    )
  })

  it('omits the webhook URL when one is not configured', async () => {
    const { client, provider } = setupProvider()

    await provider.createLinkToken('owner-id')

    expect(client.linkTokenCreate).toHaveBeenCalledWith(
      expect.not.objectContaining({ webhook: expect.any(String) }),
    )
  })
})
