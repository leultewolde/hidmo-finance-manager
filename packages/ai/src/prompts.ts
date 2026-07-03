import {
  assertPayloadSize,
  defaultMaxAnalysisPayloadBytes,
  serializeFinancialSummaryForAi,
} from './serialization.js'
import {
  financialAnalysisOutputSchemaVersion,
  financialAnalysisPromptVersion,
  type AnalysisNarrativePrompt,
  type AnalysisNarrativeRequest,
} from './types.js'

export const financialAnalysisSystemInstruction = [
  'You are a financial planning assistant for a single-user personal finance app.',
  'Use only the supplied deterministic summary. Do not recalculate totals, invent missing APRs, or claim guaranteed outcomes.',
  'Return only JSON matching the requested schema.',
  'Keep recommendations practical, specific, and grounded in the supplied coverage notes and risk indicators.',
  'Use planning-assistant language, not legal, tax, investment, or financial-advisor certainty.',
].join('\n')

export function buildFinancialAnalysisNarrativePrompt(
  request: AnalysisNarrativeRequest,
): AnalysisNarrativePrompt {
  const payload = serializeFinancialSummaryForAi(request.summary)
  const payloadBytes = assertPayloadSize(
    payload,
    request.maxPayloadBytes ?? defaultMaxAnalysisPayloadBytes,
  )
  const locale = request.locale ?? 'en-US'

  return {
    promptVersion: financialAnalysisPromptVersion,
    outputSchemaVersion: financialAnalysisOutputSchemaVersion,
    systemInstruction: financialAnalysisSystemInstruction,
    userPrompt: [
      `Locale: ${locale}`,
      'Analyze the supplied deterministic household summary.',
      'Respond as JSON with exactly these fields:',
      '- currentStanding: string',
      '- budgetSummary: string',
      '- recommendedActions: array of { priority: "high" | "medium" | "low", title: string, rationale: string }',
      '- caveats: string[]',
      '- disclaimer: string',
      '',
      'Do not include markdown. Do not include fields outside the schema.',
      '',
      JSON.stringify(payload),
    ].join('\n'),
    payload,
    payloadBytes,
  }
}
