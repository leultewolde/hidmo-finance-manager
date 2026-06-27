import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createLogger } from '@hidmo/logging'
import { TokenDecryptionError } from '@hidmo/plaid'

import {
  getLocalTokenWrappingKey,
  getPlaidProvider,
  requireDatabaseOwner,
} from '../../../../lib/application-services'
import { AuthFailure, CSRF_COOKIE_NAME } from '../../../../lib/auth-policy'
import { disconnectPlaidItem } from '../../../../lib/plaid-connections'
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
    await disconnectPlaidItem({
      userId: databaseOwner.id,
      connectionId,
      provider: getPlaidProvider(),
      persistence: repositories.connections,
      wrappingKey: getLocalTokenWrappingKey(),
    })

    logger.info({ connectionId }, 'Plaid connection disconnected')
    return NextResponse.json({ disconnected: true })
  } catch (error) {
    if (error instanceof AuthFailure) {
      return NextResponse.json({ error: error.code }, { status: error.status })
    }
    const code =
      error instanceof TokenDecryptionError ? error.name : plaidErrorCode(error)
    logger.error(
      {
        errorCode: code,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      },
      'Plaid connection disconnection failed',
    )
    return NextResponse.json(
      { error: 'connection-disconnection-failed', code },
      { status: 502 },
    )
  }
}
