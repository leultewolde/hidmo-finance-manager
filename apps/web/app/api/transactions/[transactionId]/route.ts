import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { requireDatabaseOwner } from '../../../../lib/application-services'
import { AuthFailure, CSRF_COOKIE_NAME } from '../../../../lib/auth-policy'
import {
  hasSameOrigin,
  hasValidCsrfToken,
} from '../../../../lib/request-security'

const economicTypes = new Set([
  'income',
  'expense',
  'transfer',
  'debt_payment',
  'refund',
  'adjustment',
  'unknown',
])

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ transactionId: string }> },
) {
  try {
    if (!hasSameOrigin(request.url, request.headers.get('origin'))) {
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
    if (
      typeof body.economicType !== 'string' ||
      !economicTypes.has(body.economicType) ||
      typeof body.category !== 'string' ||
      body.category.trim().length === 0
    ) {
      return NextResponse.json(
        {
          error: 'invalid-classification',
          message: 'Select a valid type and enter a category.',
        },
        { status: 400 },
      )
    }

    const { transactionId } = await context.params
    const { databaseOwner, repositories } = await requireDatabaseOwner()
    await repositories.transactions.correctForUser(
      databaseOwner.id,
      transactionId,
      {
        economicType: body.economicType as
          | 'income'
          | 'expense'
          | 'transfer'
          | 'debt_payment'
          | 'refund'
          | 'adjustment'
          | 'unknown',
        category: body.category.trim(),
      },
    )
    return NextResponse.json({ corrected: true })
  } catch (error) {
    if (error instanceof AuthFailure) {
      return NextResponse.json({ error: error.code }, { status: error.status })
    }
    return NextResponse.json(
      {
        error: 'correction-failed',
        message:
          error instanceof Error
            ? error.message
            : 'The correction could not be saved.',
      },
      { status: 400 },
    )
  }
}
