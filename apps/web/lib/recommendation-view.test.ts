import { describe, expect, it } from 'vitest'

import type { RecommendationReadModel } from '@hidmo/database'

import { serializeRecommendationView } from './recommendation-view'

describe('recommendation dashboard view serialization', () => {
  it('serializes bigint amounts, evidence, and provider metadata for the client', () => {
    const recommendation: RecommendationReadModel = {
      rowId: 'row-1',
      userId: 'user-1',
      id: 'rec:high_interest_debt:current-period',
      type: 'high_interest_debt',
      status: 'active',
      priority: 'high',
      period: { startDate: '2026-07-01', endDate: '2026-07-31' },
      inputHash:
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      formulaVersion: 'financial-analysis-summary/v1',
      policyVersion: 'recommendation-policies/v1',
      rank: 1,
      title: 'Prioritize high-interest debt',
      rationale: 'High-interest balances are present.',
      evidenceIds: ['ev:metric:high-interest-debt'],
      evidence: [
        {
          id: 'ev:metric:high-interest-debt',
          kind: 'metric',
          label: 'High-interest debt balance',
          period: { startDate: '2026-07-01', endDate: '2026-07-31' },
          amountMinor: 210_000n,
          percentageBps: 2_499,
          currency: 'USD',
          severity: 'warning',
        },
      ],
      assumptions: ['APR thresholds are policy-defined.'],
      estimatedMonthlyImpactMinor: 50_000n,
      currency: 'USD',
      confidenceBps: 8_500,
      modelMetadata: {
        provider: 'mock',
        model: 'mock-recommendation-grounding-v1',
        promptVersion: 'recommendations-grounded/v1',
      },
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      updatedAt: new Date('2026-07-01T00:01:00.000Z'),
    }

    expect(serializeRecommendationView(recommendation)).toMatchObject({
      rowId: 'row-1',
      candidateId: 'rec:high_interest_debt:current-period',
      estimatedMonthlyImpactMinor: '50000',
      modelProvider: 'mock',
      modelName: 'mock-recommendation-grounding-v1',
      promptVersion: 'recommendations-grounded/v1',
      evidence: [
        {
          id: 'ev:metric:high-interest-debt',
          amountMinor: '210000',
          percentageBps: 2499,
          currency: 'USD',
        },
      ],
    })
  })
})
