import { randomUUID } from 'node:crypto'

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { requireDatabaseOwner } from '../../../../../lib/application-services'
import { AuthFailure, CSRF_COOKIE_NAME } from '../../../../../lib/auth-policy'
import {
  hasSameOrigin,
  hasValidCsrfToken,
} from '../../../../../lib/request-security'

const economicTypes = new Set([
  'income',
  'expense',
  'transfer',
  'debt_payment',
  'refund',
  'adjustment',
  'unknown',
])

async function replace(
  request: NextRequest,
  transactionId: string,
  splits: unknown,
) {
  const body = (await request.json()) as Record<string, unknown>
  const csrfToken =
    typeof body.csrfToken === 'string' ? body.csrfToken : undefined
  if (
    !hasSameOrigin(request.url, request.headers.get('origin')) ||
    !hasValidCsrfToken(request.cookies.get(CSRF_COOKIE_NAME)?.value, csrfToken)
  ) {
    return NextResponse.json({ error: 'invalid-request' }, { status: 403 })
  }

  const values = splits === undefined ? body.splits : splits
  if (!Array.isArray(values)) {
    return NextResponse.json(
      {
        error: 'invalid-splits',
        message: 'Provide at least two valid split entries.',
      },
      { status: 400 },
    )
  }
  const parsed = values.map((value) => {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('amountMinor' in value) ||
      typeof value.amountMinor !== 'string' ||
      !('economicType' in value) ||
      typeof value.economicType !== 'string' ||
      !economicTypes.has(value.economicType) ||
      !('category' in value) ||
      typeof value.category !== 'string'
    ) {
      throw new Error('Invalid split')
    }
    return {
      id: randomUUID(),
      transactionId,
      amountMinor: BigInt(value.amountMinor),
      economicType: value.economicType as
        | 'income'
        | 'expense'
        | 'transfer'
        | 'debt_payment'
        | 'refund'
        | 'adjustment'
        | 'unknown',
      category: value.category,
    }
  })

  const { databaseOwner, repositories } = await requireDatabaseOwner()
  await repositories.transactions.replaceSplits(
    databaseOwner.id,
    transactionId,
    parsed,
  )
  return NextResponse.json({ splitCount: parsed.length })
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ transactionId: string }> },
) {
  try {
    return await replace(
      request,
      (await context.params).transactionId,
      undefined,
    )
  } catch (error) {
    if (error instanceof AuthFailure) {
      return NextResponse.json({ error: error.code }, { status: error.status })
    }
    return NextResponse.json(
      {
        error: 'invalid-splits',
        message:
          error instanceof Error
            ? error.message
            : 'The split values are invalid.',
      },
      { status: 400 },
    )
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ transactionId: string }> },
) {
  try {
    return await replace(request, (await context.params).transactionId, [])
  } catch (error) {
    if (error instanceof AuthFailure) {
      return NextResponse.json({ error: error.code }, { status: error.status })
    }
    return NextResponse.json(
      {
        error: 'split-removal-failed',
        message:
          error instanceof Error ? error.message : 'Split removal failed.',
      },
      { status: 400 },
    )
  }
}
