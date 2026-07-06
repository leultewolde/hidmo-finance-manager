import { describe, expect, it } from 'vitest'

import {
  createRecommendationCandidateId,
  createRecommendationEvidenceId,
  type DeterministicFinancialSummary,
  type RecommendationCandidate,
  type RecommendationEvidenceReference,
} from '@hidmo/finance-engine'

import {
  AnalysisAiError,
  buildVertexGenerateContentUrl,
  createVertexFinancialAnalysisProvider,
  createVertexRecommendationGroundingProvider,
  financialAnalysisPromptVersion,
  recommendationGroundingPromptVersion,
} from './index.js'

const summary: DeterministicFinancialSummary = {
  period: {
    startDate: '2026-06-01',
    endDate: '2026-06-30',
    label: 'June 2026',
  },
  currency: 'USD',
  balanceSheet: {
    totalAssetsMinor: 1_500_000n,
    totalLiabilitiesMinor: 250_000n,
    netWorthMinor: 1_250_000n,
    liquidCashMinor: 800_000n,
  },
  cashFlow: {
    incomeMinor: 500_000n,
    expenseOutflowsMinor: 300_000n,
    refundsMinor: 0n,
    netExpensesMinor: 300_000n,
    freeCashFlowMinor: 200_000n,
    savingsRateBps: 4_000,
  },
  income: {
    incomeMinor: 500_000n,
    transactionCount: 1,
    sourceCount: 1,
  },
  spendingByCategory: [
    {
      category: 'housing:rent',
      outflowMinor: 180_000n,
      refundMinor: 0n,
      netExpenseMinor: 180_000n,
      transactionCount: 1,
    },
  ],
  debt: {
    totalDebtMinor: 250_000n,
    minimumPaymentsMinor: 25_000n,
    weightedAprBps: 1_700,
    highInterestDebtMinor: 250_000n,
    creditUtilizationBps: 2_500,
    accountsWithoutCreditLimit: 0,
  },
  emergencyFundCoverageMonthsHundredths: 444,
  budgetBaseline: {
    essentialExpensesMinor: 180_000n,
    discretionaryExpensesMinor: 120_000n,
    debtMinimumsMinor: 25_000n,
    savingsCapacityAfterMinimumDebtMinor: 175_000n,
    budgetVariance: [],
  },
  coverage: {
    accountsIncluded: 3,
    debtsIncluded: 1,
    transactionsAvailable: 12,
    transactionsIncluded: 12,
    splitsIncluded: 0,
    coverageNotes: [
      {
        code: 'reviewed-transactions-only',
        severity: 'info',
        message:
          'The summary uses reviewed posted transactions by default so uncertain classifications do not drive recommendations.',
      },
    ],
  },
  riskIndicators: [
    {
      code: 'high-interest-debt',
      severity: 'warning',
      message: 'High-interest debt is present and should be prioritized.',
    },
  ],
}

const narrative = {
  currentStanding: 'You have positive cash flow.',
  budgetSummary: 'Income exceeds expenses for the period.',
  recommendedActions: [
    {
      priority: 'high',
      title: 'Prioritize high-interest debt',
      rationale: 'High-interest debt is present.',
    },
  ],
  caveats: ['Reviewed transactions only.'],
  disclaimer: 'Planning assistance only.',
}

