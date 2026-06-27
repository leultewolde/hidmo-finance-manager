import 'server-only'

import { randomUUID } from 'node:crypto'

import { cloudTaskSmokePayloadSchema } from '@hidmo/contracts'

import { getWebEnvironment } from '@hidmo/config'

type CloudTaskConfig = {
  location: string
  projectId: string
  queue: string
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
    location: environment.CLOUD_TASKS_LOCATION!,
    projectId: environment.FIREBASE_PROJECT_ID,
    queue: environment.CLOUD_TASKS_CALCULATION_QUEUE!,
    serviceAccountEmail: environment.CLOUD_TASKS_INVOKER_SERVICE_ACCOUNT_EMAIL!,
    workerUrl: environment.CLOUD_TASKS_WORKER_URL!,
  }
}

export async function enqueueCloudTasksSmokeTask() {
  const config = getCloudTaskConfig()
  const idempotencyKey = `cloud-tasks-smoke:${randomUUID()}`
  const payload = cloudTaskSmokePayloadSchema.parse({
    operation: 'cloud-tasks.smoke',
    schemaVersion: 1,
    idempotencyKey,
  })

  const accessToken = await getCloudRunAccessToken()
  const parent = `projects/${config.projectId}/locations/${config.location}/queues/${config.queue}`
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
            url: `${config.workerUrl}/tasks/smoke`,
            headers: {
              'content-type': 'application/json',
            },
            body: Buffer.from(JSON.stringify(payload)).toString('base64'),
            oidcToken: {
              serviceAccountEmail: config.serviceAccountEmail,
              audience: config.workerUrl,
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

  const task = (await response.json()) as { name?: string }

  return {
    idempotencyKey,
    taskName: task.name ?? '',
  }
}
