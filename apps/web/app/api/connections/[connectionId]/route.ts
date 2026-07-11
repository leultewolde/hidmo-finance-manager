import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'

import { createLogger } from '@hidmo/logging'

import { requireDatabaseOwner } from '../../../../lib/application-services'
import { AuthFailure, CSRF_COOKIE_NAME } from '../../../../lib/auth-policy'
import { enqueueConnectionDeletionTask } from '../../../../lib/cloud-tasks'
import {
  hasSameOrigin,
  hasValidCsrfToken,
} from '../../../../lib/request-security'
import { plaidErrorCode } from '../../../../lib/transaction-sync'

export const dynamic = 'force-dynamic'

const logger = createLogger('web-plaid')

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ connectionId: string }> },
) {
  try {
    if (
      !hasSameOrigin(
        request.url,
        request.headers.get('origin'),
        request.headers,
      )
    ) {
      return NextResponse.json({ error: 'invalid-origin' }, { status: 403 })
    }

    const body = (await request.json()) as { csrfToken?: unknown }
    const csrfToken =
      typeof body.csrfToken === 'string' ? body.csrfToken : undefined
    if (
      !hasValidCsrfToken(
        request.cookies.get(CSRF_COOKIE_NAME)?.value,
        csrfToken,
      )
    ) {
      return NextResponse.json({ error: 'invalid-csrf-token' }, { status: 403 })
    }

    const { connectionId } = await context.params
    const { databaseOwner, repositories } = await requireDatabaseOwner()
    const deletionRequestId = randomUUID()
    const idempotencyKey = `deletion:connection:${connectionId}:${deletionRequestId}`
    const deletionRequest =
      await repositories.deletionRequests.createConnectionRequest({
        id: deletionRequestId,
        userId: databaseOwner.id,
        connectionId,
        idempotencyKey,
        auditMetadata: {
          source: 'dashboard',
          scope: 'connection',
          connectionId,
        },
      })

    let task: Awaited<ReturnType<typeof enqueueConnectionDeletionTask>>
    try {
      task = await enqueueConnectionDeletionTask({
        userId: databaseOwner.id,
        connectionId,
        deletionRequestId: deletionRequest.id,
        idempotencyKey: deletionRequest.idempotencyKey,
      })
    } catch (error) {
      await repositories.deletionRequests.markFailed(
        deletionRequest.id,
        'TASK_ENQUEUE_FAILED',
        {
          source: 'dashboard',
          scope: 'connection',
          connectionId,
        },
      )
      logger.error(
        {
          connectionId,
          deletionRequestId: deletionRequest.id,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        },
        'Plaid connection deletion enqueue failed',
      )
      return NextResponse.json(
        {
          error: 'connection-deletion-enqueue-failed',
          code: 'TASK_ENQUEUE_FAILED',
          deletionRequestId: deletionRequest.id,
        },
        { status: 502 },
      )
    }

    logger.info(
      {
        connectionId,
        deletionRequestId: deletionRequest.id,
        taskName: task.taskName,
      },
      'Plaid connection deletion enqueued',
    )
    return NextResponse.json(
      {
        status: 'queued',
        deletionRequestId: deletionRequest.id,
        ...task,
      },
      { status: 202 },
    )
  } catch (error) {
    if (error instanceof AuthFailure) {
      return NextResponse.json({ error: error.code }, { status: error.status })
    }
    if (
      error instanceof Error &&
      error.message === 'Connection does not belong to user'
    ) {
      return NextResponse.json(
        { error: 'connection-not-found', code: 'CONNECTION_NOT_FOUND' },
        { status: 404 },
      )
    }
    const code = plaidErrorCode(error)
    logger.error(
      {
        errorCode: code,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      },
      'Plaid connection deletion enqueue failed',
    )
    return NextResponse.json(
      { error: 'connection-deletion-enqueue-failed', code },
      { status: 502 },
    )
  }
}
