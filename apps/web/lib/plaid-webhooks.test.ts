import { describe, expect, it, vi } from 'vitest'

import { handlePlaidWebhookPayload } from './plaid-webhooks'

function setup() {
  return {
    connections: {
      getActiveByPlaidItemId: vi.fn().mockResolvedValue({
        id: '00000000-0000-4000-8000-000000000002',
        userId: '00000000-0000-4000-8000-000000000001',
      }),
    },
    syncJobs: {
      createQueuedWebhookSyncJob: vi.fn().mockResolvedValue({
        status: 'created',
        job: { id: '00000000-0000-4000-8000-000000000003' },
      }),
      markEnqueued: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined),
    },
    enqueuePlaidSyncTask: vi
      .fn()
      .mockResolvedValue({ taskName: 'projects/test/tasks/webhook-sync' }),
    createId: vi.fn().mockReturnValue('00000000-0000-4000-8000-000000000003'),
  }
}

describe('Plaid webhook handling', () => {
  it('enqueues a sync job for transaction update webhooks', async () => {
    const dependencies = setup()

    const result = await handlePlaidWebhookPayload(
      {
        webhook_type: 'TRANSACTIONS',
        webhook_code: 'SYNC_UPDATES_AVAILABLE',
        item_id: 'item-123',
        webhook_id: 'webhook-123',
      },
      dependencies,
    )

    expect(result).toEqual({
      httpStatus: 202,
      body: {
        status: 'queued',
        connectionId: '00000000-0000-4000-8000-000000000002',
        syncJobId: '00000000-0000-4000-8000-000000000003',
        taskName: 'projects/test/tasks/webhook-sync',
      },
    })
    expect(
      dependencies.syncJobs.createQueuedWebhookSyncJob,
    ).toHaveBeenCalledWith({
      id: '00000000-0000-4000-8000-000000000003',
      userId: '00000000-0000-4000-8000-000000000001',
      connectionId: '00000000-0000-4000-8000-000000000002',
      idempotencyKey:
        'plaid-webhook:item-123:SYNC_UPDATES_AVAILABLE:webhook-123',
      noOpCooldownSince: expect.any(Date),
    })
    expect(dependencies.enqueuePlaidSyncTask).toHaveBeenCalledWith({
      userId: '00000000-0000-4000-8000-000000000001',
      connectionId: '00000000-0000-4000-8000-000000000002',
      syncJobId: '00000000-0000-4000-8000-000000000003',
      idempotencyKey:
        'plaid-webhook:item-123:SYNC_UPDATES_AVAILABLE:webhook-123',
    })
    expect(dependencies.syncJobs.markEnqueued).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000003',
      'projects/test/tasks/webhook-sync',
    )
  })

  it('ignores unsupported webhook types without database writes', async () => {
    const dependencies = setup()

    const result = await handlePlaidWebhookPayload(
      {
        webhook_type: 'ITEM',
        webhook_code: 'ERROR',
        item_id: 'item-123',
      },
      dependencies,
    )

    expect(result).toEqual({
      httpStatus: 202,
      body: { status: 'ignored', reason: 'unsupported_webhook_type' },
    })
    expect(
      dependencies.syncJobs.createQueuedWebhookSyncJob,
    ).not.toHaveBeenCalled()
    expect(dependencies.enqueuePlaidSyncTask).not.toHaveBeenCalled()
  })

  it('acknowledges unknown Plaid items without enqueueing a task', async () => {
    const dependencies = setup()
    dependencies.connections.getActiveByPlaidItemId.mockResolvedValue(undefined)

    const result = await handlePlaidWebhookPayload(
      {
        webhook_type: 'TRANSACTIONS',
        webhook_code: 'SYNC_UPDATES_AVAILABLE',
        item_id: 'missing-item',
      },
      dependencies,
    )

    expect(result).toEqual({
      httpStatus: 202,
      body: { status: 'unknown_item' },
    })
    expect(
      dependencies.syncJobs.createQueuedWebhookSyncJob,
    ).not.toHaveBeenCalled()
    expect(dependencies.enqueuePlaidSyncTask).not.toHaveBeenCalled()
  })

  it('marks the sync job failed when enqueueing Cloud Tasks fails', async () => {
    const dependencies = setup()
    dependencies.enqueuePlaidSyncTask.mockRejectedValue(new Error('offline'))

    const result = await handlePlaidWebhookPayload(
      {
        webhook_type: 'TRANSACTIONS',
        webhook_code: 'DEFAULT_UPDATE',
        item_id: 'item-123',
      },
      dependencies,
    )

    expect(result).toEqual({
      httpStatus: 202,
      body: {
        status: 'enqueue_failed',
        connectionId: '00000000-0000-4000-8000-000000000002',
        syncJobId: '00000000-0000-4000-8000-000000000003',
      },
    })
    expect(dependencies.syncJobs.markFailed).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000003',
      'TASK_ENQUEUE_FAILED',
    )
  })

  it('does not enqueue when another sync is already queued for the connection', async () => {
    const dependencies = setup()
    dependencies.syncJobs.createQueuedWebhookSyncJob.mockResolvedValue({
      status: 'coalesced',
      reason: 'sync_already_active',
      job: { id: '00000000-0000-4000-8000-000000000004' },
    })

    const result = await handlePlaidWebhookPayload(
      {
        webhook_type: 'TRANSACTIONS',
        webhook_code: 'SYNC_UPDATES_AVAILABLE',
        item_id: 'item-123',
        webhook_id: 'webhook-123',
      },
      dependencies,
    )

    expect(result).toEqual({
      httpStatus: 202,
      body: {
        status: 'ignored',
        reason: 'sync_already_active',
        connectionId: '00000000-0000-4000-8000-000000000002',
        syncJobId: '00000000-0000-4000-8000-000000000004',
      },
    })
    expect(dependencies.enqueuePlaidSyncTask).not.toHaveBeenCalled()
  })

  it('does not enqueue after a recent no-op webhook sync', async () => {
    const dependencies = setup()
    dependencies.syncJobs.createQueuedWebhookSyncJob.mockResolvedValue({
      status: 'coalesced',
      reason: 'recent_noop_sync',
      job: { id: '00000000-0000-4000-8000-000000000004' },
    })

    const result = await handlePlaidWebhookPayload(
      {
        webhook_type: 'TRANSACTIONS',
        webhook_code: 'SYNC_UPDATES_AVAILABLE',
        item_id: 'item-123',
        webhook_id: 'webhook-123',
      },
      dependencies,
    )

    expect(result).toEqual({
      httpStatus: 202,
      body: {
        status: 'ignored',
        reason: 'recent_noop_sync',
        connectionId: '00000000-0000-4000-8000-000000000002',
        syncJobId: '00000000-0000-4000-8000-000000000004',
      },
    })
    expect(dependencies.enqueuePlaidSyncTask).not.toHaveBeenCalled()
  })

  it('does not enqueue duplicate webhook deliveries', async () => {
    const dependencies = setup()
    dependencies.syncJobs.createQueuedWebhookSyncJob.mockResolvedValue({
      status: 'duplicate_webhook',
    })

    const result = await handlePlaidWebhookPayload(
      {
        webhook_type: 'TRANSACTIONS',
        webhook_code: 'SYNC_UPDATES_AVAILABLE',
        item_id: 'item-123',
        webhook_id: 'webhook-123',
      },
      dependencies,
    )

    expect(result).toEqual({
      httpStatus: 202,
      body: {
        status: 'ignored',
        reason: 'duplicate_webhook',
        connectionId: '00000000-0000-4000-8000-000000000002',
      },
    })
    expect(dependencies.enqueuePlaidSyncTask).not.toHaveBeenCalled()
  })

  it('rejects invalid webhook payloads', async () => {
    const dependencies = setup()

    const result = await handlePlaidWebhookPayload({}, dependencies)

    expect(result).toEqual({
      httpStatus: 400,
      body: { status: 'invalid_payload' },
    })
  })
})
