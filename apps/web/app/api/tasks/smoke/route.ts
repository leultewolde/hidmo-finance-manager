import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createLogger } from '@hidmo/logging'

import { requireDatabaseOwner } from '../../../../lib/application-services'
import { AuthFailure, CSRF_COOKIE_NAME } from '../../../../lib/auth-policy'
import { enqueueCloudTasksSmokeTask } from '../../../../lib/cloud-tasks'
import {
  hasSameOrigin,
  hasValidCsrfToken,
} from '../../../../lib/request-security'

export const dynamic = 'force-dynamic'

const logger = createLogger('web-cloud-tasks')

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

    await requireDatabaseOwner()
    const task = await enqueueCloudTasksSmokeTask()
    logger.info({ taskName: task.taskName }, 'Cloud Tasks smoke task enqueued')

    return NextResponse.json(task)
  } catch (error) {
    if (error instanceof AuthFailure) {
      return NextResponse.json({ error: error.code }, { status: error.status })
    }

    logger.error({ err: error }, 'Cloud Tasks smoke task enqueue failed')
    return NextResponse.json(
      { error: 'cloud-tasks-smoke-enqueue-failed' },
      { status: 502 },
    )
  }
}
