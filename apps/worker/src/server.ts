import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { randomUUID } from 'node:crypto'

import {
  cloudTaskSmokePayloadSchema,
  cloudTaskSmokeResponseSchema,
  connectionDeletionTaskPayloadSchema,
  connectionDeletionTaskResponseSchema,
  financialAnalysisTaskPayloadSchema,
  financialAnalysisTaskResponseSchema,
  healthResponseSchema,
  plaidSyncTaskPayloadSchema,
  plaidSyncTaskResponseSchema,
  recommendationGenerationTaskPayloadSchema,
  recommendationGenerationTaskResponseSchema,
  type CloudTaskSmokeResponse,
  type ConnectionDeletionTaskResponse,
  type FinancialAnalysisTaskResponse,
  type HealthResponse,
  type PlaidSyncTaskResponse,
  type RecommendationGenerationTaskResponse,
  userDeletionTaskPayloadSchema,
  userDeletionTaskResponseSchema,
  type UserDeletionTaskResponse,
} from '@hidmo/contracts'
import { checkDatabase, type createDatabasePool } from '@hidmo/database'
import type { Logger } from '@hidmo/logging'

type DatabasePool = ReturnType<typeof createDatabasePool>

type ServerDependencies = {
  allowedTaskQueues?: Set<string>
  financialAnalysis?: (input: {
    userId: string
    period: {
      startDate: string
      endDate: string
      label?: string
    }
  }) => Promise<{
    status: 'generated' | 'reused'
    snapshotId: string
    jobId?: string
    inputHash: string
    formulaVersion: string
  }>
  recommendations?: (input: {
    userId: string
    period: {
      startDate: string
      endDate: string
      label?: string
    }
  }) => Promise<{
    status: 'generated' | 'reused' | 'no_candidates'
    inputHash: string
    formulaVersion: string
    policyVersion: string
    recommendationCount: number
  }>
  logger: Logger
  connectionDeletion?: (input: {
    userId: string
    connectionId: string
    deletionRequestId: string
  }) => Promise<{
    status: 'completed' | 'already_completed'
    connectionId: string
    plaidItemRevoked: boolean
    localTokenDestroyed: boolean
    plaidErrorCode?: string
    tokenErrorCode?: string
  }>
  userDeletion?: (input: {
    userId: string
    deletionRequestId: string
  }) => Promise<{
    status: 'completed' | 'already_completed'
    revokedConnectionCount: number
    localTokenDestroyedCount: number
    failedConnectionCount: number
    userDeleted: boolean
  }>
  plaidSync?: (input: {
    userId: string
    connectionId: string
    syncJobId: string
  }) => Promise<{
    added: number
    modified: number
    removed: number
    classified: number
    transferCandidates: number
    providerAttempts: number
  }>
  pool: DatabasePool
  taskExecutions?: {
    claim(input: {
      id: string
      userId?: string
      idempotencyKey: string
      operation: string
      schemaVersion: number
    }): Promise<boolean>
    complete(id: string): Promise<void>
    fail?(id: string, errorCode: string, attemptCount: number): Promise<void>
  }
}

type WorkerResponse = {
  statusCode: number
  body:
    | HealthResponse
    | CloudTaskSmokeResponse
    | ConnectionDeletionTaskResponse
    | UserDeletionTaskResponse
    | FinancialAnalysisTaskResponse
    | PlaidSyncTaskResponse
    | RecommendationGenerationTaskResponse
    | { error: string }
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body:
    | HealthResponse
    | CloudTaskSmokeResponse
    | ConnectionDeletionTaskResponse
    | UserDeletionTaskResponse
    | FinancialAnalysisTaskResponse
    | PlaidSyncTaskResponse
    | RecommendationGenerationTaskResponse
    | { error: string },
) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(body))
}

