import { z } from 'zod'

export const serviceNameSchema = z.enum(['web', 'worker'])

export const healthResponseSchema = z.object({
  service: serviceNameSchema,
  status: z.enum(['ok', 'error']),
  checks: z.record(z.string(), z.enum(['ok', 'error'])).optional(),
  timestamp: z.iso.datetime(),
})

export type HealthResponse = z.infer<typeof healthResponseSchema>

export const cloudTaskSmokePayloadSchema = z.object({
  operation: z.literal('cloud-tasks.smoke'),
  schemaVersion: z.literal(1),
  idempotencyKey: z.string().min(1).max(200),
})

export type CloudTaskSmokePayload = z.infer<typeof cloudTaskSmokePayloadSchema>

export const cloudTaskSmokeResponseSchema = z.object({
  status: z.enum(['completed', 'duplicate']),
  operation: z.literal('cloud-tasks.smoke'),
  idempotencyKey: z.string().min(1),
  taskName: z.string().min(1),
})

export type CloudTaskSmokeResponse = z.infer<
  typeof cloudTaskSmokeResponseSchema
>
