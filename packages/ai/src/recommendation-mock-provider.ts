import {
  validateRecommendationProviderMetadata,
  type GroundedRecommendationOutput,
  type RecommendationCandidate,
} from '@hidmo/finance-engine'

import { buildRecommendationGroundingPrompt } from './prompts.js'
import { validateGroundedRecommendationResponse } from './schema.js'
import type {
  RecommendationGroundingProvider,
  RecommendationGroundingRequest,
  RecommendationGroundingResult,
} from './types.js'

const priorityOrder = {
  high: 1,
  medium: 2,
  low: 3,
} as const

function compareCandidatePriority(
  left: RecommendationCandidate,
  right: RecommendationCandidate,
) {
  const priorityComparison =
    priorityOrder[left.priority] - priorityOrder[right.priority]
  return priorityComparison === 0
    ? left.id.localeCompare(right.id)
    : priorityComparison
}

export function createMockRecommendationGroundingProvider(
  configuration: {
    model?: string
  } = {},
): RecommendationGroundingProvider {
  const model = configuration.model ?? 'mock-recommendation-grounding-v1'

  return {
    async rankAndExplain(
      request: RecommendationGroundingRequest,
    ): Promise<RecommendationGroundingResult> {
      const startedAt = Date.now()
      const prompt = buildRecommendationGroundingPrompt(request)
      const recommendations = validateGroundedRecommendationResponse(
        {
          recommendations: [...request.candidates]
            .sort(compareCandidatePriority)
            .map(
              (candidate, index): GroundedRecommendationOutput => ({
                candidateId: candidate.id,
                rank: index + 1,
                priority: candidate.priority,
                title: candidate.title,
                rationale: candidate.rationale,
                evidenceIds: candidate.evidenceIds,
                assumptions: candidate.assumptions,
                confidenceBps: candidate.confidenceBps,
              }),
            ),
        },
        request.candidates,
        request.evidence,
      )

      return {
        recommendations,
        metadata: validateRecommendationProviderMetadata({
          provider: 'mock',
          model,
          promptVersion: prompt.promptVersion,
          outputSchemaVersion: prompt.outputSchemaVersion,
          inputBytes: prompt.payloadBytes,
          outputBytes: Buffer.byteLength(
            JSON.stringify({ recommendations }),
            'utf8',
          ),
          latencyMs: Date.now() - startedAt,
        }),
      }
    },
  }
}
