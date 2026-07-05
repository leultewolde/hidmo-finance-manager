import { describe, expect, it } from 'vitest'

import {
  assertRecommendationPayloadSafe,
  createRecommendationCandidateId,
  createRecommendationEvidenceId,
  isRecommendationLifecycleStatus,
  isRecommendationPriority,
  validateGroundedRecommendationOutput,
  validateRecommendationCandidate,
  validateRecommendationProviderMetadata,
  type GroundedRecommendationOutput,
  type RecommendationCandidate,
  type RecommendationContractError,
  type RecommendationEvidenceReference,
} from './recommendations.js'

const emergencyCoverageEvidenceId = createRecommendationEvidenceId(
  'metric',
  'emergency-coverage',
)
const freeCashFlowEvidenceId = createRecommendationEvidenceId(
  'metric',
  'free-cash-flow',
)
const emergencyFundCandidateId = createRecommendationCandidateId(
  'low_emergency_fund',
  'current-period',
)

const evidence: RecommendationEvidenceReference[] = [
  {
    id: emergencyCoverageEvidenceId,
    kind: 'metric',
    label: 'Emergency fund coverage',
    period: {
      startDate: '2026-07-01',
      endDate: '2026-07-31',
    },
    percentageBps: 125,
    severity: 'warning',
  },
  {
    id: freeCashFlowEvidenceId,
    kind: 'metric',
    label: 'Free cash flow',
    amountMinor: 12_300n,
    currency: 'USD',
  },
]

const candidate: RecommendationCandidate = {
  id: emergencyFundCandidateId,
  type: 'low_emergency_fund',
  title: 'Build emergency cash first',
  rationale: 'Emergency coverage is below the target floor.',
  priority: 'high',
  status: 'candidate',
  evidenceIds: [emergencyCoverageEvidenceId, freeCashFlowEvidenceId],
  assumptions: ['Use reviewed posted transactions for the current period.'],
  estimatedMonthlyImpactMinor: 12_300n,
  currency: 'USD',
  confidenceBps: 8_500,
}

const output: GroundedRecommendationOutput = {
  candidateId: emergencyFundCandidateId,
  rank: 1,
  priority: 'high',
  title: 'Build emergency cash first',
  rationale:
    'Emergency coverage is below target and the period has positive free cash flow.',
  evidenceIds: [emergencyCoverageEvidenceId, freeCashFlowEvidenceId],
  assumptions: ['Continue using reviewed posted transactions.'],
  confidenceBps: 8_000,
}

describe('recommendation evidence contracts', () => {
  it('creates stable evidence and candidate ids', () => {
    expect(emergencyCoverageEvidenceId).toBe('ev:metric:emergency-coverage')
    expect(emergencyFundCandidateId).toBe(
      'rec:low_emergency_fund:current-period',
    )
  })

  it('validates deterministic candidates with known evidence', () => {
    expect(validateRecommendationCandidate(candidate, evidence)).toEqual(
      candidate,
    )
  })

  it('validates grounded AI output with known candidate and evidence', () => {
    expect(
      validateGroundedRecommendationOutput(output, [candidate], evidence),
    ).toEqual(output)
  })

  it('rejects unknown evidence references', () => {
    expect(() =>
      validateGroundedRecommendationOutput(
        {
          ...output,
          evidenceIds: [
            emergencyCoverageEvidenceId,
            'ev:metric:not-in-request',
          ],
        },
        [candidate],
        evidence,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'UNKNOWN_EVIDENCE_REFERENCE',
      }) as RecommendationContractError,
    )
  })

  it('rejects unknown candidate references', () => {
    expect(() =>
      validateGroundedRecommendationOutput(
        {
          ...output,
          candidateId: 'rec:low_emergency_fund:unknown',
        },
        [candidate],
        evidence,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'UNKNOWN_CANDIDATE_REFERENCE',
      }) as RecommendationContractError,
    )
  })

  it('rejects invalid priorities and statuses', () => {
    expect(isRecommendationPriority('urgent')).toBe(false)
    expect(isRecommendationLifecycleStatus('deleted')).toBe(false)

    expect(() =>
      validateRecommendationCandidate(
        {
          ...candidate,
          priority: 'urgent',
        } as unknown as RecommendationCandidate,
        evidence,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'INVALID_RECOMMENDATION_PRIORITY',
      }) as RecommendationContractError,
    )

    expect(() =>
      validateRecommendationCandidate(
        {
          ...candidate,
          status: 'deleted',
        } as unknown as RecommendationCandidate,
        evidence,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'INVALID_RECOMMENDATION_STATUS',
      }) as RecommendationContractError,
    )
  })

  it('rejects private/raw fields in recommendation payloads', () => {
    expect(() =>
      assertRecommendationPayloadSafe({
        evidence,
        providerTransactionId: 'provider-transaction-id',
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'PRIVATE_FIELD_PRESENT',
      }) as RecommendationContractError,
    )
  })

  it('rejects prohibited claims in grounded output', () => {
    expect(() =>
      validateGroundedRecommendationOutput(
        {
          ...output,
          rationale: 'This will definitely create guaranteed savings.',
        },
        [candidate],
        evidence,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'PROHIBITED_CLAIM_PRESENT',
      }) as RecommendationContractError,
    )
  })

  it('validates provider metadata without exposing prompt bodies', () => {
    const metadata = {
      provider: 'vertex',
      model: 'gemini-flash-lite-stable',
      promptVersion: 'recommendations-grounded/v1',
      outputSchemaVersion: 1,
      inputBytes: 1_200,
      outputBytes: 600,
      latencyMs: 850,
      promptTokens: 300,
      completionTokens: 120,
      totalTokens: 420,
      estimatedCostMicros: 150,
    }

    expect(validateRecommendationProviderMetadata(metadata)).toEqual(metadata)

    expect(() =>
      validateRecommendationProviderMetadata({
        ...metadata,
        rawPrompt: 'sensitive prompt body',
      } as unknown as typeof metadata),
    ).toThrowError(
      expect.objectContaining({
        code: 'PRIVATE_FIELD_PRESENT',
      }) as RecommendationContractError,
    )
  })
})
