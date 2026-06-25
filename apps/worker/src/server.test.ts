import { describe, expect, it, vi } from 'vitest'

import { createLogger } from '@hidmo/logging'

import { getWorkerResponse } from './server.js'

describe('worker health server', () => {
  it('returns liveness without calling the database', async () => {
    const pool = {
      query: vi.fn(),
    }
    const response = await getWorkerResponse('GET', '/health/live', {
      logger: createLogger('test', 'silent'),
      pool: pool as never,
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).toMatchObject({
      service: 'worker',
      status: 'ok',
    })
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('reports readiness when PostgreSQL responds', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
    }
    const response = await getWorkerResponse('GET', '/health/ready', {
      logger: createLogger('test', 'silent'),
      pool: pool as never,
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).toMatchObject({
      checks: { configuration: 'ok', database: 'ok' },
      service: 'worker',
      status: 'ok',
    })
  })
})
