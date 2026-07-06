import {
  RecommendationContractError,
  validateGroundedRecommendationOutput,
  type FinancialAnalysisNarrative,
  type GroundedRecommendationOutput,
  type RecommendationCandidate,
  type RecommendationEvidenceReference,
} from '@hidmo/finance-engine'
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

export const groundedRecommendationOutputSchema = z
  .object({
    candidateId: z.string().trim().min(1),
    rank: z.number().int().positive(),
    priority: recommendedActionPrioritySchema,
    title: z.string().trim().min(1).max(140),
    rationale: z.string().trim().min(1).max(800),
    evidenceIds: z.array(z.string().trim().min(1)).min(1).max(20),
    assumptions: z.array(z.string().trim().min(1).max(400)).max(10),
    confidenceBps: z.number().int().min(0).max(10_000),
  })
  .strict()

export const groundedRecommendationResponseSchema = z
  .object({
    recommendations: z.array(groundedRecommendationOutputSchema).max(10),
  })
  .strict()

export function validateGroundedRecommendationResponse(
  output: unknown,
  candidates: readonly RecommendationCandidate[],
  evidence: readonly RecommendationEvidenceReference[],
): GroundedRecommendationOutput[] {
  const parsed = groundedRecommendationResponseSchema.safeParse(output)
  if (!parsed.success) {
    throw new AnalysisAiError(
      `AI output did not match the recommendation grounding schema: ${parsed.error.message}`,
      'AI_OUTPUT_INVALID',
    )
  }

  try {
    return parsed.data.recommendations.map((recommendation) =>
      validateGroundedRecommendationOutput(
        recommendation as GroundedRecommendationOutput,
        candidates,
        evidence,
      ),
    )
  } catch (error) {
    if (error instanceof RecommendationContractError) {
      throw new AnalysisAiError(
        `AI recommendation output failed grounding validation: ${error.code}`,
        'AI_OUTPUT_INVALID',
      )
    }
    throw error
  }
}
