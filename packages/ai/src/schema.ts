import type { FinancialAnalysisNarrative } from '@hidmo/finance-engine'
import { z } from 'zod'

import { AnalysisAiError } from './errors.js'

export const recommendedActionPrioritySchema = z.enum(['high', 'medium', 'low'])

export const financialAnalysisNarrativeSchema = z
  .object({
    currentStanding: z.string().trim().min(1).max(1_200),
    budgetSummary: z.string().trim().min(1).max(1_200),
    recommendedActions: z
      .array(
        z
          .object({
            priority: recommendedActionPrioritySchema,
            title: z.string().trim().min(1).max(140),
            rationale: z.string().trim().min(1).max(800),
          })
          .strict(),
      )
      .max(7),
    caveats: z.array(z.string().trim().min(1).max(400)).max(10),
    disclaimer: z.string().trim().min(1).max(400),
  })
  .strict()

export function validateFinancialAnalysisNarrative(
  output: unknown,
): FinancialAnalysisNarrative {
  const parsed = financialAnalysisNarrativeSchema.safeParse(output)
  if (!parsed.success) {
    throw new AnalysisAiError(
      `AI output did not match the financial analysis narrative schema: ${parsed.error.message}`,
      'AI_OUTPUT_INVALID',
    )
  }
  return parsed.data
}
