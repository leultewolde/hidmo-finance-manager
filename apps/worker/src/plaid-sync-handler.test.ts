import { describe, expect, it, vi } from 'vitest'

import { runPlaidSyncJob } from './plaid-sync-handler.js'

function setup(sync = { added: 0, modified: 0, removed: 0 }) {
  return {
    markRunning: vi.fn().mockResolvedValue(undefined),
    markSucceeded: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    synchronize: vi.fn().mockResolvedValue({
      ...sync,
      providerAttempts: 1,
    }),
    refreshClassifications: vi.fn().mockResolvedValue({
      classified: 97,
      transferCandidates: 4,
    }),
  }
}

const job = {
  userId: '00000000-0000-4000-8000-000000000001',
  connectionId: '00000000-0000-4000-8000-000000000002',
  syncJobId: '00000000-0000-4000-8000-000000000003',
}

describe('Plaid sync job runner', () => {
  it('refreshes classifications when Plaid returns transaction changes', async () => {
    const dependencies = setup({ added: 2, modified: 1, removed: 0 })

    const result = await runPlaidSyncJob(job, dependencies)

    expect(result).toEqual({
      added: 2,
      modified: 1,
      removed: 0,
      providerAttempts: 1,
      classified: 97,
      transferCandidates: 4,
    })
    expect(dependencies.refreshClassifications).toHaveBeenCalledWith(job.userId)
    expect(dependencies.markSucceeded).toHaveBeenCalledWith(
      job.syncJobId,
      result,
    )
  })

  it('skips classification refresh when Plaid returns no transaction changes', async () => {
    const dependencies = setup({ added: 0, modified: 0, removed: 0 })

    const result = await runPlaidSyncJob(job, dependencies)

    expect(result).toEqual({
      added: 0,
      modified: 0,
      removed: 0,
      providerAttempts: 1,
      classified: 0,
      transferCandidates: 0,
    })
    expect(dependencies.refreshClassifications).not.toHaveBeenCalled()
    expect(dependencies.markSucceeded).toHaveBeenCalledWith(
      job.syncJobId,
      result,
    )
  })

  it('marks the sync job failed when synchronization fails', async () => {
    const dependencies = setup()
    dependencies.synchronize.mockRejectedValue(new Error('offline'))

    await expect(runPlaidSyncJob(job, dependencies)).rejects.toThrow('offline')

    expect(dependencies.markFailed).toHaveBeenCalledWith(job.syncJobId, 'Error')
    expect(dependencies.markSucceeded).not.toHaveBeenCalled()
  })
})
