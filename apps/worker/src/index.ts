import { getWorkerEnvironment } from '@hidmo/config'
import {
  createDatabase,
  createDatabasePool,
  createRepositories,
} from '@hidmo/database'
import { createLogger } from '@hidmo/logging'
import { createPlaidProvider, parseLocalWrappingKey } from '@hidmo/plaid'
import { refreshClassifications, synchronizePlaidConnection } from '@hidmo/sync'

import { runPlaidSyncJob } from './plaid-sync-handler.js'
import { createWorkerServer, parseAllowedTaskQueues } from './server.js'

const environment = getWorkerEnvironment()
const logger = createLogger('worker', environment.LOG_LEVEL)
const pool = createDatabasePool(environment.DATABASE_URL)
const repositories = createRepositories(createDatabase(pool))
const provider = createPlaidProvider({
  clientId: environment.PLAID_CLIENT_ID,
  secret: environment.PLAID_SECRET,
  environment: environment.PLAID_ENV,
})
const wrappingKey = parseLocalWrappingKey(
  environment.LOCAL_TOKEN_ENCRYPTION_KEY,
)
const server = createWorkerServer({
  allowedTaskQueues: parseAllowedTaskQueues(
    environment.CLOUD_TASKS_ALLOWED_QUEUES,
  ),
  logger,
  plaidSync: async ({ userId, connectionId, syncJobId }) => {
    const result = await runPlaidSyncJob(
      { userId, connectionId, syncJobId },
      {
        markRunning: repositories.syncJobs.markRunning.bind(
          repositories.syncJobs,
        ),
        markSucceeded: repositories.syncJobs.markSucceeded.bind(
          repositories.syncJobs,
        ),
        markFailed: repositories.syncJobs.markFailed.bind(
          repositories.syncJobs,
        ),
        synchronize: ({ userId, connectionId }) =>
          synchronizePlaidConnection({
            userId,
            connectionId,
            provider,
            repositories,
            wrappingKey,
          }),
        refreshClassifications: (userId) =>
          refreshClassifications(userId, repositories),
      },
    )
    logger.info(
      { userId, connectionId, syncJobId, ...result },
      'Plaid transactions synchronized by worker',
    )
    return result
  },
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
