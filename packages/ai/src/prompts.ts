import {
  assertPayloadSize,
  defaultMaxAnalysisPayloadBytes,
  defaultMaxRecommendationPayloadBytes,
  serializeFinancialSummaryForAi,
  serializeRecommendationGroundingInput,
} from './serialization.js'
import {
  financialAnalysisOutputSchemaVersion,
  financialAnalysisPromptVersion,
  recommendationGroundingOutputSchemaVersion,
  recommendationGroundingPromptVersion,
  type AnalysisNarrativePrompt,
  type AnalysisNarrativeRequest,
  type RecommendationGroundingPrompt,
  type RecommendationGroundingRequest,
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

export const recommendationGroundingSystemInstruction = [
  'You are ranking and explaining precomputed recommendation candidates for a single-user personal finance app.',
  'Use only the supplied candidate and evidence IDs. Do not invent new evidence, amounts, debts, accounts, timelines, or outcomes.',
  'Return only JSON matching the requested schema.',
  'Every output item must reference one supplied candidateId and only supplied evidenceIds.',
  'Use planning-assistance language, not legal, tax, investment, or financial-advisor certainty.',
].join('\n')

export function buildRecommendationGroundingPrompt(
  request: RecommendationGroundingRequest,
): RecommendationGroundingPrompt {
  const payload = serializeRecommendationGroundingInput({
    evidence: request.evidence,
    candidates: request.candidates,
  })
  const payloadBytes = assertPayloadSize(
    payload,
    request.maxPayloadBytes ?? defaultMaxRecommendationPayloadBytes,
  )
  const locale = request.locale ?? 'en-US'

  return {
    promptVersion: recommendationGroundingPromptVersion,
    outputSchemaVersion: recommendationGroundingOutputSchemaVersion,
    systemInstruction: recommendationGroundingSystemInstruction,
    userPrompt: [
      `Locale: ${locale}`,
      'Rank and explain the supplied deterministic recommendation candidates.',
      'Respond as JSON with exactly this shape:',
      '{ "recommendations": array of { candidateId, rank, priority, title, rationale, evidenceIds, assumptions, confidenceBps } }',
      '',
      'Rules:',
      '- candidateId must equal one supplied candidate id.',
      '- evidenceIds must be a non-empty subset of evidence IDs attached to that candidate.',
      '- Do not include markdown.',
      '- Do not include fields outside the schema.',
      '',
      JSON.stringify(payload),
    ].join('\n'),
    payload,
    payloadBytes,
  }
}
