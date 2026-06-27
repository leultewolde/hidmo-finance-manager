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

  it('rejects smoke tasks without Cloud Tasks headers', async () => {
    const response = await getWorkerResponse(
      'POST',
      '/tasks/smoke',
      {
        logger: createLogger('test', 'silent'),
        pool: { query: vi.fn() } as never,
        taskExecutions: {
          claim: vi.fn(),
          complete: vi.fn(),
        },
      },
      {
        bodyText: JSON.stringify({
          operation: 'cloud-tasks.smoke',
          schemaVersion: 1,
          idempotencyKey: 'test',
        }),
        headers: {},
      },
    )

    expect(response.statusCode).toBe(401)
    expect(response.body).toEqual({ error: 'missing_cloud_tasks_headers' })
  })

  it('records a smoke task once', async () => {
    const taskExecutions = {
      claim: vi.fn().mockResolvedValue(true),
      complete: vi.fn().mockResolvedValue(undefined),
    }

    const response = await getWorkerResponse(
      'POST',
      '/tasks/smoke',
      {
        allowedTaskQueues: new Set(['calculation']),
        logger: createLogger('test', 'silent'),
        pool: { query: vi.fn() } as never,
        taskExecutions,
      },
      {
        bodyText: JSON.stringify({
          operation: 'cloud-tasks.smoke',
          schemaVersion: 1,
          idempotencyKey: 'deploy-smoke:test',
        }),
        headers: {
          'x-cloudtasks-queuename': 'calculation',
          'x-cloudtasks-taskname': 'deploy-smoke-test',
        },
      },
    )

    expect(response.statusCode).toBe(200)
    expect(response.body).toMatchObject({
      idempotencyKey: 'deploy-smoke:test',
      operation: 'cloud-tasks.smoke',
      status: 'completed',
      taskName: 'deploy-smoke-test',
    })
    expect(taskExecutions.claim).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'deploy-smoke:test',
        operation: 'cloud-tasks.smoke',
        schemaVersion: 1,
      }),
    )
    expect(taskExecutions.complete).toHaveBeenCalledOnce()
  })

  it('treats repeated smoke task deliveries as successful duplicates', async () => {
    const response = await getWorkerResponse(
      'POST',
      '/tasks/smoke',
      {
        allowedTaskQueues: new Set(['calculation']),
        logger: createLogger('test', 'silent'),
        pool: { query: vi.fn() } as never,
        taskExecutions: {
          claim: vi.fn().mockResolvedValue(false),
          complete: vi.fn(),
        },
      },
      {
        bodyText: JSON.stringify({
          operation: 'cloud-tasks.smoke',
          schemaVersion: 1,
          idempotencyKey: 'deploy-smoke:test',
        }),
        headers: {
          'x-cloudtasks-queuename': 'calculation',
          'x-cloudtasks-taskname': 'deploy-smoke-test',
        },
      },
    )

    expect(response.statusCode).toBe(200)
    expect(response.body).toMatchObject({ status: 'duplicate' })
  })
})
