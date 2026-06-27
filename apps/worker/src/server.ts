import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { randomUUID } from 'node:crypto'

import {
  cloudTaskSmokePayloadSchema,
  cloudTaskSmokeResponseSchema,
  healthResponseSchema,
  type CloudTaskSmokeResponse,
  type HealthResponse,
} from '@hidmo/contracts'
import { checkDatabase, type createDatabasePool } from '@hidmo/database'
import type { Logger } from '@hidmo/logging'

type DatabasePool = ReturnType<typeof createDatabasePool>

type ServerDependencies = {
  allowedTaskQueues?: Set<string>
  logger: Logger
  pool: DatabasePool
  taskExecutions?: {
    claim(input: {
      id: string
      idempotencyKey: string
      operation: string
      schemaVersion: number
    }): Promise<boolean>
    complete(id: string): Promise<void>
  }
}

type WorkerResponse = {
  statusCode: number
  body: HealthResponse | CloudTaskSmokeResponse | { error: string }
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: HealthResponse | CloudTaskSmokeResponse | { error: string },
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

async function handleSmokeTask(
  bodyText: string | undefined,
  headers: Record<string, string | string[] | undefined> | undefined,
  { allowedTaskQueues, taskExecutions }: ServerDependencies,
): Promise<WorkerResponse> {
  if (taskExecutions === undefined) {
    return { statusCode: 503, body: { error: 'task_repository_unavailable' } }
  }

  const queueName = getHeader(headers, 'x-cloudtasks-queuename')
  const taskName = getHeader(headers, 'x-cloudtasks-taskname')

  if (queueName === undefined || taskName === undefined) {
    return { statusCode: 401, body: { error: 'missing_cloud_tasks_headers' } }
  }

  if (
    allowedTaskQueues !== undefined &&
    allowedTaskQueues.size > 0 &&
    !allowedTaskQueues.has(queueName)
  ) {
    return { statusCode: 403, body: { error: 'unexpected_task_queue' } }
  }

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
        taskName,
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
      taskName,
    }),
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
