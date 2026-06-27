import { describe, expect, it } from 'vitest'

import { hasSameOrigin, hasValidCsrfToken } from './request-security'

describe('request security', () => {
  it('accepts matching CSRF cookie and submitted tokens', () => {
    expect(hasValidCsrfToken('same-token', 'same-token')).toBe(true)
  })

  it.each([
    [undefined, 'token'],
    ['token', undefined],
    ['token', 'other'],
    ['', ''],
  ])('rejects missing or mismatched CSRF tokens', (cookie, submitted) => {
    expect(hasValidCsrfToken(cookie, submitted)).toBe(false)
  })

  it('requires an exact request origin match', () => {
    expect(
      hasSameOrigin(
        'http://localhost:3000/api/auth/session',
        'http://localhost:3000',
      ),
    ).toBe(true)
    expect(
      hasSameOrigin(
        'http://localhost:3000/api/auth/session',
        'https://attacker.test',
      ),
    ).toBe(false)
    expect(hasSameOrigin('http://localhost:3000/api/auth/session', null)).toBe(
      false,
    )
  })

  it('accepts a trusted forwarded origin from the deployment proxy', () => {
    const headers = new Headers({
      'x-forwarded-host': 'finance-web-wn5w6w4mva-ue.a.run.app',
      'x-forwarded-proto': 'https',
    })

    expect(
      hasSameOrigin(
        'http://localhost:8080/api/auth/session',
        'https://finance-web-wn5w6w4mva-ue.a.run.app',
        headers,
      ),
    ).toBe(true)
    expect(
      hasSameOrigin(
        'http://localhost:8080/api/auth/session',
        'https://attacker.test',
        headers,
      ),
    ).toBe(false)
  })
})
