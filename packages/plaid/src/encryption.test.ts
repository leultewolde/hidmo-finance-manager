import { randomBytes } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  decryptAccessToken,
  encryptAccessToken,
  parseLocalWrappingKey,
} from './encryption.js'

describe('Plaid access-token encryption', () => {
  it('round trips through a per-token data key', () => {
    const wrappingKey = randomBytes(32)
    const envelope = encryptAccessToken('access-sandbox-secret', wrappingKey)

    expect(envelope.encryptedAccessToken).not.toContain('access-sandbox-secret')
    expect(decryptAccessToken(envelope, wrappingKey)).toBe(
      'access-sandbox-secret',
    )
  })

  it('rejects ciphertext modification and the wrong wrapping key', () => {
    const wrappingKey = randomBytes(32)
    const envelope = encryptAccessToken('access-sandbox-secret', wrappingKey)
    const modified = {
      ...envelope,
      encryptedAccessToken: Buffer.from('modified').toString('base64'),
    }

    expect(() => decryptAccessToken(modified, wrappingKey)).toThrow()
    expect(() => decryptAccessToken(envelope, randomBytes(32))).toThrow()
  })

  it('requires exactly 32 base64-encoded bytes', () => {
    const encoded = randomBytes(32).toString('base64')
    expect(parseLocalWrappingKey(encoded)).toHaveLength(32)
    expect(() => parseLocalWrappingKey('not-a-key')).toThrow()
  })
})
