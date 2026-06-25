import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'

import { healthResponseSchema, type HealthResponse } from '@hidmo/contracts'
import { checkDatabase, type createDatabasePool } from '@hidmo/database'
import type { Logger } from '@hidmo/logging'

type DatabasePool = ReturnType<typeof createDatabasePool>

type ServerDependencies = {
  logger: Logger
  pool: DatabasePool
}

type WorkerResponse = {
  statusCode: number
  body: HealthResponse | { error: string }
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: HealthResponse | { error: string },
) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(body))
}

export async function getWorkerResponse(
  method: string | undefined,
  path: string | undefined,
  { logger, pool }: ServerDependencies,
): Promise<WorkerResponse> {
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

  return { statusCode: 404, body: { error: 'not_found' } }
}

export function createWorkerServer({ logger, pool }: ServerDependencies) {
  return createServer(
    async (request: IncomingMessage, response: ServerResponse) => {
      const path = request.url?.split('?')[0]
      const result = await getWorkerResponse(request.method, path, {
        logger,
        pool,
      })
      sendJson(response, result.statusCode, result.body)
    },
  )
}