const debtEvidenceId = createRecommendationEvidenceId(
  'metric',
  'high-interest-debt',
)
const debtCandidateId = createRecommendationCandidateId(
  'high_interest_debt',
  'current-period',
)
const recommendationEvidence: RecommendationEvidenceReference[] = [
  {
    id: debtEvidenceId,
    kind: 'metric',
    label: 'High-interest debt balance',
    period: summary.period,
    amountMinor: 250_000n,
    currency: 'USD',
    severity: 'warning',
  },
]
const recommendationCandidates: RecommendationCandidate[] = [
  {
    id: debtCandidateId,
    type: 'high_interest_debt',
    title: 'Prioritize high-interest debt',
    rationale: 'High-interest balances are present.',
    priority: 'high',
    status: 'candidate',
    evidenceIds: [debtEvidenceId],
    assumptions: ['APR thresholds are policy-defined.'],
    estimatedMonthlyImpactMinor: 175_000n,
    currency: 'USD',
    confidenceBps: 8_500,
  },
]
const groundedRecommendations = {
  recommendations: [
    {
      candidateId: debtCandidateId,
      rank: 1,
      priority: 'high',
      title: 'Prioritize high-interest debt',
      rationale: 'Use extra cash flow to reduce high-interest balances first.',
      evidenceIds: [debtEvidenceId],
      assumptions: ['Minimum debt payments still stay current.'],
      confidenceBps: 8_500,
    },
  ],
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('Vertex financial analysis provider', () => {
  it('builds the regional generateContent URL for publisher models', () => {
    expect(
      buildVertexGenerateContentUrl({
        projectId: 'finance-manager-dev-500423',
        location: 'us-east1',
        model: 'gemini-2.5-flash-lite',
      }),
    ).toBe(
      'https://us-east1-aiplatform.googleapis.com/v1/projects/finance-manager-dev-500423/locations/us-east1/publishers/google/models/gemini-2.5-flash-lite:generateContent',
    )
  })

  it('calls Vertex generateContent with authenticated JSON-mode request', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = []
    const fetchImplementation: typeof fetch = async (input, init) => {
      calls.push([input, init])
      return jsonResponse({
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify(narrative) }],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 123,
          candidatesTokenCount: 45,
          totalTokenCount: 168,
        },
      })
    }
    const provider = createVertexFinancialAnalysisProvider({
      projectId: 'finance-manager-dev-500423',
      location: 'us-east1',
      model: 'gemini-2.5-flash-lite',
      fetch: fetchImplementation,
      accessTokenProvider: async () => 'test-access-token',
    })

    const result = await provider.generateNarrative({ summary })
    const [url, init] = calls[0]!
    const body = JSON.parse(String(init?.body)) as {
      systemInstruction: { parts: Array<{ text: string }> }
      contents: Array<{ role: string; parts: Array<{ text: string }> }>
      generationConfig: {
        temperature: number
        maxOutputTokens: number
        responseMimeType: string
      }
      labels: Record<string, string>
    }

    expect(url).toBe(
      'https://us-east1-aiplatform.googleapis.com/v1/projects/finance-manager-dev-500423/locations/us-east1/publishers/google/models/gemini-2.5-flash-lite:generateContent',
    )
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer test-access-token',
      'Content-Type': 'application/json',
    })
    expect(body.systemInstruction.parts[0]?.text).toContain('Return only JSON')
    expect(body.contents).toHaveLength(1)
    expect(body.contents[0]?.role).toBe('user')
    expect(body.contents[0]?.parts[0]?.text).toContain('recommendedActions')
    expect(body.generationConfig).toEqual({
      temperature: 0.2,
      maxOutputTokens: 1_024,
      responseMimeType: 'application/json',
    })
    expect(body.labels).toEqual({
      app: 'hidmo',
      feature: 'financial_analysis',
    })
    expect(result).toMatchObject({
      narrative,
      metadata: {
        provider: 'vertex-ai',
        model:
          'projects/finance-manager-dev-500423/locations/us-east1/publishers/google/models/gemini-2.5-flash-lite',
        promptVersion: financialAnalysisPromptVersion,
        outputSchemaVersion: 1,
        promptTokens: 123,
        completionTokens: 45,
        totalTokens: 168,
      },
    })
  })

  it('parses fenced JSON response text', async () => {
    const provider = createVertexFinancialAnalysisProvider({
      projectId: 'project',
      location: 'us-east1',
      model:
        'projects/project/locations/us-east1/publishers/google/models/model',
      fetch: async () =>
        jsonResponse({
          candidates: [
            {
              content: {
                parts: [
                  { text: `\`\`\`json\n${JSON.stringify(narrative)}\n\`\`\`` },
                ],
              },
            },
          ],
        }),
      accessTokenProvider: async () => 'test-access-token',
    })

    await expect(
      provider.generateNarrative({ summary }),
    ).resolves.toMatchObject({
      narrative,
    })
  })

  it('returns safe provider request errors without raw response bodies', async () => {
    const provider = createVertexFinancialAnalysisProvider({
      projectId: 'project',
      location: 'us-east1',
      model: 'gemini-2.5-flash-lite',
      fetch: async () =>
        jsonResponse({ error: { message: 'sensitive provider detail' } }, 500),
      accessTokenProvider: async () => 'test-access-token',
    })

    await expect(provider.generateNarrative({ summary })).rejects.toMatchObject(
      {
        code: 'AI_PROVIDER_REQUEST_FAILED',
        message: 'Vertex AI generateContent request failed with HTTP 500.',
      },
    )
  })

  it('rejects provider responses that are not schema-valid narratives', async () => {
    const provider = createVertexFinancialAnalysisProvider({
      projectId: 'project',
      location: 'us-east1',
      model: 'gemini-2.5-flash-lite',
      fetch: async () =>
        jsonResponse({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify({ summary: 'wrong shape' }) }],
              },
            },
          ],
        }),
      accessTokenProvider: async () => 'test-access-token',
    })

    await expect(
      provider.generateNarrative({ summary }),
    ).rejects.toBeInstanceOf(AnalysisAiError)
    await expect(provider.generateNarrative({ summary })).rejects.toMatchObject(
      {
        code: 'AI_OUTPUT_INVALID',
      },
    )
  })
})

