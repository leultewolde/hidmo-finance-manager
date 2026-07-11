import type { PlaidProvider } from '@hidmo/plaid'

import {
  revokePlaidConnectionForDeletion,
  type PlaidConnectionRevocationResult,
} from './plaid-revocation.js'
import { plaidErrorCode } from './transaction-sync.js'

type DeletionRequest = {
  id: string
  userId: string | null
  connectionId: string | null
  scope: 'user' | 'connection'
  status: 'queued' | 'running' | 'succeeded' | 'failed'
}

interface DeletionTaskRepositories {
  users: {
    deleteById(userId: string): Promise<boolean>
  }
  connections: Parameters<
    typeof revokePlaidConnectionForDeletion
  >[0]['repositories']['connections'] & {
    listDeletionTargetsForUser(userId: string): Promise<{ id: string }[]>
  }
  deletionRequests: {
    getById(id: string): Promise<DeletionRequest | undefined>
    getByIdForUser(
      userId: string,
      id: string,
    ): Promise<DeletionRequest | undefined>
    markRunning(id: string): Promise<DeletionRequest | undefined>
    markSucceeded(
      id: string,
      auditMetadata?: Record<string, unknown>,
    ): Promise<DeletionRequest | undefined>
    markFailed(
      id: string,
      errorCode: string,
      auditMetadata?: Record<string, unknown>,
    ): Promise<DeletionRequest | undefined>
  }
}

export type ProcessConnectionDeletionResult =
  PlaidConnectionRevocationResult & {
    status: 'completed' | 'already_completed'
  }

export type ProcessUserDeletionResult = {
  status: 'completed' | 'already_completed'
  revokedConnectionCount: number
  localTokenDestroyedCount: number
  failedConnectionCount: number
  userDeleted: boolean
}

export class DeletionRequestNotFoundError extends Error {
  constructor() {
    super('Deletion request was not found')
    this.name = 'DELETION_REQUEST_NOT_FOUND'
  }
}

export class DeletionRequestMismatchError extends Error {
  constructor() {
    super('Deletion task payload does not match the deletion request')
    this.name = 'DELETION_REQUEST_MISMATCH'
  }
}

function assertConnectionDeletionRequest(
  request: DeletionRequest,
  input: { userId: string; connectionId: string },
) {
  if (
    request.userId !== input.userId ||
    request.scope !== 'connection' ||
    request.connectionId !== input.connectionId
  ) {
    throw new DeletionRequestMismatchError()
  }
}

function assertUserDeletionRequest(
  request: DeletionRequest,
  input: { userId: string },
) {
  if (
    request.scope !== 'user' ||
    request.connectionId !== null ||
    (request.userId !== null && request.userId !== input.userId)
  ) {
    throw new DeletionRequestMismatchError()
  }
}

function connectionAuditMetadata(
  input: { connectionId: string },
  result?: PlaidConnectionRevocationResult,
) {
  return {
    scope: 'connection',
    connectionId: input.connectionId,
    ...(result === undefined
      ? {}
      : {
          plaidItemRevoked: result.plaidItemRevoked,
          localTokenDestroyed: result.localTokenDestroyed,
          plaidErrorCode: result.plaidErrorCode,
          tokenErrorCode: result.tokenErrorCode,
        }),
  }
}

function userAuditMetadata(input: {
  revokedConnectionCount: number
  localTokenDestroyedCount: number
  failedConnectionCount: number
  plaidErrorCodes: string[]
  tokenErrorCodes: string[]
  userDeleted: boolean
}) {
  return {
    scope: 'user',
    revokedConnectionCount: input.revokedConnectionCount,
    localTokenDestroyedCount: input.localTokenDestroyedCount,
    failedConnectionCount: input.failedConnectionCount,
    plaidErrorCodes: input.plaidErrorCodes,
    tokenErrorCodes: input.tokenErrorCodes,
    userDeleted: input.userDeleted,
  }
}

