import 'server-only'

import { randomUUID } from 'node:crypto'

import {
  cloudTaskSmokePayloadSchema,
  plaidSyncTaskPayloadSchema,
} from '@hidmo/contracts'

import { getWebEnvironment } from '@hidmo/config'

type CloudTaskConfig = {
  calculationQueue: string
  location: string
  plaidSyncQueue: string
  projectId: string
  serviceAccountEmail: string
  workerUrl: string
}

type MetadataTokenResponse = {
  access_token: string
  expires_in: number
  token_type: string
}

async function getCloudRunAccessToken() {
  const response = await fetch(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    {
      headers: {
        'metadata-flavor': 'Google',
      },
    },
  )
  if (!response.ok) {
    throw new Error(
      `Unable to read Cloud Run metadata token: HTTP ${response.status}`,
    )
  }

  const token = (await response.json()) as MetadataTokenResponse
  if (
    typeof token.access_token !== 'string' ||
    token.access_token.length === 0
  ) {
    throw new Error('Cloud Run metadata token response did not include a token')
  }

  return token.access_token
}

export function getCloudTaskConfig(): CloudTaskConfig {
  const environment = getWebEnvironment()
  const missing = [
    ['CLOUD_TASKS_LOCATION', environment.CLOUD_TASKS_LOCATION],
    [
      'CLOUD_TASKS_CALCULATION_QUEUE',
      environment.CLOUD_TASKS_CALCULATION_QUEUE,
    ],
    ['CLOUD_TASKS_PLAID_SYNC_QUEUE', environment.CLOUD_TASKS_PLAID_SYNC_QUEUE],
    ['CLOUD_TASKS_WORKER_URL', environment.CLOUD_TASKS_WORKER_URL],
    [
      'CLOUD_TASKS_INVOKER_SERVICE_ACCOUNT_EMAIL',
      environment.CLOUD_TASKS_INVOKER_SERVICE_ACCOUNT_EMAIL,
    ],
  ].filter(([, value]) => value === undefined || value === '')

  if (missing.length > 0) {
    throw new Error(
      `Missing Cloud Tasks configuration: ${missing
        .map(([name]) => name)
        .join(', ')}`,
    )
  }

  return {
    calculationQueue: environment.CLOUD_TASKS_CALCULATION_QUEUE!,
    location: environment.CLOUD_TASKS_LOCATION!,
    plaidSyncQueue: environment.CLOUD_TASKS_PLAID_SYNC_QUEUE!,
    projectId: environment.FIREBASE_PROJECT_ID,
    serviceAccountEmail: environment.CLOUD_TASKS_INVOKER_SERVICE_ACCOUNT_EMAIL!,
    workerUrl: environment.CLOUD_TASKS_WORKER_URL!,
  }
}

async function createHttpTask(input: {
  config: CloudTaskConfig
  endpoint: string
  payload: unknown
  queue: string
}) {
  const accessToken = await getCloudRunAccessToken()
  const parent = `projects/${input.config.projectId}/locations/${input.config.location}/queues/${input.queue}`
  const response = await fetch(
    `https://cloudtasks.googleapis.com/v2/${parent}/tasks`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        task: {
          httpRequest: {
            httpMethod: 'POST',
            url: `${input.config.workerUrl}${input.endpoint}`,
            headers: {
              'content-type': 'application/json',
            },
            body: Buffer.from(JSON.stringify(input.payload)).toString('base64'),
            oidcToken: {
              serviceAccountEmail: input.config.serviceAccountEmail,
              audience: input.config.workerUrl,
            },
          },
        },
      }),
    },
  )
  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(
      `Cloud Tasks createTask failed: HTTP ${response.status} ${errorBody}`,
    )
  }

  return (await response.json()) as { name?: string }
}

export async function enqueueCloudTasksSmokeTask() {
  const config = getCloudTaskConfig()
  const idempotencyKey = `cloud-tasks-smoke:${randomUUID()}`
  const payload = cloudTaskSmokePayloadSchema.parse({
    operation: 'cloud-tasks.smoke',
    schemaVersion: 1,
    idempotencyKey,
  })

  const task = await createHttpTask({
    config,
    endpoint: '/tasks/smoke',
    payload,
    queue: config.calculationQueue,
  })

  return {
    idempotencyKey,
    taskName: task.name ?? '',
  }
}

export async function enqueuePlaidSyncTask(input: {
  userId: string
  connectionId: string
  syncJobId: string
  idempotencyKey: string
}) {
  const config = getCloudTaskConfig()
  const payload = plaidSyncTaskPayloadSchema.parse({
    operation: 'plaid.transactions.sync',
    schemaVersion: 1,
    userId: input.userId,
    connectionId: input.connectionId,
    syncJobId: input.syncJobId,
    idempotencyKey: input.idempotencyKey,
  })
  const task = await createHttpTask({
    config,
    endpoint: '/tasks/plaid-sync',
    payload,
    queue: config.plaidSyncQueue,
  })

  return {
    idempotencyKey: input.idempotencyKey,
    taskName: task.name ?? '',
  }
}
