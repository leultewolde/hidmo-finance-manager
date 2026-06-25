import { cookies } from 'next/headers'

import { getWebEnvironment } from '@hidmo/config'

import {
  AuthFailure,
  authorizeOwner,
  SESSION_COOKIE_NAME,
  type OwnerIdentity,
  type VerifiedFirebaseIdentity,
} from './auth-policy'
import { getFirebaseAdminAuth } from './firebase-admin'

function toIdentity(decodedToken: {
  uid: string
  email?: string
  email_verified?: boolean
  auth_time: number
  firebase?: { sign_in_provider?: string }
}): VerifiedFirebaseIdentity {
  return {
    uid: decodedToken.uid,
    ...(decodedToken.email === undefined ? {} : { email: decodedToken.email }),
    emailVerified: decodedToken.email_verified === true,
    ...(decodedToken.firebase?.sign_in_provider === undefined
      ? {}
      : { signInProvider: decodedToken.firebase.sign_in_provider }),
    authTime: decodedToken.auth_time,
  }
}

export async function verifyOwnerIdToken(idToken: string) {
  let decodedToken

  try {
    decodedToken = await getFirebaseAdminAuth().verifyIdToken(idToken, true)
  } catch {
    throw new AuthFailure('invalid-session', 401)
  }

  const identity = toIdentity(decodedToken)
  const owner = authorizeOwner(identity, getWebEnvironment().FIREBASE_OWNER_UID)

  return { decodedToken, identity, owner }
}

export async function resolveOwnerSession(
  sessionCookie: string | undefined,
  verifySession: (cookie: string) => Promise<VerifiedFirebaseIdentity>,
  ownerUid: string,
): Promise<OwnerIdentity> {
  if (sessionCookie === undefined) {
    throw new AuthFailure('invalid-session', 401)
  }

  try {
    return authorizeOwner(await verifySession(sessionCookie), ownerUid)
  } catch (error) {
    if (error instanceof AuthFailure) {
      throw error
    }
    throw new AuthFailure('invalid-session', 401)
  }
}

export async function requireOwner(): Promise<OwnerIdentity> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value
  const environment = getWebEnvironment()

  return resolveOwnerSession(
    sessionCookie,
    async (cookie) =>
      toIdentity(
        await getFirebaseAdminAuth().verifySessionCookie(cookie, true),
      ),
    environment.FIREBASE_OWNER_UID,
  )
}