export async function processConnectionDeletionTask(input: {
  userId: string
  connectionId: string
  deletionRequestId: string
  provider: PlaidProvider
  repositories: DeletionTaskRepositories
  wrappingKey: Buffer
}): Promise<ProcessConnectionDeletionResult> {
  const request = await input.repositories.deletionRequests.getByIdForUser(
    input.userId,
    input.deletionRequestId,
  )

  if (request === undefined) {
    throw new DeletionRequestNotFoundError()
  }
  assertConnectionDeletionRequest(request, input)

  if (request.status === 'succeeded') {
    return {
      connectionId: input.connectionId,
      status: 'already_completed',
      plaidItemRevoked: false,
      localTokenDestroyed: true,
    }
  }

  await input.repositories.deletionRequests.markRunning(input.deletionRequestId)

  try {
    const result = await revokePlaidConnectionForDeletion({
      userId: input.userId,
      connectionId: input.connectionId,
      provider: input.provider,
      repositories: input.repositories,
      wrappingKey: input.wrappingKey,
    })

    await input.repositories.deletionRequests.markSucceeded(
      input.deletionRequestId,
      connectionAuditMetadata(input, result),
    )

    return {
      ...result,
      status: 'completed',
    }
  } catch (error) {
    await input.repositories.deletionRequests.markFailed(
      input.deletionRequestId,
      plaidErrorCode(error),
      connectionAuditMetadata(input),
    )
    throw error
  }
}

export async function processUserDeletionTask(input: {
  userId: string
  deletionRequestId: string
  provider: PlaidProvider
  repositories: DeletionTaskRepositories
  wrappingKey: Buffer
}): Promise<ProcessUserDeletionResult> {
  const request = await input.repositories.deletionRequests.getById(
    input.deletionRequestId,
  )

  if (request === undefined) {
    throw new DeletionRequestNotFoundError()
  }
  assertUserDeletionRequest(request, input)

  if (request.status === 'succeeded') {
    return {
      status: 'already_completed',
      revokedConnectionCount: 0,
      localTokenDestroyedCount: 0,
      failedConnectionCount: 0,
      userDeleted: true,
    }
  }

  await input.repositories.deletionRequests.markRunning(input.deletionRequestId)

  const connectionTargets =
    await input.repositories.connections.listDeletionTargetsForUser(
      input.userId,
    )

  const revocationResults: PlaidConnectionRevocationResult[] = []
  try {
    for (const connection of connectionTargets) {
      revocationResults.push(
        await revokePlaidConnectionForDeletion({
          userId: input.userId,
          connectionId: connection.id,
          provider: input.provider,
          repositories: input.repositories,
          wrappingKey: input.wrappingKey,
        }),
      )
    }

    const userDeleted = await input.repositories.users.deleteById(input.userId)
    const failedConnectionCount = revocationResults.filter(
      (result) => !result.localTokenDestroyed,
    ).length
    const result = {
      status: 'completed' as const,
      revokedConnectionCount: revocationResults.filter(
        (item) => item.plaidItemRevoked,
      ).length,
      localTokenDestroyedCount: revocationResults.filter(
        (item) => item.localTokenDestroyed,
      ).length,
      failedConnectionCount,
      userDeleted,
    }

    await input.repositories.deletionRequests.markSucceeded(
      input.deletionRequestId,
      userAuditMetadata({
        ...result,
        plaidErrorCodes: [
          ...new Set(
            revocationResults
              .map((item) => item.plaidErrorCode)
              .filter((code): code is string => code !== undefined),
          ),
        ],
        tokenErrorCodes: [
          ...new Set(
            revocationResults
              .map((item) => item.tokenErrorCode)
              .filter((code): code is string => code !== undefined),
          ),
        ],
      }),
    )

    return result
  } catch (error) {
    await input.repositories.deletionRequests.markFailed(
      input.deletionRequestId,
      plaidErrorCode(error),
      userAuditMetadata({
        revokedConnectionCount: revocationResults.filter(
          (item) => item.plaidItemRevoked,
        ).length,
        localTokenDestroyedCount: revocationResults.filter(
          (item) => item.localTokenDestroyed,
        ).length,
        failedConnectionCount: 1,
        plaidErrorCodes: [],
        tokenErrorCodes: [],
        userDeleted: false,
      }),
    )
    throw error
  }
}
