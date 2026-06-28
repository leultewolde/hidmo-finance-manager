import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createLogger } from '@hidmo/logging'

import { requireDatabaseOwner } from '../../../../../lib/application-services'
import { AuthFailure, CSRF_COOKIE_NAME } from '../../../../../lib/auth-policy'
import { enqueuePlaidSyncTask } from '../../../../../lib/cloud-tasks'
import {
  hasSameOrigin,
  hasValidCsrfToken,
} from '../../../../../lib/request-security'
import { plaidErrorCode } from '../../../../../lib/transaction-sync'

export const dynamic = 'force-dynamic'

const logger = createLogger('web-plaid-sync')

export async function POST(
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
    const connection = await repositories.connections.getTokenEnvelopeForUser(
      databaseOwner.id,
      connectionId,
    )
    if (connection === undefined) {
      return NextResponse.json(
        { error: 'connection-not-found' },
        { status: 404 },
      )
    }
    const task = await enqueuePlaidSyncTask({
      userId: databaseOwner.id,
      connectionId,
    })

    logger.info(
      { connectionId, taskName: task.taskName },
      'Plaid transaction synchronization enqueued',
    )
    return NextResponse.json({ status: 'queued', ...task }, { status: 202 })
  } catch (error) {
    if (error instanceof AuthFailure) {
      return NextResponse.json({ error: error.code }, { status: error.status })
    }

    const code = plaidErrorCode(error)
    logger.error(
      {
        errorCode: code,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      },
      'Plaid transaction synchronization failed',
    )
    return NextResponse.json(
      { error: 'transaction-sync-enqueue-failed', code },
      { status: 502 },
    )
  }
}
