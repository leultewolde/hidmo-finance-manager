import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { requireDatabaseOwner } from '../../../../lib/application-services'
import { AuthFailure, CSRF_COOKIE_NAME } from '../../../../lib/auth-policy'
import {
  hasSameOrigin,
  hasValidCsrfToken,
} from '../../../../lib/request-security'

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ matchId: string }> },
) {
  try {
    const body = (await request.json()) as Record<string, unknown>
    const csrfToken =
      typeof body.csrfToken === 'string' ? body.csrfToken : undefined
    if (
      !hasSameOrigin(request.url, request.headers.get('origin')) ||
      !hasValidCsrfToken(
        request.cookies.get(CSRF_COOKIE_NAME)?.value,
        csrfToken,
      )
    ) {
      return NextResponse.json({ error: 'invalid-request' }, { status: 403 })
    }
    if (body.decision !== 'accept' && body.decision !== 'reject') {
      return NextResponse.json({ error: 'invalid-decision' }, { status: 400 })
    }

    const { matchId } = await context.params
    const { databaseOwner, repositories } = await requireDatabaseOwner()
    await repositories.transfers.review(
      databaseOwner.id,
      matchId,
      body.decision === 'accept',
    )
    return NextResponse.json({ reviewed: true })
  } catch (error) {
    if (error instanceof AuthFailure) {
      return NextResponse.json({ error: error.code }, { status: error.status })
    }
    return NextResponse.json({ error: 'match-review-failed' }, { status: 400 })
  }
}