function getHeader(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
) {
  const value = headers?.[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

function parseAllowedQueues(value: string | undefined) {
  return new Set(
    (value ?? '')
      .split(',')
      .map((queue) => queue.trim())
      .filter(Boolean),
  )
}

export function parseAllowedTaskQueues(value: string | undefined) {
  return parseAllowedQueues(value)
}

function validateCloudTasksRequest(
  headers: Record<string, string | string[] | undefined> | undefined,
  allowedTaskQueues: Set<string> | undefined,
):
  | { ok: true; queueName: string; taskName: string }
  | { ok: false; response: WorkerResponse } {
  const queueName = getHeader(headers, 'x-cloudtasks-queuename')
  const taskName = getHeader(headers, 'x-cloudtasks-taskname')

  if (queueName === undefined || taskName === undefined) {
    return {
      ok: false,
      response: {
        statusCode: 401,
        body: { error: 'missing_cloud_tasks_headers' },
      },
    }
  }

  if (
    allowedTaskQueues !== undefined &&
    allowedTaskQueues.size > 0 &&
    !allowedTaskQueues.has(queueName)
  ) {
    return {
      ok: false,
      response: { statusCode: 403, body: { error: 'unexpected_task_queue' } },
    }
  }

  return { ok: true, queueName, taskName }
}

async function handleSmokeTask(
  bodyText: string | undefined,
  headers: Record<string, string | string[] | undefined> | undefined,
  { allowedTaskQueues, taskExecutions }: ServerDependencies,
): Promise<WorkerResponse> {
  if (taskExecutions === undefined) {
    return { statusCode: 503, body: { error: 'task_repository_unavailable' } }
  }

  const validation = validateCloudTasksRequest(headers, allowedTaskQueues)
  if (!validation.ok) return validation.response

  const parsed = cloudTaskSmokePayloadSchema.safeParse(
    bodyText === undefined || bodyText.length === 0
      ? undefined
      : JSON.parse(bodyText),
  )
  if (!parsed.success) {
    return { statusCode: 400, body: { error: 'invalid_task_payload' } }
  }

  const taskExecutionId = randomUUID()
  const claimed = await taskExecutions.claim({
    id: taskExecutionId,
    idempotencyKey: parsed.data.idempotencyKey,
    operation: parsed.data.operation,
    schemaVersion: parsed.data.schemaVersion,
  })

  if (!claimed) {
    return {
      statusCode: 200,
      body: cloudTaskSmokeResponseSchema.parse({
        status: 'duplicate',
        operation: parsed.data.operation,
        idempotencyKey: parsed.data.idempotencyKey,
        taskName: validation.taskName,
      }),
    }
  }

  await taskExecutions.complete(taskExecutionId)
  return {
    statusCode: 200,
    body: cloudTaskSmokeResponseSchema.parse({
      status: 'completed',
      operation: parsed.data.operation,
      idempotencyKey: parsed.data.idempotencyKey,
      taskName: validation.taskName,
    }),
  }
}

async function handlePlaidSyncTask(
  bodyText: string | undefined,
  headers: Record<string, string | string[] | undefined> | undefined,
  { allowedTaskQueues, plaidSync }: ServerDependencies,
): Promise<WorkerResponse> {
  if (plaidSync === undefined) {
    return { statusCode: 503, body: { error: 'plaid_sync_unavailable' } }
  }

  const validation = validateCloudTasksRequest(headers, allowedTaskQueues)
  if (!validation.ok) return validation.response

  const parsed = plaidSyncTaskPayloadSchema.safeParse(
    bodyText === undefined || bodyText.length === 0
      ? undefined
      : JSON.parse(bodyText),
  )
  if (!parsed.success) {
    return { statusCode: 400, body: { error: 'invalid_task_payload' } }
  }

  const result = await plaidSync({
    userId: parsed.data.userId,
    connectionId: parsed.data.connectionId,
    syncJobId: parsed.data.syncJobId,
  })

  return {
    statusCode: 200,
    body: plaidSyncTaskResponseSchema.parse({
      status: 'completed',
      operation: parsed.data.operation,
      userId: parsed.data.userId,
      connectionId: parsed.data.connectionId,
      syncJobId: parsed.data.syncJobId,
      ...result,
    }),
  }
}

async function handleConnectionDeletionTask(
  bodyText: string | undefined,
  headers: Record<string, string | string[] | undefined> | undefined,
  { allowedTaskQueues, connectionDeletion, userDeletion }: ServerDependencies,
): Promise<WorkerResponse> {
  const validation = validateCloudTasksRequest(headers, allowedTaskQueues)
  if (!validation.ok) return validation.response

  const rawPayload =
    bodyText === undefined || bodyText.length === 0
      ? undefined
      : JSON.parse(bodyText)

  const operation =
    typeof rawPayload === 'object' &&
    rawPayload !== null &&
    'operation' in rawPayload
      ? rawPayload.operation
      : undefined

  if (operation === 'deletion.user') {
    if (userDeletion === undefined) {
      return {
        statusCode: 503,
        body: { error: 'user_deletion_unavailable' },
      }
    }

    const parsed = userDeletionTaskPayloadSchema.safeParse(rawPayload)
    if (!parsed.success) {
      return { statusCode: 400, body: { error: 'invalid_task_payload' } }
    }

    const result = await userDeletion({
      userId: parsed.data.userId,
      deletionRequestId: parsed.data.deletionRequestId,
    })

    return {
      statusCode: 200,
      body: userDeletionTaskResponseSchema.parse({
        status: result.status,
        operation: parsed.data.operation,
        userId: parsed.data.userId,
        deletionRequestId: parsed.data.deletionRequestId,
        idempotencyKey: parsed.data.idempotencyKey,
        taskName: validation.taskName,
        revokedConnectionCount: result.revokedConnectionCount,
        localTokenDestroyedCount: result.localTokenDestroyedCount,
        failedConnectionCount: result.failedConnectionCount,
        userDeleted: result.userDeleted,
      }),
    }
  }

  if (operation !== 'deletion.connection') {
    return { statusCode: 400, body: { error: 'invalid_task_payload' } }
  }

  if (connectionDeletion === undefined) {
    return {
      statusCode: 503,
      body: { error: 'connection_deletion_unavailable' },
    }
  }

  const parsed = connectionDeletionTaskPayloadSchema.safeParse(rawPayload)
  if (!parsed.success) {
    return { statusCode: 400, body: { error: 'invalid_task_payload' } }
  }

  const result = await connectionDeletion({
    userId: parsed.data.userId,
    connectionId: parsed.data.connectionId,
    deletionRequestId: parsed.data.deletionRequestId,
  })

  return {
    statusCode: 200,
    body: connectionDeletionTaskResponseSchema.parse({
      status: result.status,
      operation: parsed.data.operation,
      userId: parsed.data.userId,
      connectionId: parsed.data.connectionId,
      deletionRequestId: parsed.data.deletionRequestId,
      idempotencyKey: parsed.data.idempotencyKey,
      taskName: validation.taskName,
      plaidItemRevoked: result.plaidItemRevoked,
      localTokenDestroyed: result.localTokenDestroyed,
      ...(result.plaidErrorCode === undefined
        ? {}
        : { plaidErrorCode: result.plaidErrorCode }),
      ...(result.tokenErrorCode === undefined
        ? {}
        : { tokenErrorCode: result.tokenErrorCode }),
    }),
  }
}

async function handleFinancialAnalysisTask(
  bodyText: string | undefined,
  headers: Record<string, string | string[] | undefined> | undefined,
  { allowedTaskQueues, financialAnalysis }: ServerDependencies,
): Promise<WorkerResponse> {
  if (financialAnalysis === undefined) {
    return {
      statusCode: 503,
      body: { error: 'financial_analysis_unavailable' },
    }
  }

  const validation = validateCloudTasksRequest(headers, allowedTaskQueues)
  if (!validation.ok) return validation.response

  const parsed = financialAnalysisTaskPayloadSchema.safeParse(
    bodyText === undefined || bodyText.length === 0
      ? undefined
      : JSON.parse(bodyText),
  )
  if (!parsed.success) {
    return { statusCode: 400, body: { error: 'invalid_task_payload' } }
  }

  const period = {
    startDate: parsed.data.period.startDate,
    endDate: parsed.data.period.endDate,
    ...(parsed.data.period.label === undefined
      ? {}
      : { label: parsed.data.period.label }),
  }
  const result = await financialAnalysis({
    userId: parsed.data.userId,
    period,
  })

  return {
    statusCode: 200,
    body: financialAnalysisTaskResponseSchema.parse({
      status: result.status,
      operation: parsed.data.operation,
      userId: parsed.data.userId,
      period,
      snapshotId: result.snapshotId,
      ...(result.jobId === undefined ? {} : { jobId: result.jobId }),
      inputHash: result.inputHash,
      formulaVersion: result.formulaVersion,
    }),
  }
}

async function handleRecommendationGenerationTask(
  bodyText: string | undefined,
  headers: Record<string, string | string[] | undefined> | undefined,
  { allowedTaskQueues, recommendations, taskExecutions }: ServerDependencies,
): Promise<WorkerResponse> {
  if (recommendations === undefined) {
    return {
      statusCode: 503,
      body: { error: 'recommendations_unavailable' },
    }
  }
  if (taskExecutions === undefined) {
    return { statusCode: 503, body: { error: 'task_repository_unavailable' } }
  }

  const validation = validateCloudTasksRequest(headers, allowedTaskQueues)
  if (!validation.ok) return validation.response

  const parsed = recommendationGenerationTaskPayloadSchema.safeParse(
    bodyText === undefined || bodyText.length === 0
      ? undefined
      : JSON.parse(bodyText),
  )
  if (!parsed.success) {
    return { statusCode: 400, body: { error: 'invalid_task_payload' } }
  }

  const taskExecutionId = randomUUID()
  const claimed = await taskExecutions.claim({
    id: taskExecutionId,
    userId: parsed.data.userId,
    idempotencyKey: parsed.data.idempotencyKey,
    operation: parsed.data.operation,
    schemaVersion: parsed.data.schemaVersion,
  })

  const period = {
    startDate: parsed.data.period.startDate,
    endDate: parsed.data.period.endDate,
    ...(parsed.data.period.label === undefined
      ? {}
      : { label: parsed.data.period.label }),
  }

  if (!claimed) {
    return {
      statusCode: 200,
      body: recommendationGenerationTaskResponseSchema.parse({
        status: 'duplicate',
        operation: parsed.data.operation,
        userId: parsed.data.userId,
        period,
        idempotencyKey: parsed.data.idempotencyKey,
        taskName: validation.taskName,
      }),
    }
  }

  try {
    const result = await recommendations({
      userId: parsed.data.userId,
      period,
    })
    await taskExecutions.complete(taskExecutionId)

    return {
      statusCode: 200,
      body: recommendationGenerationTaskResponseSchema.parse({
        status: result.status,
        operation: parsed.data.operation,
        userId: parsed.data.userId,
        period,
        idempotencyKey: parsed.data.idempotencyKey,
        taskName: validation.taskName,
        inputHash: result.inputHash,
        formulaVersion: result.formulaVersion,
        policyVersion: result.policyVersion,
        recommendationCount: result.recommendationCount,
      }),
    }
  } catch (error) {
    await taskExecutions.fail?.(
      taskExecutionId,
      'RECOMMENDATION_TASK_FAILED',
      1,
    )
    throw error
  }
}

export async function getWorkerResponse(
  method: string | undefined,
  path: string | undefined,
  dependencies: ServerDependencies,
  request?: {
    bodyText?: string
    headers?: Record<string, string | string[] | undefined>
  },
): Promise<WorkerResponse> {
  const { logger, pool } = dependencies
  if (method === 'GET' && path === '/health/live') {
    return {
      statusCode: 200,
      body: healthResponseSchema.parse({
        service: 'worker',
        status: 'ok',
        timestamp: new Date().toISOString(),
      }),
    }
  }

  if (method === 'GET' && path === '/health/ready') {
    try {
      await checkDatabase(pool)
      return {
        statusCode: 200,
        body: healthResponseSchema.parse({
          service: 'worker',
          status: 'ok',
          checks: { configuration: 'ok', database: 'ok' },
          timestamp: new Date().toISOString(),
        }),
      }
    } catch (error) {
      logger.error({ err: error }, 'worker readiness check failed')
      return {
        statusCode: 503,
        body: healthResponseSchema.parse({
          service: 'worker',
          status: 'error',
          checks: { configuration: 'ok', database: 'error' },
          timestamp: new Date().toISOString(),
        }),
      }
    }
  }

  if (method === 'POST' && path === '/tasks/smoke') {
    try {
      return await handleSmokeTask(
        request?.bodyText,
        request?.headers,
        dependencies,
      )
    } catch (error) {
      logger.error({ err: error }, 'worker smoke task failed')
      return { statusCode: 400, body: { error: 'invalid_task_request' } }
    }
  }

  if (method === 'POST' && path === '/tasks/plaid-sync') {
    try {
      return await handlePlaidSyncTask(
        request?.bodyText,
        request?.headers,
        dependencies,
      )
    } catch (error) {
      logger.error({ err: error }, 'worker Plaid sync task failed')
      return { statusCode: 500, body: { error: 'plaid_sync_task_failed' } }
    }
  }

  if (method === 'POST' && path === '/tasks/deletion') {
    try {
      return await handleConnectionDeletionTask(
        request?.bodyText,
        request?.headers,
        dependencies,
      )
    } catch (error) {
      logger.error({ err: error }, 'worker connection deletion task failed')
      return {
        statusCode: 500,
        body: { error: 'connection_deletion_task_failed' },
      }
    }
  }

  if (method === 'POST' && path === '/tasks/financial-analysis') {
    try {
      return await handleFinancialAnalysisTask(
        request?.bodyText,
        request?.headers,
        dependencies,
      )
    } catch (error) {
      logger.error({ err: error }, 'worker financial analysis task failed')
      return {
        statusCode: 500,
        body: { error: 'financial_analysis_task_failed' },
      }
    }
  }

  if (method === 'POST' && path === '/tasks/recommendations') {
    try {
      return await handleRecommendationGenerationTask(
        request?.bodyText,
        request?.headers,
        dependencies,
      )
    } catch (error) {
      logger.error(
        { err: error },
        'worker recommendation generation task failed',
      )
      return {
        statusCode: 500,
        body: { error: 'recommendation_generation_task_failed' },
      }
    }
  }

  return { statusCode: 404, body: { error: 'not_found' } }
}

async function readRequestBody(request: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

export function createWorkerServer(dependencies: ServerDependencies) {
  return createServer(
    async (request: IncomingMessage, response: ServerResponse) => {
      const path = request.url?.split('?')[0]
      const bodyText =
        request.method === 'POST' ? await readRequestBody(request) : undefined
      const result = await getWorkerResponse(
        request.method,
        path,
        dependencies,
        {
          ...(bodyText === undefined ? {} : { bodyText }),
          headers: request.headers,
        },
      )
      sendJson(response, result.statusCode, result.body)
    },
  )
}
