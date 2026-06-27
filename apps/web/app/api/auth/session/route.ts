import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { getWebEnvironment } from '@hidmo/config'
import { createLogger } from '@hidmo/logging'

import {
  AuthFailure,
  CSRF_COOKIE_NAME,
  requireRecentSignIn,
  SESSION_COOKIE_NAME,
  SESSION_DURATION_MS,
  sessionCookieOptions,
} from '../../../../lib/auth-policy'
import { getFirebaseAdminAuth } from '../../../../lib/firebase-admin'
import {
  hasSameOrigin,
  hasValidCsrfToken,
} from '../../../../lib/request-security'
import { verifyOwnerIdToken } from '../../../../lib/server-auth'

export const dynamic = 'force-dynamic'

const logger = createLogger('web-auth')

interface SessionRequest {
  csrfToken?: unknown
  idToken?: unknown
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

    const body = (await request.json()) as SessionRequest
    const csrfToken =
      typeof body.csrfToken === 'string' ? body.csrfToken : undefined
    const idToken = typeof body.idToken === 'string' ? body.idToken : undefined

    if (
      !hasValidCsrfToken(
        request.cookies.get(CSRF_COOKIE_NAME)?.value,
        csrfToken,
      )
    ) {
      return NextResponse.json({ error: 'invalid-csrf-token' }, { status: 403 })
    }

    if (idToken === undefined) {
      return NextResponse.json({ error: 'missing-id-token' }, { status: 400 })
    }

    const { decodedToken, identity, owner } = await verifyOwnerIdToken(idToken)
    requireRecentSignIn(identity)

    const sessionCookie = await getFirebaseAdminAuth().createSessionCookie(
      idToken,
      { expiresIn: SESSION_DURATION_MS },
    )
    const environment = getWebEnvironment()
    const response = NextResponse.json({ email: owner.email })

    response.cookies.set(
      SESSION_COOKIE_NAME,
      sessionCookie,
      sessionCookieOptions(environment.APP_ENV),
    )
    response.cookies.delete(CSRF_COOKIE_NAME)

    logger.info(
      { firebaseUid: decodedToken.uid },
      'owner application session created',
    )

    return response
  } catch (error) {
    if (error instanceof AuthFailure) {
      logger.warn({ authFailure: error.code }, 'application session rejected')
      return NextResponse.json({ error: error.code }, { status: error.status })
    }

    logger.error({ err: error }, 'application session creation failed')
    return NextResponse.json(
      { error: 'session-creation-failed' },
      { status: 500 },
    )
  }
}
