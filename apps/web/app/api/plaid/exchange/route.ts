import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createLogger } from '@hidmo/logging'

import {
  getLocalTokenWrappingKey,
  getPlaidProvider,
  requireDatabaseOwner,
} from '../../../../lib/application-services'
import { AuthFailure, CSRF_COOKIE_NAME } from '../../../../lib/auth-policy'
import { enqueuePlaidSyncTask } from '../../../../lib/cloud-tasks'
import { connectPlaidItem } from '../../../../lib/plaid-connections'
import {
  hasSameOrigin,
  hasValidCsrfToken,
} from '../../../../lib/request-security'

export const dynamic = 'force-dynamic'

const logger = createLogger('web-plaid')

interface ExchangeRequest {
  csrfToken?: unknown
  publicToken?: unknown
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

    const body = (await request.json()) as ExchangeRequest
    const csrfToken =
      typeof body.csrfToken === 'string' ? body.csrfToken : undefined
    const publicToken =
      typeof body.publicToken === 'string' ? body.publicToken : undefined

    if (
      !hasValidCsrfToken(
        request.cookies.get(CSRF_COOKIE_NAME)?.value,
        csrfToken,
      )
    ) {
      return NextResponse.json({ error: 'invalid-csrf-token' }, { status: 403 })
    }
    if (publicToken === undefined || publicToken.length === 0) {
      return NextResponse.json(
        { error: 'missing-public-token' },
        { status: 400 },
      )
    }

    const { databaseOwner, repositories } = await requireDatabaseOwner()
    const result = await connectPlaidItem({
      userId: databaseOwner.id,
      publicToken,
      provider: getPlaidProvider(),
      persistence: repositories.connections,
      wrappingKey: getLocalTokenWrappingKey(),
    })

    let initialSync = 'queued'
    try {
      await enqueuePlaidSyncTask({
        userId: databaseOwner.id,
        connectionId: result.connectionId,
      })
    } catch {
      initialSync = 'retry_available'
    }

    logger.info(
      {
        connectionId: result.connectionId,
        accountCount: result.accountCount,
      },
      'Plaid connection created',
    )
    return NextResponse.json({ ...result, initialSync }, { status: 201 })
  } catch (error) {
    if (error instanceof AuthFailure) {
      return NextResponse.json({ error: error.code }, { status: error.status })
    }
    logger.error(
      { errorName: error instanceof Error ? error.name : 'UnknownError' },
      'Plaid public token exchange failed',
    )
    return NextResponse.json(
      { error: 'plaid-connection-failed' },
      { status: 502 },
    )
  }
}
