import { timingSafeEqual } from 'node:crypto'

export function hasValidCsrfToken(
  cookieToken: string | undefined,
  submittedToken: string | undefined,
): boolean {
  if (
    cookieToken === undefined ||
    submittedToken === undefined ||
    cookieToken.length === 0 ||
    cookieToken.length !== submittedToken.length
  ) {
    return false
  }

  return timingSafeEqual(Buffer.from(cookieToken), Buffer.from(submittedToken))
}

export function hasSameOrigin(requestUrl: string, origin: string | null) {
  return origin !== null && new URL(requestUrl).origin === origin
}