describe('Vertex recommendation grounding provider', () => {
  it('calls Vertex generateContent with authenticated recommendation grounding request', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = []
    const fetchImplementation: typeof fetch = async (input, init) => {
      calls.push([input, init])
      return jsonResponse({
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify(groundedRecommendations) }],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 90,
          candidatesTokenCount: 30,
          totalTokenCount: 120,
        },
      })
    }
    const provider = createVertexRecommendationGroundingProvider({
      projectId: 'finance-manager-dev-500423',
      location: 'us',
      model: 'gemini-3.1-flash-lite',
      fetch: fetchImplementation,
      accessTokenProvider: async () => 'test-access-token',
    })

    const result = await provider.rankAndExplain({
      evidence: recommendationEvidence,
      candidates: recommendationCandidates,
    })
    const [url, init] = calls[0]!
    const body = JSON.parse(String(init?.body)) as {
      systemInstruction: { parts: Array<{ text: string }> }
      contents: Array<{ role: string; parts: Array<{ text: string }> }>
      generationConfig: {
        temperature: number
        maxOutputTokens: number
        responseMimeType: string
      }
      labels: Record<string, string>
    }

    expect(url).toBe(
      'https://us-aiplatform.googleapis.com/v1/projects/finance-manager-dev-500423/locations/us/publishers/google/models/gemini-3.1-flash-lite:generateContent',
    )
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer test-access-token',
      'Content-Type': 'application/json',
    })
    expect(body.systemInstruction.parts[0]?.text).toContain('Return only JSON')
    expect(body.contents[0]?.parts[0]?.text).toContain('candidateId')
    expect(body.generationConfig).toEqual({
      temperature: 0.1,
      maxOutputTokens: 1_024,
      responseMimeType: 'application/json',
    })
    expect(body.labels).toEqual({
      app: 'hidmo',
      feature: 'recommendations',
    })
    expect(result).toMatchObject({
      recommendations: groundedRecommendations.recommendations,
      metadata: {
        provider: 'vertex-ai',
        model:
          'projects/finance-manager-dev-500423/locations/us/publishers/google/models/gemini-3.1-flash-lite',
        promptVersion: recommendationGroundingPromptVersion,
        outputSchemaVersion: 1,
        promptTokens: 90,
        completionTokens: 30,
        totalTokens: 120,
      },
    })
  })

  it('rejects recommendation responses with unsupported evidence references', async () => {
    const provider = createVertexRecommendationGroundingProvider({
      projectId: 'project',
      location: 'us',
      model: 'gemini-3.1-flash-lite',
      fetch: async () =>
        jsonResponse({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      recommendations: [
                        {
                          ...groundedRecommendations.recommendations[0],
                          evidenceIds: ['ev:metric:not-supplied'],
                        },
                      ],
                    }),
                  },
                ],
              },
            },
          ],
        }),
      accessTokenProvider: async () => 'test-access-token',
    })

    await expect(
      provider.rankAndExplain({
        evidence: recommendationEvidence,
        candidates: recommendationCandidates,
      }),
    ).rejects.toMatchObject({
      code: 'AI_OUTPUT_INVALID',
    })
  })
})
