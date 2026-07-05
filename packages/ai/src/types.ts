import type {
  DeterministicFinancialSummary,
  FinancialAnalysisNarrative,
  GroundedRecommendationOutput,
  RecommendationCandidate,
  RecommendationEvidenceReference,
  RecommendationProviderMetadata,
} from '@hidmo/finance-engine'

export const financialAnalysisPromptVersion =
  'financial-analysis-narrative/v1' as const

export const financialAnalysisOutputSchemaVersion = 1 as const
export const recommendationGroundingPromptVersion =
  'recommendations-grounded/v1' as const
export const recommendationGroundingOutputSchemaVersion = 1 as const

export type FinancialAnalysisPromptVersion =
  typeof financialAnalysisPromptVersion
export type RecommendationGroundingPromptVersion =
  typeof recommendationGroundingPromptVersion

export type JsonPrimitive = string | number | boolean | null
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { readonly [key: string]: JsonValue }

export type AnalysisNarrativePrompt = {
  promptVersion: FinancialAnalysisPromptVersion
  outputSchemaVersion: typeof financialAnalysisOutputSchemaVersion
  systemInstruction: string
  userPrompt: string
  payload: JsonValue
  payloadBytes: number
}

export type RecommendationGroundingPrompt = {
  promptVersion: RecommendationGroundingPromptVersion
  outputSchemaVersion: typeof recommendationGroundingOutputSchemaVersion
  systemInstruction: string
  userPrompt: string
  payload: JsonValue
  payloadBytes: number
}

export type AnalysisNarrativeRequest = {
  summary: DeterministicFinancialSummary
  snapshotId?: string
  locale?: string
  maxPayloadBytes?: number
}

export type RecommendationGroundingRequest = {
  evidence: readonly RecommendationEvidenceReference[]
  candidates: readonly RecommendationCandidate[]
  locale?: string
  maxPayloadBytes?: number
}

export type AnalysisAiProviderMetadata = {
  provider: string
  model: string
  promptVersion: FinancialAnalysisPromptVersion
  outputSchemaVersion: typeof financialAnalysisOutputSchemaVersion
  inputBytes: number
  outputBytes: number
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

export type RecommendationGroundingResult = {
  recommendations: GroundedRecommendationOutput[]
  metadata: RecommendationProviderMetadata
}

export type AnalysisNarrativeResult = {
  narrative: FinancialAnalysisNarrative
  metadata: AnalysisAiProviderMetadata
}

export type FinancialAnalysisAiProvider = {
  generateNarrative(
    request: AnalysisNarrativeRequest,
  ): Promise<AnalysisNarrativeResult>
}

export type RecommendationGroundingProvider = {
  rankAndExplain(
    request: RecommendationGroundingRequest,
  ): Promise<RecommendationGroundingResult>
}
