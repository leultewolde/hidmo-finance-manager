import {
  decryptAccessToken,
  encryptAccessToken,
  normalizePlaidAccount,
  type PlaidProvider,
  type TokenEnvelope,
} from '@hidmo/plaid'

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
  const connection = await input.persistence.getTokenEnvelopeForUser(
    input.userId,
    input.connectionId,
  )
  if (
    connection === undefined ||
    connection.encryptedAccessToken === null ||
    connection.wrappedDataKey === null ||
    connection.encryptionNonce === null ||
    connection.encryptionTag === null ||
    connection.encryptionAlgorithm === null ||
    connection.kmsKeyName === null
  ) {
    throw new Error('Connection not found for owner')
  }

  const accessToken = decryptAccessToken(
    {
      encryptedAccessToken: connection.encryptedAccessToken,
      wrappedDataKey: connection.wrappedDataKey,
      encryptionNonce: connection.encryptionNonce,
      encryptionTag: connection.encryptionTag,
      encryptionAlgorithm: connection.encryptionAlgorithm,
      kmsKeyName: connection.kmsKeyName,
    },
    input.wrappingKey,
  )

  await input.provider.removeItem(accessToken)
  await input.persistence.revokeForUser(input.userId, input.connectionId)
}
