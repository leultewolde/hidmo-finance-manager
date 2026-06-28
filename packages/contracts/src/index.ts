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

export const plaidSyncTaskPayloadSchema = z.object({
  operation: z.literal('plaid.transactions.sync'),
  schemaVersion: z.literal(1),
  userId: z.uuid(),
  connectionId: z.uuid(),
  syncJobId: z.uuid(),
  idempotencyKey: z.string().min(1).max(200),
})

export type PlaidSyncTaskPayload = z.infer<typeof plaidSyncTaskPayloadSchema>

export const plaidSyncTaskResponseSchema = z.object({
  status: z.literal('completed'),
  operation: z.literal('plaid.transactions.sync'),
  userId: z.uuid(),
  connectionId: z.uuid(),
  syncJobId: z.uuid(),
  added: z.number().int().nonnegative(),
  modified: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  classified: z.number().int().nonnegative(),
  transferCandidates: z.number().int().nonnegative(),
  providerAttempts: z.number().int().nonnegative(),
})

export type PlaidSyncTaskResponse = z.infer<typeof plaidSyncTaskResponseSchema>

export const plaidWebhookPayloadSchema = z.object({
  webhook_type: z.string().min(1),
  webhook_code: z.string().min(1),
  item_id: z.string().min(1),
  webhook_id: z.string().min(1).optional(),
})

export type PlaidWebhookPayload = z.infer<typeof plaidWebhookPayloadSchema>
