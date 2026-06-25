import { describe, expect, it } from 'vitest'

import {
  AuthFailure,
  authorizeOwner,
  csrfCookieOptions,
  requireRecentSignIn,
  sessionCookieOptions,
} from './auth-policy'

const ownerIdentity = {
  uid: 'owner-uid',
  email: 'owner@example.com',
  emailVerified: true,
  signInProvider: 'google.com',
  authTime: 1_000,
}

describe('owner authorization', () => {
  it('accepts only the configured verified Google owner', () => {
    expect(authorizeOwner(ownerIdentity, 'owner-uid')).toEqual({
      uid: 'owner-uid',
      email: 'owner@example.com',
    })
  })

  it('rejects a valid Firebase identity with the wrong UID', () => {
    expect(() => authorizeOwner(ownerIdentity, 'different-owner')).toThrow(
      new AuthFailure('owner-required', 403),
    )
  })

  it.each([{ emailVerified: false }, { signInProvider: 'password' }])(
    'rejects an identity that is not a verified Google user',
    (override) => {
      expect(() =>
        authorizeOwner({ ...ownerIdentity, ...override }, 'owner-uid'),
      ).toThrow(AuthFailure)
    },
  )

  it('rejects an identity without an email address', () => {
    const identityWithoutEmail = {
      uid: ownerIdentity.uid,
      emailVerified: ownerIdentity.emailVerified,
      signInProvider: ownerIdentity.signInProvider,
      authTime: ownerIdentity.authTime,
    }

    expect(() => authorizeOwner(identityWithoutEmail, 'owner-uid')).toThrow(
      AuthFailure,
    )
  })

  it('requires a recently issued Firebase ID token when minting a session', () => {
    expect(() => requireRecentSignIn(ownerIdentity, 1_299)).not.toThrow()
    expect(() => requireRecentSignIn(ownerIdentity, 1_301)).toThrow(
      new AuthFailure('recent-sign-in-required', 401),
    )
  })
})

describe('authentication cookies', () => {
  it('uses secure deployed session cookie settings', () => {
    expect(sessionCookieOptions('production', 'production')).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/',
    })
  })

  it('permits HTTP only for local development', () => {
    expect(sessionCookieOptions('development', 'development').secure).toBe(
      false,
    )
    expect(csrfCookieOptions('development', 'development')).toMatchObject({
      httpOnly: true,
      sameSite: 'strict',
      secure: false,
    })
  })

  it('uses Secure cookies in a deployed Node production runtime', () => {
    expect(sessionCookieOptions('development', 'production').secure).toBe(true)
  })
})
