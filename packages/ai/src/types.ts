import type {
  DeterministicFinancialSummary,
  FinancialAnalysisNarrative,
} from '@hidmo/finance-engine'

export const financialAnalysisPromptVersion =
  'financial-analysis-narrative/v1' as const

export const financialAnalysisOutputSchemaVersion = 1 as const

export type FinancialAnalysisPromptVersion =
  typeof financialAnalysisPromptVersion

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

export type AnalysisNarrativeRequest = {
  summary: DeterministicFinancialSummary
  snapshotId?: string
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
