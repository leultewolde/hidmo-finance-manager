import { describe, expect, it, vi } from 'vitest'

import { AuthFailure, type VerifiedFirebaseIdentity } from './auth-policy'
import { resolveOwnerSession } from './server-auth'

const ownerIdentity: VerifiedFirebaseIdentity = {
  uid: 'owner-uid',
  email: 'owner@example.com',
  emailVerified: true,
  signInProvider: 'google.com',
  authTime: 1_000,
}

describe('owner application sessions', () => {
  it('rejects a missing session without calling Firebase', async () => {
    const verifySession = vi.fn()

    await expect(
      resolveOwnerSession(undefined, verifySession, 'owner-uid'),
    ).rejects.toEqual(new AuthFailure('invalid-session', 401))
    expect(verifySession).not.toHaveBeenCalled()
  })

  it('rejects invalid, expired, or revoked Firebase sessions', async () => {
    const verifySession = vi
      .fn<(cookie: string) => Promise<VerifiedFirebaseIdentity>>()
      .mockRejectedValue(new Error('Firebase session rejected'))

    await expect(
      resolveOwnerSession('expired-session', verifySession, 'owner-uid'),
    ).rejects.toEqual(new AuthFailure('invalid-session', 401))
  })

  it('rejects a valid Firebase session belonging to another user', async () => {
    const verifySession = vi.fn().mockResolvedValue({
      ...ownerIdentity,
      uid: 'other-uid',
    })

    await expect(
      resolveOwnerSession('valid-session', verifySession, 'owner-uid'),
    ).rejects.toEqual(new AuthFailure('owner-required', 403))
  })

  it('returns only the server-verified owner identity', async () => {
    const verifySession = vi.fn().mockResolvedValue(ownerIdentity)

    await expect(
      resolveOwnerSession('valid-session', verifySession, 'owner-uid'),
    ).resolves.toEqual({
      uid: 'owner-uid',
      email: 'owner@example.com',
    })
  })
})
