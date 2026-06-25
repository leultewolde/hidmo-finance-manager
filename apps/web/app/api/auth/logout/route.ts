import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { getWebEnvironment } from '@hidmo/config'

import {
  clearedSessionCookieOptions,
  SESSION_COOKIE_NAME,
} from '../../../../lib/auth-policy'
import { hasSameOrigin } from '../../../../lib/request-security'

export const dynamic = 'force-dynamic'

export function POST(request: NextRequest) {
  if (!hasSameOrigin(request.url, request.headers.get('origin'))) {
    return NextResponse.json({ error: 'invalid-origin' }, { status: 403 })
  }

  const response = NextResponse.json({ signedOut: true })
  response.cookies.set(
    SESSION_COOKIE_NAME,
    '',
    clearedSessionCookieOptions(getWebEnvironment().APP_ENV),
  )

  return response
}
