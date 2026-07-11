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

  it('runs a Plaid sync task from the plaid-sync queue', async () => {
    const plaidSync = vi.fn().mockResolvedValue({
      added: 2,
      modified: 1,
      removed: 0,
      classified: 3,
      transferCandidates: 1,
      providerAttempts: 2,
    })

    const response = await getWorkerResponse(
      'POST',
      '/tasks/plaid-sync',
      {
        allowedTaskQueues: new Set(['plaid-sync']),
        logger: createLogger('test', 'silent'),
        plaidSync,
        pool: { query: vi.fn() } as never,
      },
      {
        bodyText: JSON.stringify({
          operation: 'plaid.transactions.sync',
          schemaVersion: 1,
          userId: '00000000-0000-4000-8000-000000000001',
          connectionId: '00000000-0000-4000-8000-000000000002',
          syncJobId: '00000000-0000-4000-8000-000000000003',
          idempotencyKey:
            'plaid-sync:00000000-0000-4000-8000-000000000002:test',
        }),
        headers: {
          'x-cloudtasks-queuename': 'plaid-sync',
          'x-cloudtasks-taskname': 'plaid-sync-test',
        },
      },
    )

    expect(response.statusCode).toBe(200)
    expect(response.body).toMatchObject({
      operation: 'plaid.transactions.sync',
      status: 'completed',
      syncJobId: '00000000-0000-4000-8000-000000000003',
      added: 2,
      classified: 3,
    })
    expect(plaidSync).toHaveBeenCalledWith({
      userId: '00000000-0000-4000-8000-000000000001',
      connectionId: '00000000-0000-4000-8000-000000000002',
      syncJobId: '00000000-0000-4000-8000-000000000003',
    })
  })

  it('rejects Plaid sync tasks from unexpected queues', async () => {
    const response = await getWorkerResponse(
      'POST',
      '/tasks/plaid-sync',
      {
        allowedTaskQueues: new Set(['calculation']),
        logger: createLogger('test', 'silent'),
        plaidSync: vi.fn(),
        pool: { query: vi.fn() } as never,
      },
      {
        bodyText: JSON.stringify({
          operation: 'plaid.transactions.sync',
          schemaVersion: 1,
          userId: '00000000-0000-4000-8000-000000000001',
          connectionId: '00000000-0000-4000-8000-000000000002',
          syncJobId: '00000000-0000-4000-8000-000000000003',
          idempotencyKey:
            'plaid-sync:00000000-0000-4000-8000-000000000002:test',
        }),
        headers: {
          'x-cloudtasks-queuename': 'plaid-sync',
          'x-cloudtasks-taskname': 'plaid-sync-test',
        },
      },
    )

    expect(response.statusCode).toBe(403)
    expect(response.body).toEqual({ error: 'unexpected_task_queue' })
  })

  it('runs a connection deletion task from the deletion queue', async () => {
    const connectionDeletion = vi.fn().mockResolvedValue({
      status: 'completed',
      connectionId: '00000000-0000-4000-8000-000000000002',
      plaidItemRevoked: true,
      localTokenDestroyed: true,
    })

    const response = await getWorkerResponse(
      'POST',
      '/tasks/deletion',
      {
        allowedTaskQueues: new Set(['deletion']),
        connectionDeletion,
        logger: createLogger('test', 'silent'),
        pool: { query: vi.fn() } as never,
      },
      {
        bodyText: JSON.stringify({
          operation: 'deletion.connection',
          schemaVersion: 1,
          userId: '00000000-0000-4000-8000-000000000001',
          connectionId: '00000000-0000-4000-8000-000000000002',
          deletionRequestId: '00000000-0000-4000-8000-000000000003',
          idempotencyKey:
            'deletion:connection:00000000-0000-4000-8000-000000000002:test',
        }),
        headers: {
          'x-cloudtasks-queuename': 'deletion',
          'x-cloudtasks-taskname': 'connection-deletion-test',
        },
      },
    )

    expect(response.statusCode).toBe(200)
    expect(response.body).toMatchObject({
      operation: 'deletion.connection',
      status: 'completed',
      userId: '00000000-0000-4000-8000-000000000001',
      connectionId: '00000000-0000-4000-8000-000000000002',
      deletionRequestId: '00000000-0000-4000-8000-000000000003',
      taskName: 'connection-deletion-test',
      plaidItemRevoked: true,
      localTokenDestroyed: true,
    })
    expect(connectionDeletion).toHaveBeenCalledWith({
      userId: '00000000-0000-4000-8000-000000000001',
      connectionId: '00000000-0000-4000-8000-000000000002',
      deletionRequestId: '00000000-0000-4000-8000-000000000003',
    })
  })

  it('rejects connection deletion tasks from unexpected queues', async () => {
    const response = await getWorkerResponse(
      'POST',
      '/tasks/deletion',
      {
        allowedTaskQueues: new Set(['calculation']),
        connectionDeletion: vi.fn(),
        logger: createLogger('test', 'silent'),
        pool: { query: vi.fn() } as never,
      },
      {
        bodyText: JSON.stringify({
          operation: 'deletion.connection',
          schemaVersion: 1,
          userId: '00000000-0000-4000-8000-000000000001',
          connectionId: '00000000-0000-4000-8000-000000000002',
          deletionRequestId: '00000000-0000-4000-8000-000000000003',
          idempotencyKey:
            'deletion:connection:00000000-0000-4000-8000-000000000002:test',
        }),
        headers: {
          'x-cloudtasks-queuename': 'deletion',
          'x-cloudtasks-taskname': 'connection-deletion-test',
        },
      },
    )

    expect(response.statusCode).toBe(403)
    expect(response.body).toEqual({ error: 'unexpected_task_queue' })
  })

  it('runs a user deletion task from the deletion queue', async () => {
    const userDeletion = vi.fn().mockResolvedValue({
      status: 'completed',
      revokedConnectionCount: 2,
      localTokenDestroyedCount: 2,
      failedConnectionCount: 0,
      userDeleted: true,
    })

    const response = await getWorkerResponse(
      'POST',
      '/tasks/deletion',
      {
        allowedTaskQueues: new Set(['deletion']),
        userDeletion,
        logger: createLogger('test', 'silent'),
        pool: { query: vi.fn() } as never,
      },
      {
        bodyText: JSON.stringify({
          operation: 'deletion.user',
          schemaVersion: 1,
          userId: '00000000-0000-4000-8000-000000000001',
          deletionRequestId: '00000000-0000-4000-8000-000000000003',
          idempotencyKey:
            'deletion:user:00000000-0000-4000-8000-000000000001:test',
        }),
        headers: {
          'x-cloudtasks-queuename': 'deletion',
          'x-cloudtasks-taskname': 'user-deletion-test',
        },
      },
    )

    expect(response.statusCode).toBe(200)
    expect(response.body).toMatchObject({
      operation: 'deletion.user',
      status: 'completed',
      userId: '00000000-0000-4000-8000-000000000001',
      deletionRequestId: '00000000-0000-4000-8000-000000000003',
      taskName: 'user-deletion-test',
      revokedConnectionCount: 2,
      localTokenDestroyedCount: 2,
      failedConnectionCount: 0,
      userDeleted: true,
    })
    expect(userDeletion).toHaveBeenCalledWith({
      userId: '00000000-0000-4000-8000-000000000001',
      deletionRequestId: '00000000-0000-4000-8000-000000000003',
    })
  })

  it('runs a financial analysis task from the ai-analysis queue', async () => {
    const financialAnalysis = vi.fn().mockResolvedValue({
      status: 'generated',
      snapshotId: '00000000-0000-4000-8000-000000000004',
      jobId: '00000000-0000-4000-8000-000000000005',
      inputHash:
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      formulaVersion: 'financial-analysis-summary/v1',
    })

    const response = await getWorkerResponse(
      'POST',
      '/tasks/financial-analysis',
      {
        allowedTaskQueues: new Set(['ai-analysis']),
        financialAnalysis,
        logger: createLogger('test', 'silent'),
        pool: { query: vi.fn() } as never,
      },
      {
        bodyText: JSON.stringify({
          operation: 'financial-analysis.generate',
          schemaVersion: 1,
          userId: '00000000-0000-4000-8000-000000000001',
          period: {
            startDate: '2026-06-01',
            endDate: '2026-06-30',
            label: 'June 2026',
          },
          idempotencyKey:
            'financial-analysis:00000000-0000-4000-8000-000000000001:2026-06-01:2026-06-30',
        }),
        headers: {
          'x-cloudtasks-queuename': 'ai-analysis',
          'x-cloudtasks-taskname': 'financial-analysis-test',
        },
      },
    )

    expect(response.statusCode).toBe(200)
    expect(response.body).toMatchObject({
      operation: 'financial-analysis.generate',
      status: 'generated',
      userId: '00000000-0000-4000-8000-000000000001',
      snapshotId: '00000000-0000-4000-8000-000000000004',
      jobId: '00000000-0000-4000-8000-000000000005',
      formulaVersion: 'financial-analysis-summary/v1',
    })
    expect(financialAnalysis).toHaveBeenCalledWith({
      userId: '00000000-0000-4000-8000-000000000001',
      period: {
        startDate: '2026-06-01',
        endDate: '2026-06-30',
        label: 'June 2026',
      },
    })
  })

  it('rejects financial analysis tasks from unexpected queues', async () => {
    const response = await getWorkerResponse(
      'POST',
      '/tasks/financial-analysis',
      {
        allowedTaskQueues: new Set(['calculation']),
        financialAnalysis: vi.fn(),
        logger: createLogger('test', 'silent'),
        pool: { query: vi.fn() } as never,
      },
      {
        bodyText: JSON.stringify({
          operation: 'financial-analysis.generate',
          schemaVersion: 1,
          userId: '00000000-0000-4000-8000-000000000001',
          period: {
            startDate: '2026-06-01',
            endDate: '2026-06-30',
          },
          idempotencyKey:
            'financial-analysis:00000000-0000-4000-8000-000000000001:2026-06-01:2026-06-30',
        }),
        headers: {
          'x-cloudtasks-queuename': 'ai-analysis',
          'x-cloudtasks-taskname': 'financial-analysis-test',
        },
      },
    )

    expect(response.statusCode).toBe(403)
    expect(response.body).toEqual({ error: 'unexpected_task_queue' })
  })

  it('runs a recommendation generation task from the ai-analysis queue', async () => {
    const recommendations = vi.fn().mockResolvedValue({
      status: 'generated',
      inputHash:
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      formulaVersion: 'financial-analysis-summary/v1',
      policyVersion: 'recommendation-policies/v1',
      recommendationCount: 3,
    })
    const taskExecutions = {
      claim: vi.fn().mockResolvedValue(true),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn(),
    }

    const response = await getWorkerResponse(
      'POST',
      '/tasks/recommendations',
      {
        allowedTaskQueues: new Set(['ai-analysis']),
        logger: createLogger('test', 'silent'),
        pool: { query: vi.fn() } as never,
        recommendations,
        taskExecutions,
      },
      {
        bodyText: JSON.stringify({
          operation: 'recommendations.generate',
          schemaVersion: 1,
          userId: '00000000-0000-4000-8000-000000000001',
          period: {
            startDate: '2026-06-01',
            endDate: '2026-06-30',
            label: 'June 2026',
          },
          idempotencyKey:
            'recommendations:00000000-0000-4000-8000-000000000001:2026-06-01:2026-06-30:1',
        }),
        headers: {
          'x-cloudtasks-queuename': 'ai-analysis',
          'x-cloudtasks-taskname': 'recommendations-test',
        },
      },
    )

    expect(response.statusCode).toBe(200)
    expect(response.body).toMatchObject({
      operation: 'recommendations.generate',
      status: 'generated',
      userId: '00000000-0000-4000-8000-000000000001',
      formulaVersion: 'financial-analysis-summary/v1',
      policyVersion: 'recommendation-policies/v1',
      recommendationCount: 3,
      idempotencyKey:
        'recommendations:00000000-0000-4000-8000-000000000001:2026-06-01:2026-06-30:1',
      taskName: 'recommendations-test',
    })
    expect(taskExecutions.claim).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: '00000000-0000-4000-8000-000000000001',
        operation: 'recommendations.generate',
        schemaVersion: 1,
      }),
    )
    expect(taskExecutions.complete).toHaveBeenCalledOnce()
    expect(recommendations).toHaveBeenCalledWith({
      userId: '00000000-0000-4000-8000-000000000001',
      period: {
        startDate: '2026-06-01',
        endDate: '2026-06-30',
        label: 'June 2026',
      },
    })
  })

  it('treats repeated recommendation task deliveries as successful duplicates', async () => {
    const recommendations = vi.fn()
    const response = await getWorkerResponse(
      'POST',
      '/tasks/recommendations',
      {
        allowedTaskQueues: new Set(['ai-analysis']),
        logger: createLogger('test', 'silent'),
        pool: { query: vi.fn() } as never,
        recommendations,
        taskExecutions: {
          claim: vi.fn().mockResolvedValue(false),
          complete: vi.fn(),
        },
      },
      {
        bodyText: JSON.stringify({
          operation: 'recommendations.generate',
          schemaVersion: 1,
          userId: '00000000-0000-4000-8000-000000000001',
          period: {
            startDate: '2026-06-01',
            endDate: '2026-06-30',
          },
          idempotencyKey:
            'recommendations:00000000-0000-4000-8000-000000000001:2026-06-01:2026-06-30:1',
        }),
        headers: {
          'x-cloudtasks-queuename': 'ai-analysis',
          'x-cloudtasks-taskname': 'recommendations-test',
        },
      },
    )

    expect(response.statusCode).toBe(200)
    expect(response.body).toMatchObject({
      operation: 'recommendations.generate',
      status: 'duplicate',
      taskName: 'recommendations-test',
    })
    expect(recommendations).not.toHaveBeenCalled()
  })

  it('rejects recommendation generation tasks from unexpected queues', async () => {
    const response = await getWorkerResponse(
      'POST',
      '/tasks/recommendations',
      {
        allowedTaskQueues: new Set(['calculation']),
        logger: createLogger('test', 'silent'),
        pool: { query: vi.fn() } as never,
        recommendations: vi.fn(),
        taskExecutions: {
          claim: vi.fn(),
          complete: vi.fn(),
        },
      },
      {
        bodyText: JSON.stringify({
          operation: 'recommendations.generate',
          schemaVersion: 1,
          userId: '00000000-0000-4000-8000-000000000001',
          period: {
            startDate: '2026-06-01',
            endDate: '2026-06-30',
          },
          idempotencyKey:
            'recommendations:00000000-0000-4000-8000-000000000001:2026-06-01:2026-06-30:1',
        }),
        headers: {
          'x-cloudtasks-queuename': 'ai-analysis',
          'x-cloudtasks-taskname': 'recommendations-test',
        },
      },
    )

    expect(response.statusCode).toBe(403)
    expect(response.body).toEqual({ error: 'unexpected_task_queue' })
  })
})
