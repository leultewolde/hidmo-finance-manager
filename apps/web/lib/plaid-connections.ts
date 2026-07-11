import {
  encryptAccessToken,
  normalizePlaidAccount,
  type PlaidProvider,
  type TokenEnvelope,
} from '@hidmo/plaid'
import { revokePlaidConnectionForDeletion } from '@hidmo/sync'

interface ConnectionPersistence {
  createPlaidConnection(input: {
    userId: string
    plaidItemId: string
    institutionProviderId?: string
    institutionName: string
    consentExpiresAt?: Date
    tokenEnvelope: TokenEnvelope
    accounts: ReturnType<typeof normalizePlaidAccount>[]
  }): Promise<string>
  getTokenEnvelopeForUser(
    userId: string,
    connectionId: string,
  ): Promise<
    | {
        id: string
        encryptedAccessToken: string | null
        wrappedDataKey: string | null
        encryptionNonce: string | null
        encryptionTag: string | null
        encryptionAlgorithm: string | null
        kmsKeyName: string | null
      }
    | undefined
  >
  revokeForUser(userId: string, connectionId: string): Promise<void>
}

export async function connectPlaidItem(input: {
  userId: string
  publicToken: string
  provider: PlaidProvider
  persistence: ConnectionPersistence
  wrappingKey: Buffer
}) {
  const exchanged = await input.provider.exchangePublicToken(input.publicToken)

  try {
    const [item, providerAccounts] = await Promise.all([
      input.provider.getItem(exchanged.accessToken),
      input.provider.getAccounts(exchanged.accessToken),
    ])
    const normalizedAccounts = providerAccounts.map((account) =>
      normalizePlaidAccount(account),
    )
    const tokenEnvelope = encryptAccessToken(
      exchanged.accessToken,
      input.wrappingKey,
    )

    const connectionId = await input.persistence.createPlaidConnection({
      userId: input.userId,
      plaidItemId: exchanged.plaidItemId,
      ...(item.institutionId === undefined
        ? {}
        : { institutionProviderId: item.institutionId }),
      institutionName: item.institutionName,
      ...(item.consentExpiresAt === undefined
        ? {}
        : { consentExpiresAt: item.consentExpiresAt }),
      tokenEnvelope,
      accounts: normalizedAccounts,
    })

    return { connectionId, accountCount: normalizedAccounts.length }
  } catch (error) {
    await input.provider
      .removeItem(exchanged.accessToken)
      .catch(() => undefined)
    throw error
  }
}

export async function disconnectPlaidItem(input: {
  userId: string
  connectionId: string
  provider: PlaidProvider
  persistence: ConnectionPersistence
  wrappingKey: Buffer
}) {
  return revokePlaidConnectionForDeletion({
    userId: input.userId,
    connectionId: input.connectionId,
    provider: input.provider,
    repositories: { connections: input.persistence },
    wrappingKey: input.wrappingKey,
  })
}
