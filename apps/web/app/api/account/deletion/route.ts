import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'

import { createLogger } from '@hidmo/logging'

import { requireDatabaseOwner } from '../../../../lib/application-services'
import { AuthFailure, CSRF_COOKIE_NAME } from '../../../../lib/auth-policy'
import { enqueueUserDeletionTask } from '../../../../lib/cloud-tasks'
import {
  hasSameOrigin,
  hasValidCsrfToken,
} from '../../../../lib/request-security'
import {
  requestUserDeletion,
  UserDeletionEnqueueError,
} from '../../../../lib/user-deletion'

export const dynamic = 'force-dynamic'

const logger = createLogger('web-user-deletion')
const CONFIRMATION_PHRASE = 'DELETE MY HIDMO ACCOUNT'

export async function GET() {
  try {
    const { databaseOwner, repositories } = await requireDatabaseOwner()
    const active =
      await repositories.deletionRequests.findActiveUserRequestForUser(
        databaseOwner.id,
      )

    return NextResponse.json({
      status: active === undefined ? 'none' : active.status,
      deletionRequestId: active?.id,
    })
  } catch (error) {
    if (error instanceof AuthFailure) {
      return NextResponse.json({ error: error.code }, { status: error.status })
    }

    logger.error(
      {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      },
      'User deletion status lookup failed',
    )
    return NextResponse.json(
      { error: 'user-deletion-status-failed' },
      { status: 502 },
    )
  }
}

export async function POST(request: NextRequest) {
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

    const body = (await request.json()) as {
      csrfToken?: unknown
      confirmationPhrase?: unknown
    }
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

    if (body.confirmationPhrase !== CONFIRMATION_PHRASE) {
      return NextResponse.json(
        {
          error: 'invalid-confirmation-phrase',
          requiredPhrase: CONFIRMATION_PHRASE,
        },
        { status: 400 },
      )
    }

    const { databaseOwner, repositories } = await requireDatabaseOwner()
    const result = await requestUserDeletion({
      userId: databaseOwner.id,
      createId: randomUUID,
      enqueueUserDeletionTask,
      repositories,
    })

    logger.info(
      {
        userId: databaseOwner.id,
        deletionRequestId: result.deletionRequestId,
        taskName: result.taskName,
        status: result.status,
      },
      'User deletion enqueued',
    )

    return NextResponse.json(result, {
      status: result.status === 'already_queued' ? 200 : 202,
    })
  } catch (error) {
    if (error instanceof AuthFailure) {
      return NextResponse.json({ error: error.code }, { status: error.status })
    }

    if (error instanceof UserDeletionEnqueueError) {
      logger.error(
        {
          deletionRequestId: error.deletionRequestId,
          errorName: error.name,
        },
        'User deletion enqueue failed',
      )
      return NextResponse.json(
        {
          error: 'user-deletion-enqueue-failed',
          code: 'TASK_ENQUEUE_FAILED',
          deletionRequestId: error.deletionRequestId,
        },
        { status: 502 },
      )
    }

    logger.error(
      {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      },
      'User deletion request failed',
    )
    return NextResponse.json(
      { error: 'user-deletion-request-failed' },
      { status: 502 },
    )
  }
}
