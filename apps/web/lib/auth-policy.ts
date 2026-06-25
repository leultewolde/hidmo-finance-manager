export const SESSION_COOKIE_NAME = '__session'
export const CSRF_COOKIE_NAME = 'hidmo_csrf'
export const SESSION_DURATION_MS = 5 * 24 * 60 * 60 * 1_000
export const MAX_RECENT_SIGN_IN_AGE_SECONDS = 5 * 60

export type AuthFailureCode =
  | 'invalid-session'
  | 'owner-required'
  | 'recent-sign-in-required'

export class AuthFailure extends Error {
  constructor(
    readonly code: AuthFailureCode,
    readonly status: 401 | 403,
  ) {
    super(code)
    this.name = 'AuthFailure'
  }
}

export interface VerifiedFirebaseIdentity {
  uid: string
  email?: string
  emailVerified: boolean
  signInProvider?: string
  authTime: number
}

export interface OwnerIdentity {
  uid: string
  email: string
}

export function authorizeOwner(
  identity: VerifiedFirebaseIdentity,
  ownerUid: string,
): OwnerIdentity {
  if (
    identity.uid !== ownerUid ||
    identity.signInProvider !== 'google.com' ||
    !identity.emailVerified ||
    identity.email === undefined
  ) {
    throw new AuthFailure('owner-required', 403)
  }

  return { uid: identity.uid, email: identity.email }
}

export function requireRecentSignIn(
  identity: VerifiedFirebaseIdentity,
  nowSeconds = Math.floor(Date.now() / 1_000),
): void {
  if (
    identity.authTime > nowSeconds ||
    nowSeconds - identity.authTime > MAX_RECENT_SIGN_IN_AGE_SECONDS
  ) {
    throw new AuthFailure('recent-sign-in-required', 401)
  }
}

function isSecureRuntime(appEnvironment: string, nodeEnvironment?: string) {
  return appEnvironment === 'production' || nodeEnvironment === 'production'
}

export function sessionCookieOptions(
  appEnvironment: string,
  nodeEnvironment = process.env.NODE_ENV,
) {
  return {
    httpOnly: true,
    maxAge: SESSION_DURATION_MS / 1_000,
    path: '/',
    sameSite: 'lax' as const,
    secure: isSecureRuntime(appEnvironment, nodeEnvironment),
  }
}

export function clearedSessionCookieOptions(
  appEnvironment: string,
  nodeEnvironment = process.env.NODE_ENV,
) {
  return {
    ...sessionCookieOptions(appEnvironment, nodeEnvironment),
    maxAge: 0,
  }
}

export function csrfCookieOptions(
  appEnvironment: string,
  nodeEnvironment = process.env.NODE_ENV,
) {
  return {
    httpOnly: true,
    maxAge: 10 * 60,
    path: '/',
    sameSite: 'strict' as const,
    secure: isSecureRuntime(appEnvironment, nodeEnvironment),
  }
}
