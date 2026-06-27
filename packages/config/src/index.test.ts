import { describe, expect, it } from 'vitest'

import { getWebEnvironment, getWorkerEnvironment } from './index.js'

const baseEnvironment = {
  APP_ENV: 'test',
  DATABASE_URL: 'postgresql://finance:finance@localhost:5432/finance_manager',
  FIREBASE_OWNER_UID: 'owner-firebase-uid',
  FIREBASE_PROJECT_ID: 'finance-manager-dev-500423',
  LOCAL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  LOG_LEVEL: 'silent',
  PLAID_CLIENT_ID: 'client-id',
  PLAID_ENV: 'sandbox',
  PLAID_SECRET: 'sandbox-secret',
}

describe('environment parsing', () => {
  it('uses safe local port defaults', () => {
    expect(getWebEnvironment(baseEnvironment).WEB_PORT).toBe(3000)
    expect(getWorkerEnvironment(baseEnvironment).WORKER_PORT).toBe(3001)
  })

  it('rejects missing database configuration', () => {
    expect(() => getWebEnvironment({ APP_ENV: 'test' })).toThrow()
  })

  it('rejects missing owner authorization configuration', () => {
    expect(() =>
      getWebEnvironment({
        ...baseEnvironment,
        FIREBASE_OWNER_UID: '',
      }),
    ).toThrow()
  })

  it('coerces configured ports to numbers', () => {
    expect(
      getWorkerEnvironment({
        ...baseEnvironment,
        WORKER_PORT: '4100',
      }).WORKER_PORT,
    ).toBe(4100)
  })

  it('uses the Cloud Run port when an app-specific port is absent', () => {
    expect(
      getWebEnvironment({
        ...baseEnvironment,
        PORT: '8080',
      }).WEB_PORT,
    ).toBe(8080)
    expect(
      getWorkerEnvironment({
        ...baseEnvironment,
        PORT: '8080',
      }).WORKER_PORT,
    ).toBe(8080)
  })

  it('prefers an explicit app-specific port over the Cloud Run port', () => {
    expect(
      getWorkerEnvironment({
        ...baseEnvironment,
        PORT: '8080',
        WORKER_PORT: '4100',
      }).WORKER_PORT,
    ).toBe(4100)
  })
})
