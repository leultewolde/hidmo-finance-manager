import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createLogger } from '@hidmo/logging'

import { AuthFailure } from '../../../../lib/auth-policy'
import {
  getPlaidProvider,
  requireDatabaseOwner,
} from '../../../../lib/application-services'
import { hasSameOrigin } from '../../../../lib/request-security'

export const dynamic = 'force-dynamic'

const logger = createLogger('web-plaid')

export async function POST(request: NextRequest) {
  try {
    if (!hasSameOrigin(request.url, request.headers.get('origin'))) {
      return NextResponse.json({ error: 'invalid-origin' }, { status: 403 })
    }

    const { databaseOwner } = await requireDatabaseOwner()
    const linkToken = await getPlaidProvider().createLinkToken(databaseOwner.id)

    return NextResponse.json(
      { linkToken },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    if (error instanceof AuthFailure) {
      return NextResponse.json({ error: error.code }, { status: error.status })
    }
    logger.error(
      { errorName: error instanceof Error ? error.name : 'UnknownError' },
      'Plaid Link token creation failed',
    )
    return NextResponse.json(
      { error: 'link-token-creation-failed' },
      { status: 502 },
    )
  }
}
