import { randomBytes } from 'node:crypto'

import { NextResponse } from 'next/server'

import { getWebEnvironment } from '@hidmo/config'

import {
  CSRF_COOKIE_NAME,
  csrfCookieOptions,
} from '../../../../lib/auth-policy'

export const dynamic = 'force-dynamic'

export function GET() {
  const environment = getWebEnvironment()
  const token = randomBytes(32).toString('base64url')
  const response = NextResponse.json(
    { csrfToken: token },
    { headers: { 'Cache-Control': 'no-store' } },
  )

  response.cookies.set(
    CSRF_COOKIE_NAME,
    token,
    csrfCookieOptions(environment.APP_ENV),
  )

  return response
}
