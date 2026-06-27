import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { requireDatabaseOwner } from '../../../lib/application-services'
import { AuthFailure, CSRF_COOKIE_NAME } from '../../../lib/auth-policy'
import { refreshClassifications } from '../../../lib/classification-service'
import { hasSameOrigin, hasValidCsrfToken } from '../../../lib/request-security'

const economicTypes = new Set([
  'income',
  'expense',
  'transfer',
  'debt_payment',
  'refund',
  'adjustment',
  'unknown',
])

export async function POST(request: NextRequest) {
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
    if (
      typeof body.merchantContains !== 'string' ||
      body.merchantContains.trim().length === 0 ||
      typeof body.economicType !== 'string' ||
      !economicTypes.has(body.economicType) ||
      typeof body.category !== 'string' ||
      body.category.trim().length === 0
    ) {
      return NextResponse.json(
        {
          error: 'invalid-rule',
          message: 'A merchant, valid type, and category are required.',
        },
        { status: 400 },
      )
    }

    const { databaseOwner, repositories } = await requireDatabaseOwner()
    const existing = await repositories.classificationRules.listActive(
      databaseOwner.id,
    )
    const created = await repositories.classificationRules.create({
      userId: databaseOwner.id,
      matchConditions: { merchantContains: body.merchantContains.trim() },
      economicType: body.economicType as
        | 'income'
        | 'expense'
        | 'transfer'
        | 'debt_payment'
        | 'refund'
        | 'adjustment'
        | 'unknown',
      category: body.category.trim(),
      priority: existing.length + 1,
    })
    await refreshClassifications(databaseOwner.id, repositories)

    return NextResponse.json({ id: created?.id }, { status: 201 })
  } catch (error) {
    if (error instanceof AuthFailure) {
      return NextResponse.json({ error: error.code }, { status: error.status })
    }
    return NextResponse.json(
      {
        error: 'rule-creation-failed',
        message:
          error instanceof Error
            ? error.message
            : 'The rule could not be saved.',
      },
      { status: 400 },
    )
  }
}
