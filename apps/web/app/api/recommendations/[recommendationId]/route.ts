import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { requireDatabaseOwner } from '../../../../lib/application-services'
import { AuthFailure, CSRF_COOKIE_NAME } from '../../../../lib/auth-policy'
import { serializeRecommendationView } from '../../../../lib/recommendation-view'
import {
  hasSameOrigin,
  hasValidCsrfToken,
} from '../../../../lib/request-security'

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ recommendationId: string }> },
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

    const body = (await request.json()) as Record<string, unknown>
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

    if (body.status !== 'accepted' && body.status !== 'dismissed') {
      return NextResponse.json({ error: 'invalid-status' }, { status: 400 })
    }

    const { recommendationId } = await context.params
    const { databaseOwner, repositories } = await requireDatabaseOwner()
    const recommendation = await repositories.recommendations.updateStatus(
      databaseOwner.id,
      recommendationId,
      body.status,
    )

    return NextResponse.json({
      recommendation: serializeRecommendationView(recommendation),
    })
  } catch (error) {
    if (error instanceof AuthFailure) {
      return NextResponse.json({ error: error.code }, { status: error.status })
    }

    return NextResponse.json(
      {
        error: 'recommendation-status-update-failed',
        message:
          error instanceof Error
            ? error.message
            : 'The recommendation could not be updated.',
      },
      { status: 400 },
    )
  }
}
