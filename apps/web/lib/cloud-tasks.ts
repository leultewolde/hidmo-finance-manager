import 'server-only'

import { randomUUID } from 'node:crypto'

import { CloudTasksClient } from '@google-cloud/tasks'

import { cloudTaskSmokePayloadSchema } from '@hidmo/contracts'

import { getWebEnvironment } from '@hidmo/config'

type CloudTaskConfig = {
  location: string
  projectId: string
  queue: string
  serviceAccountEmail: string
  workerUrl: string
}

const globalServices = globalThis as typeof globalThis & {
  hidmoCloudTasksClient?: CloudTasksClient
}

function getCloudTasksClient() {
  const client = globalServices.hidmoCloudTasksClient ?? new CloudTasksClient()

  if (getWebEnvironment().APP_ENV !== 'production') {
    globalServices.hidmoCloudTasksClient = client
  }

  return client
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
  const client = getCloudTasksClient()
  const parent = client.queuePath(
    config.projectId,
    config.location,
    config.queue,
  )
  const idempotencyKey = `cloud-tasks-smoke:${randomUUID()}`
  const payload = cloudTaskSmokePayloadSchema.parse({
    operation: 'cloud-tasks.smoke',
    schemaVersion: 1,
    idempotencyKey,
  })
  const [task] = await client.createTask({
    parent,
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
  })

  return {
    idempotencyKey,
    taskName: task.name,
  }
}
