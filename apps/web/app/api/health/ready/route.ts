import { NextResponse } from 'next/server'

import { getWebEnvironment } from '@hidmo/config'
import { healthResponseSchema, type HealthResponse } from '@hidmo/contracts'
import { checkDatabase, createDatabasePool } from '@hidmo/database'
import { createLogger } from '@hidmo/logging'

export const dynamic = 'force-dynamic'

const logger = createLogger('web')

export async function GET() {
  let pool

  try {
    const environment = getWebEnvironment()
    pool = createDatabasePool(environment.DATABASE_URL)
    await checkDatabase(pool)

    const response: HealthResponse = {
      service: 'web',
      status: 'ok',
      checks: { configuration: 'ok', database: 'ok' },
      timestamp: new Date().toISOString(),
    }

    return NextResponse.json(healthResponseSchema.parse(response))
  } catch (error) {
    logger.error({ err: error }, 'web readiness check failed')

    const response: HealthResponse = {
      service: 'web',
      status: 'error',
      checks: { configuration: 'error', database: 'error' },
      timestamp: new Date().toISOString(),
    }

    return NextResponse.json(healthResponseSchema.parse(response), {
      status: 503,
    })
  } finally {
    await pool?.end()
  }
}
