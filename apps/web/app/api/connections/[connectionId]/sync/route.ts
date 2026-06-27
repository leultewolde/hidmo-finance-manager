import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createLogger } from '@hidmo/logging'

import {
  getLocalTokenWrappingKey,
  getPlaidProvider,
  requireDatabaseOwner,
} from '../../../../../lib/application-services'
import { AuthFailure, CSRF_COOKIE_NAME } from '../../../../../lib/auth-policy'
import { refreshClassifications } from '../../../../../lib/classification-service'
import {
  hasSameOrigin,
  hasValidCsrfToken,
} from '../../../../../lib/request-security'
import {
  SyncAlreadyRunningError,
  synchronizePlaidConnection,
} from '../../../../../lib/transaction-sync'

export const dynamic = 'force-dynamic'

const logger = createLogger('web-plaid-sync')

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ connectionId: string }> },
) {
  try {
    if (!hasSameOrigin(request.url, request.headers.get('origin'))) {
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
    const result = await synchronizePlaidConnection({
      userId: databaseOwner.id,
      connectionId,
      provider: getPlaidProvider(),
      repositories,
      wrappingKey: getLocalTokenWrappingKey(),
    })
    const classification = await refreshClassifications(
      databaseOwner.id,
      repositories,
    )

    logger.info(
      { connectionId, ...result, ...classification },
      'Plaid transactions synchronized',
    )
    return NextResponse.json({ ...result, ...classification })
  } catch (error) {
    if (error instanceof AuthFailure) {
      return NextResponse.json({ error: error.code }, { status: error.status })
    }
    if (error instanceof SyncAlreadyRunningError) {
      return NextResponse.json(
        { error: 'sync-already-running' },
        { status: 409 },
      )
    }

    logger.error(
      { errorName: error instanceof Error ? error.name : 'UnknownError' },
      'Plaid transaction synchronization failed',
    )
    return NextResponse.json(
      { error: 'transaction-sync-failed' },
      { status: 502 },
    )
  }
}
