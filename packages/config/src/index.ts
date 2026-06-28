import { z } from 'zod'

const commonEnvironmentSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url().startsWith('postgresql://'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
})

const webEnvironmentSchema = commonEnvironmentSchema.extend({
  CLOUD_TASKS_CALCULATION_QUEUE: z.string().min(1).optional(),
  CLOUD_TASKS_INVOKER_SERVICE_ACCOUNT_EMAIL: z.email().optional(),
  CLOUD_TASKS_LOCATION: z.string().min(1).optional(),
  CLOUD_TASKS_PLAID_SYNC_QUEUE: z.string().min(1).optional(),
  CLOUD_TASKS_WORKER_URL: z.url().optional(),
  FIREBASE_OWNER_UID: z.string().min(1),
  FIREBASE_PROJECT_ID: z.string().min(1),
  LOCAL_TOKEN_ENCRYPTION_KEY: z.string().refine((value) => {
    const decoded = Buffer.from(value, 'base64')
    return decoded.length === 32 && decoded.toString('base64') === value
  }, 'LOCAL_TOKEN_ENCRYPTION_KEY must be 32 base64-encoded bytes'),
  PLAID_CLIENT_ID: z.string().min(1),
  PLAID_ENV: z
    .enum(['sandbox', 'development', 'production'])
    .default('sandbox'),
  PLAID_SECRET: z.string().min(1),
  WEB_PORT: z.coerce.number().int().positive().max(65_535).default(3000),
})

const workerEnvironmentSchema = commonEnvironmentSchema.extend({
  CLOUD_TASKS_ALLOWED_QUEUES: z.string().optional(),
  LOCAL_TOKEN_ENCRYPTION_KEY: z.string().refine((value) => {
    const decoded = Buffer.from(value, 'base64')
    return decoded.length === 32 && decoded.toString('base64') === value
  }, 'LOCAL_TOKEN_ENCRYPTION_KEY must be 32 base64-encoded bytes'),
  PLAID_CLIENT_ID: z.string().min(1),
  PLAID_ENV: z
    .enum(['sandbox', 'development', 'production'])
    .default('sandbox'),
  PLAID_SECRET: z.string().min(1),
  WORKER_PORT: z.coerce.number().int().positive().max(65_535).default(3001),
})

export type WebEnvironment = z.infer<typeof webEnvironmentSchema>
export type WorkerEnvironment = z.infer<typeof workerEnvironmentSchema>

export function getWebEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): WebEnvironment {
  return webEnvironmentSchema.parse({
    ...environment,
    WEB_PORT: environment.WEB_PORT ?? environment.PORT,
  })
}

export function getWorkerEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): WorkerEnvironment {
  return workerEnvironmentSchema.parse({
    ...environment,
    WORKER_PORT: environment.WORKER_PORT ?? environment.PORT,
  })
}
