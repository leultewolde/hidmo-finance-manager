import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { analysisPeriodSchema } from '@hidmo/contracts'
import { createLogger } from '@hidmo/logging'

import { requireDatabaseOwner } from '../../../../lib/application-services'
import { AuthFailure, CSRF_COOKIE_NAME } from '../../../../lib/auth-policy'
import { enqueueRecommendationGenerationTask } from '../../../../lib/cloud-tasks'
import {
  hasSameOrigin,
  hasValidCsrfToken,
} from '../../../../lib/request-security'

export const dynamic = 'force-dynamic'

const logger = createLogger('web-recommendations')
const MANUAL_RECOMMENDATION_COOLDOWN_MILLISECONDS = 5 * 60 * 1000

function manualCooldownBucket(now = Date.now()) {
  return Math.floor(now / MANUAL_RECOMMENDATION_COOLDOWN_MILLISECONDS)
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

    const body = (await request.json()) as {
      csrfToken?: unknown
      period?: unknown
    }
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

    const parsedPeriod = analysisPeriodSchema.safeParse(body.period)
    if (!parsedPeriod.success) {
      return NextResponse.json({ error: 'invalid-period' }, { status: 400 })
    }

    if (parsedPeriod.data.startDate > parsedPeriod.data.endDate) {
      return NextResponse.json(
        { error: 'invalid-period-order' },
        { status: 400 },
      )
    }

    const { databaseOwner } = await requireDatabaseOwner()
    const idempotencyKey = [
      'recommendations',
      databaseOwner.id,
      parsedPeriod.data.startDate,
      parsedPeriod.data.endDate,
      manualCooldownBucket().toString(),
    ].join(':')
    const task = await enqueueRecommendationGenerationTask({
      userId: databaseOwner.id,
      period: parsedPeriod.data,
      idempotencyKey,
    })

    logger.info(
      {
        userId: databaseOwner.id,
        period: parsedPeriod.data,
        taskName: task.taskName,
      },
      'Recommendation generation enqueued',
    )

    return NextResponse.json(
      {
        status: 'queued',
        period: parsedPeriod.data,
        ...task,
      },
      { status: 202 },
    )
  } catch (error) {
    if (error instanceof AuthFailure) {
      return NextResponse.json({ error: error.code }, { status: error.status })
    }

    logger.error(
      {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      },
      'Recommendation generation enqueue failed',
    )
    return NextResponse.json(
      { error: 'recommendation-generation-enqueue-failed' },
      { status: 502 },
    )
  }
}
