import {
  decryptAccessToken,
  type PlaidProvider,
  type TokenEnvelope,
} from '@hidmo/plaid'

import { plaidErrorCode } from './transaction-sync.js'

type TokenEnvelopeRow = {
  id: string
  encryptedAccessToken: string | null
  wrappedDataKey: string | null
  encryptionNonce: string | null
  encryptionTag: string | null
  encryptionAlgorithm: string | null
  kmsKeyName: string | null
}

interface RevocationRepositories {
  connections: {
    getTokenEnvelopeForUser(
      userId: string,
      connectionId: string,
    ): Promise<TokenEnvelopeRow | undefined>
    revokeForUser(userId: string, connectionId: string): Promise<void>
  }
}

export type PlaidConnectionRevocationResult = {
  connectionId: string
  plaidItemRevoked: boolean
  localTokenDestroyed: boolean
  plaidErrorCode?: string
  tokenErrorCode?: string
}

function hasCompleteTokenEnvelope(
  connection: TokenEnvelopeRow,
): connection is TokenEnvelopeRow & TokenEnvelope {
  return (
    connection.encryptedAccessToken !== null &&
    connection.wrappedDataKey !== null &&
    connection.encryptionNonce !== null &&
    connection.encryptionTag !== null &&
    connection.encryptionAlgorithm !== null &&
    connection.kmsKeyName !== null
  )
}

async function destroyLocalToken(input: {
  repositories: RevocationRepositories
  userId: string
  connectionId: string
}) {
  await input.repositories.connections.revokeForUser(
    input.userId,
    input.connectionId,
  )
}

export async function revokePlaidConnectionForDeletion(input: {
  userId: string
  connectionId: string
  provider: PlaidProvider
  repositories: RevocationRepositories
  wrappingKey: Buffer
}): Promise<PlaidConnectionRevocationResult> {
  const connection =
    await input.repositories.connections.getTokenEnvelopeForUser(
      input.userId,
      input.connectionId,
    )

  if (connection === undefined) {
    return {
      connectionId: input.connectionId,
      plaidItemRevoked: false,
      localTokenDestroyed: true,
      tokenErrorCode: 'CONNECTION_NOT_FOUND',
    }
  }

  if (!hasCompleteTokenEnvelope(connection)) {
    await destroyLocalToken(input)
    return {
      connectionId: input.connectionId,
      plaidItemRevoked: false,
      localTokenDestroyed: true,
      tokenErrorCode: 'TOKEN_ENVELOPE_MISSING',
    }
  }

  let accessToken: string | undefined
  let tokenErrorCode: string | undefined
  try {
    accessToken = decryptAccessToken(connection, input.wrappingKey)
  } catch (error) {
    tokenErrorCode = plaidErrorCode(error)
  }

  let plaidItemRevoked = false
  let providerErrorCode: string | undefined
  if (accessToken !== undefined) {
    try {
      await input.provider.removeItem(accessToken)
      plaidItemRevoked = true
    } catch (error) {
      providerErrorCode = plaidErrorCode(error)
    }
  }

  await destroyLocalToken(input)

  return {
    connectionId: input.connectionId,
    plaidItemRevoked,
    localTokenDestroyed: true,
    ...(providerErrorCode === undefined
      ? {}
      : { plaidErrorCode: providerErrorCode }),
    ...(tokenErrorCode === undefined ? {} : { tokenErrorCode }),
  }
}
