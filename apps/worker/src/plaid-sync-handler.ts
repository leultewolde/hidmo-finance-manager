import { plaidErrorCode } from '@hidmo/sync'

export interface PlaidSyncResult {
  added: number
  modified: number
  removed: number
  providerAttempts: number
}

export interface ClassificationRefreshResult {
  classified: number
  transferCandidates: number
}

export interface PlaidSyncJobResult
  extends PlaidSyncResult, ClassificationRefreshResult {}

export interface PlaidSyncJobDependencies {
  markRunning(syncJobId: string): Promise<void>
  markSucceeded(
    syncJobId: string,
    result: Record<string, unknown>,
  ): Promise<void>
  markFailed(syncJobId: string, errorCode: string): Promise<void>
  synchronize(input: {
    userId: string
    connectionId: string
  }): Promise<PlaidSyncResult>
  refreshClassifications(userId: string): Promise<ClassificationRefreshResult>
}

function hasTransactionChanges(sync: PlaidSyncResult) {
  return sync.added + sync.modified + sync.removed > 0
}

export async function runPlaidSyncJob(
  input: {
    userId: string
    connectionId: string
    syncJobId: string
  },
  dependencies: PlaidSyncJobDependencies,
): Promise<PlaidSyncJobResult> {
  await dependencies.markRunning(input.syncJobId)
  try {
    const sync = await dependencies.synchronize({
      userId: input.userId,
      connectionId: input.connectionId,
    })
    const classification = hasTransactionChanges(sync)
      ? await dependencies.refreshClassifications(input.userId)
      : { classified: 0, transferCandidates: 0 }
    const result = { ...sync, ...classification }
    await dependencies.markSucceeded(input.syncJobId, result)
    return result
  } catch (error) {
    await dependencies.markFailed(input.syncJobId, plaidErrorCode(error))
    throw error
  }
}
