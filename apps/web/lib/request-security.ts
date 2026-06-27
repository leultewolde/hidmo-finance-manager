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

export function hasSameOrigin(
  requestUrl: string,
  origin: string | null,
  headers?: Headers,
) {
  if (origin === null) {
    return false
  }

  const requestOrigin = new URL(requestUrl).origin
  if (requestOrigin === origin) {
    return true
  }

  const forwardedHost = headers?.get('x-forwarded-host')
  const forwardedProto = headers?.get('x-forwarded-proto') ?? 'https'

  if (forwardedHost === null || forwardedHost === undefined) {
    return false
  }

  return `${forwardedProto}://${forwardedHost}` === origin
}
