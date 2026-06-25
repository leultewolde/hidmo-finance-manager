import { z } from 'zod'

const commonEnvironmentSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url().startsWith('postgresql://'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
})

const webEnvironmentSchema = commonEnvironmentSchema.extend({
  WEB_PORT: z.coerce.number().int().positive().max(65_535).default(3000),
})

const workerEnvironmentSchema = commonEnvironmentSchema.extend({
  WORKER_PORT: z.coerce.number().int().positive().max(65_535).default(3001),
})

export type WebEnvironment = z.infer<typeof webEnvironmentSchema>
export type WorkerEnvironment = z.infer<typeof workerEnvironmentSchema>

export function getWebEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): WebEnvironment {
  return webEnvironmentSchema.parse(environment)
}

export function getWorkerEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): WorkerEnvironment {
  return workerEnvironmentSchema.parse(environment)
}
