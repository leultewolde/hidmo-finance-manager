import { randomUUID } from 'node:crypto'

import { plaidWebhookPayloadSchema } from '@hidmo/contracts'

const PLAID_TRANSACTION_SYNC_CODES = new Set([
  'SYNC_UPDATES_AVAILABLE',
  'INITIAL_UPDATE',
  'HISTORICAL_UPDATE',
  'DEFAULT_UPDATE',
])
export const WEBHOOK_NO_OP_COOLDOWN_MILLISECONDS = 60_000

export type PlaidWebhookResult =
  | {
      httpStatus: 202
      body: {
        status: 'queued'
        connectionId: string
        syncJobId: string
        taskName: string
      }
    }
  | {
      httpStatus: 202
      body: {
        status: 'ignored' | 'unknown_item' | 'enqueue_failed'
        reason?: string
        connectionId?: string
        syncJobId?: string
      }
    }
  | { httpStatus: 400; body: { status: 'invalid_payload' } }

export interface PlaidWebhookDependencies {
  connections: {
    getActiveByPlaidItemId(plaidItemId: string): Promise<
      | {
          id: string
          userId: string
        }
      | undefined
    >
  }
  syncJobs: {
    createQueued(input: {
      id: string
      userId: string
      connectionId: string
      operation: string
      trigger: string
      idempotencyKey: string
    }): Promise<unknown | undefined>
    findWebhookCoalescingCandidate(input: {
      userId: string
      connectionId: string
      noOpCooldownSince: Date
    }): Promise<
      | {
          id: string
          status: string
          completedAt: Date | null
        }
      | undefined
    >
    markEnqueued(id: string, cloudTaskName: string): Promise<void>
    markFailed(id: string, errorCode: string): Promise<void>
  }
  enqueuePlaidSyncTask(input: {
    userId: string
    connectionId: string
    syncJobId: string
    idempotencyKey: string
  }): Promise<{ taskName: string }>
  createId?: () => string
  now?: () => Date
}

export async function handlePlaidWebhookPayload(
  payload: unknown,
  dependencies: PlaidWebhookDependencies,
): Promise<PlaidWebhookResult> {
  const parsed = plaidWebhookPayloadSchema.safeParse(payload)
  if (!parsed.success) {
    return { httpStatus: 400, body: { status: 'invalid_payload' } }
  }

  const webhook = parsed.data
  if (webhook.webhook_type !== 'TRANSACTIONS') {
    return {
      httpStatus: 202,
      body: { status: 'ignored', reason: 'unsupported_webhook_type' },
    }
  }
  if (!PLAID_TRANSACTION_SYNC_CODES.has(webhook.webhook_code)) {
    return {
      httpStatus: 202,
      body: { status: 'ignored', reason: 'unsupported_webhook_code' },
    }
  }

  const connection = await dependencies.connections.getActiveByPlaidItemId(
    webhook.item_id,
  )
  if (connection === undefined) {
    return { httpStatus: 202, body: { status: 'unknown_item' } }
  }

  const now = dependencies.now ?? (() => new Date())
  const coalescingCandidate =
    await dependencies.syncJobs.findWebhookCoalescingCandidate({
      userId: connection.userId,
      connectionId: connection.id,
      noOpCooldownSince: new Date(
        now().getTime() - WEBHOOK_NO_OP_COOLDOWN_MILLISECONDS,
      ),
    })
  if (coalescingCandidate !== undefined) {
    return {
      httpStatus: 202,
      body: {
        status: 'ignored',
        reason:
          coalescingCandidate.status === 'queued' ||
          coalescingCandidate.status === 'running'
            ? 'sync_already_active'
            : 'recent_noop_sync',
        connectionId: connection.id,
        syncJobId: coalescingCandidate.id,
      },
    }
  }

  const createId = dependencies.createId ?? randomUUID
  const syncJobId = createId()
  const idempotencyKey = `plaid-webhook:${webhook.item_id}:${webhook.webhook_code}:${
    webhook.webhook_id ?? syncJobId
  }`
  const created = await dependencies.syncJobs.createQueued({
    id: syncJobId,
    userId: connection.userId,
    connectionId: connection.id,
    operation: 'plaid.transactions.sync',
    trigger: 'webhook',
    idempotencyKey,
  })
  if (created === undefined) {
    return {
      httpStatus: 202,
      body: {
        status: 'ignored',
        reason: 'duplicate_webhook',
        connectionId: connection.id,
      },
    }
  }

  try {
    const task = await dependencies.enqueuePlaidSyncTask({
      userId: connection.userId,
      connectionId: connection.id,
      syncJobId,
      idempotencyKey,
    })
    await dependencies.syncJobs.markEnqueued(syncJobId, task.taskName)
    return {
      httpStatus: 202,
      body: {
        status: 'queued',
        connectionId: connection.id,
        syncJobId,
        taskName: task.taskName,
      },
    }
  } catch {
    await dependencies.syncJobs.markFailed(syncJobId, 'TASK_ENQUEUE_FAILED')
    return {
      httpStatus: 202,
      body: {
        status: 'enqueue_failed',
        connectionId: connection.id,
        syncJobId,
      },
    }
  }
}
