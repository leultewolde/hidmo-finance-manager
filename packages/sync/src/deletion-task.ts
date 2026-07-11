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
  connections: Parameters<
    typeof revokePlaidConnectionForDeletion
  >[0]['repositories']['connections']
  deletionRequests: {
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

function auditMetadata(
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
      auditMetadata(input, result),
    )

    return {
      ...result,
      status: 'completed',
    }
  } catch (error) {
    await input.repositories.deletionRequests.markFailed(
      input.deletionRequestId,
      plaidErrorCode(error),
      auditMetadata(input),
    )
    throw error
  }
}
