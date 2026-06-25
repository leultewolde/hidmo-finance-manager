import { NextResponse } from 'next/server'

import { healthResponseSchema, type HealthResponse } from '@hidmo/contracts'

export const dynamic = 'force-dynamic'

export function GET() {
  const response: HealthResponse = {
    service: 'web',
    status: 'ok',
    timestamp: new Date().toISOString(),
  }

  return NextResponse.json(healthResponseSchema.parse(response))
}
