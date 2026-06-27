import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { requireDatabaseOwner } from '../../../../lib/application-services'
import { AuthFailure, CSRF_COOKIE_NAME } from '../../../../lib/auth-policy'
import { refreshClassifications } from '../../../../lib/classification-service'
import {
  hasSameOrigin,
  hasValidCsrfToken,
} from '../../../../lib/request-security'

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ ruleId: string }> },
) {
  try {
    const body = (await request.json()) as { csrfToken?: unknown }
    const csrfToken =
      typeof body.csrfToken === 'string' ? body.csrfToken : undefined
    if (
      !hasSameOrigin(
        request.url,
        request.headers.get('origin'),
        request.headers,
      ) ||
      !hasValidCsrfToken(
        request.cookies.get(CSRF_COOKIE_NAME)?.value,
        csrfToken,
      )
    ) {
      return NextResponse.json({ error: 'invalid-request' }, { status: 403 })
    }

    const { ruleId } = await context.params
    const { databaseOwner, repositories } = await requireDatabaseOwner()
    await repositories.classificationRules.remove(databaseOwner.id, ruleId)
    await refreshClassifications(databaseOwner.id, repositories)
    return NextResponse.json({ removed: true })
  } catch (error) {
    if (error instanceof AuthFailure) {
      return NextResponse.json({ error: error.code }, { status: error.status })
    }
    return NextResponse.json({ error: 'rule-removal-failed' }, { status: 400 })
  }
}
