import { getWorkerEnvironment } from '@hidmo/config'
import {
  createDatabase,
  createDatabasePool,
  createRepositories,
} from '@hidmo/database'
import { createLogger } from '@hidmo/logging'

import { createWorkerServer, parseAllowedTaskQueues } from './server.js'

const environment = getWorkerEnvironment()
const logger = createLogger('worker', environment.LOG_LEVEL)
const pool = createDatabasePool(environment.DATABASE_URL)
const repositories = createRepositories(createDatabase(pool))
const server = createWorkerServer({
  allowedTaskQueues: parseAllowedTaskQueues(
    environment.CLOUD_TASKS_ALLOWED_QUEUES,
  ),
  logger,
  pool,
  taskExecutions: repositories.taskExecutions,
})

server.listen(environment.WORKER_PORT, '0.0.0.0', () => {
  logger.info({ port: environment.WORKER_PORT }, 'worker listening')
})

async function shutdown(signal: string) {
  logger.info({ signal }, 'worker shutdown started')
  server.close()
  await pool.end()
}

process.once('SIGINT', () => {
  void shutdown('SIGINT')
})

process.once('SIGTERM', () => {
  void shutdown('SIGTERM')
})
