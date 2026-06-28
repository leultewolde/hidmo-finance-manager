import { randomUUID } from 'node:crypto'

import {
  decryptAccessToken,
  normalizePlaidTransaction,
  type PlaidProvider,
  type PlaidTransactionSyncPage,
} from '@hidmo/plaid'

const activeLocalSyncs = new Set<string>()
const MAX_ATTEMPTS = 3

export class SyncAlreadyRunningError extends Error {
  constructor() {
    super('Transaction synchronization already running')
    this.name = 'SyncAlreadyRunningError'
  }
}

interface SyncRepositories {
  connections: {
    getTokenEnvelopeForUser(
      userId: string,
      connectionId: string,
    ): Promise<
      | {
          id: string
          transactionCursor: string | null
          encryptedAccessToken: string | null
          wrappedDataKey: string | null
          encryptionNonce: string | null
          encryptionTag: string | null
          encryptionAlgorithm: string | null
          kmsKeyName: string | null
        }
      | undefined
    >
    recordSyncError(
      userId: string,
      connectionId: string,
      errorCode: string,
      reconnectRequired: boolean,
    ): Promise<void>
  }
  transactions: {
    applyPlaidSync(input: {
      userId: string
      connectionId: string
      startingCursor: string | null
      finalCursor: string
      added: ReturnType<typeof normalizePlaidTransaction>[]
      modified: ReturnType<typeof normalizePlaidTransaction>[]
      removedProviderTransactionIds: string[]
    }): Promise<{ added: number; modified: number; removed: number }>
  }
  taskExecutions: {
    claim(input: {
      id: string
      userId: string
      idempotencyKey: string
      operation: string
      schemaVersion: number
    }): Promise<boolean>
    complete(id: string): Promise<void>
    fail(id: string, errorCode: string, attemptCount: number): Promise<void>
  }
}

export function plaidErrorCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof error.response === 'object' &&
    error.response !== null &&
    'data' in error.response &&
    typeof error.response.data === 'object' &&
    error.response.data !== null &&
    'error_code' in error.response.data &&
    typeof error.response.data.error_code === 'string'
  ) {
    return error.response.data.error_code
  }
  if (
    error instanceof Error &&
    error.message === 'Connection not found for owner'
  ) {
    return 'CONNECTION_NOT_FOUND'
  }
  return error instanceof Error ? error.name : 'UNKNOWN_SYNC_ERROR'
}

function isTransientError(code: string) {
  return (
    code === 'INTERNAL_SERVER_ERROR' ||
    code === 'RATE_LIMIT_EXCEEDED' ||
    code === 'PRODUCT_NOT_READY' ||
    code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION'
  )
}

function needsReconnect(code: string) {
  return (
    code === 'ITEM_LOGIN_REQUIRED' ||
    code === 'INVALID_ACCESS_TOKEN' ||
    code === 'ITEM_NOT_SUPPORTED'
  )
}

async function fetchPageWithRetry(input: {
  provider: PlaidProvider
  accessToken: string
  cursor?: string
  sleep: (milliseconds: number) => Promise<void>
  onAttempt: () => void
}) {
  let lastError: unknown

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    input.onAttempt()
    try {
      return await input.provider.syncTransactions(
        input.accessToken,
        input.cursor,
      )
    } catch (error) {
      lastError = error
      const code = plaidErrorCode(error)
      if (
        !isTransientError(code) ||
        code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' ||
        attempt === MAX_ATTEMPTS
      ) {
        throw error
      }
      await input.sleep(100 * 2 ** (attempt - 1))
    }
  }

  throw lastError
}

export async function synchronizePlaidConnection(input: {
  userId: string
  connectionId: string
  provider: PlaidProvider
  repositories: SyncRepositories
  wrappingKey: Buffer
  sleep?: (milliseconds: number) => Promise<void>
}) {
  const lockKey = `${input.userId}:${input.connectionId}`
  if (activeLocalSyncs.has(lockKey)) {
    throw new SyncAlreadyRunningError()
  }
  activeLocalSyncs.add(lockKey)

  const taskId = randomUUID()
  let providerAttempts = 0
  const sleep =
    input.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))

  await input.repositories.taskExecutions.claim({
    id: taskId,
    userId: input.userId,
    idempotencyKey: `transaction-sync:${input.connectionId}:${taskId}`,
    operation: 'plaid.transactions.sync',
    schemaVersion: 1,
  })

  try {
    const connection =
      await input.repositories.connections.getTokenEnvelopeForUser(
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
    const startingCursor = connection.transactionCursor
    let pages: PlaidTransactionSyncPage[] = []

    for (let paginationAttempt = 1; ; paginationAttempt += 1) {
      pages = []
      let cursor = startingCursor ?? undefined

      try {
        do {
          const page = await fetchPageWithRetry({
            provider: input.provider,
            accessToken,
            ...(cursor === undefined ? {} : { cursor }),
            sleep,
            onAttempt: () => {
              providerAttempts += 1
            },
          })
          pages.push(page)
          cursor = page.nextCursor
        } while (pages.at(-1)?.hasMore === true)
        break
      } catch (error) {
        if (
          plaidErrorCode(error) !==
            'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' ||
          paginationAttempt === MAX_ATTEMPTS
        ) {
          throw error
        }
        await sleep(100 * paginationAttempt)
      }
    }

    const finalCursor = pages.at(-1)?.nextCursor
    if (finalCursor === undefined) {
      throw new Error('Plaid transaction synchronization returned no cursor')
    }

    const result = await input.repositories.transactions.applyPlaidSync({
      userId: input.userId,
      connectionId: input.connectionId,
      startingCursor,
      finalCursor,
      added: pages.flatMap((page) =>
        page.added.map((transaction) =>
          normalizePlaidTransaction(transaction, input.connectionId),
        ),
      ),
      modified: pages.flatMap((page) =>
        page.modified.map((transaction) =>
          normalizePlaidTransaction(transaction, input.connectionId),
        ),
      ),
      removedProviderTransactionIds: pages.flatMap(
        (page) => page.removedProviderTransactionIds,
      ),
    })

    await input.repositories.taskExecutions.complete(taskId)
    return { ...result, providerAttempts }
  } catch (error) {
    const code = plaidErrorCode(error)
    await input.repositories.taskExecutions.fail(
      taskId,
      code,
      Math.max(providerAttempts, 1),
    )
    await input.repositories.connections.recordSyncError(
      input.userId,
      input.connectionId,
      code,
      needsReconnect(code),
    )
    throw error
  } finally {
    activeLocalSyncs.delete(lockKey)
  }
}
