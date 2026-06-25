import { z } from 'zod'

export const serviceNameSchema = z.enum(['web', 'worker'])

export const healthResponseSchema = z.object({
  service: serviceNameSchema,
  status: z.enum(['ok', 'error']),
  checks: z.record(z.string(), z.enum(['ok', 'error'])).optional(),
  timestamp: z.iso.datetime(),
})

export type HealthResponse = z.infer<typeof healthResponseSchema>
