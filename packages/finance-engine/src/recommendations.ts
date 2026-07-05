import type { CurrencyCode, DatePeriod } from './domain.js'

export type RecommendationEvidenceKind =
  | 'metric'
  | 'risk_indicator'
  | 'coverage_note'
  | 'category_spending'
  | 'budget_variance'
  | 'debt'
  | 'account_balance'
  | 'data_quality'

export type RecommendationEvidenceId =
  `ev:${RecommendationEvidenceKind}:${string}`

export type RecommendationCandidateId =
  `rec:${RecommendationCandidateType}:${string}`

export type RecommendationCandidateType =
  | 'low_emergency_fund'
  | 'negative_free_cash_flow'
  | 'high_interest_debt'
  | 'high_credit_utilization'
  | 'category_overspend'
  | 'data_quality_gap'

export type RecommendationPriority = 'high' | 'medium' | 'low'

export type RecommendationLifecycleStatus =
  | 'candidate'
  | 'active'
  | 'accepted'
  | 'dismissed'
  | 'expired'

export type RecommendationGroundingErrorCode =
  | 'UNKNOWN_EVIDENCE_REFERENCE'
  | 'UNKNOWN_CANDIDATE_REFERENCE'
  | 'INVALID_EVIDENCE_ID'
  | 'INVALID_CANDIDATE_ID'
  | 'INVALID_RECOMMENDATION_PRIORITY'
  | 'INVALID_RECOMMENDATION_STATUS'
  | 'INVALID_RECOMMENDATION_TEXT'
  | 'INVALID_CONFIDENCE'
  | 'INVALID_RANK'
  | 'INVALID_PROVIDER_METADATA'
  | 'PRIVATE_FIELD_PRESENT'
  | 'PROHIBITED_CLAIM_PRESENT'

export type RecommendationEvidenceReference = {
  id: RecommendationEvidenceId
  kind: RecommendationEvidenceKind
  label: string
  period?: DatePeriod
  amountMinor?: bigint
  percentageBps?: number
  currency?: CurrencyCode
  severity?: 'info' | 'warning' | 'critical'
}

export type RecommendationCandidate = {
  id: RecommendationCandidateId
  type: RecommendationCandidateType
  title: string
  rationale: string
  priority: RecommendationPriority
  status: RecommendationLifecycleStatus
  evidenceIds: RecommendationEvidenceId[]
  assumptions: string[]
  estimatedMonthlyImpactMinor?: bigint
  currency: CurrencyCode
  confidenceBps: number
}

export type GroundedRecommendationOutput = {
  candidateId: RecommendationCandidateId
  rank: number
  priority: RecommendationPriority
  title: string
  rationale: string
  evidenceIds: RecommendationEvidenceId[]
  assumptions: string[]
  confidenceBps: number
}

export type RecommendationProviderMetadata = {
  provider: string
  model: string
  promptVersion: string
  outputSchemaVersion: number
  inputBytes: number
  outputBytes: number
  latencyMs?: number
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  estimatedCostMicros?: number
}

export class RecommendationContractError extends Error {
  constructor(
    message: string,
    readonly code: RecommendationGroundingErrorCode,
  ) {
    super(message)
    this.name = 'RecommendationContractError'
  }
}

const recommendationEvidenceKinds = new Set<RecommendationEvidenceKind>([
  'metric',
  'risk_indicator',
  'coverage_note',
  'category_spending',
  'budget_variance',
  'debt',
  'account_balance',
  'data_quality',
])

const recommendationCandidateTypes = new Set<RecommendationCandidateType>([
  'low_emergency_fund',
  'negative_free_cash_flow',
  'high_interest_debt',
  'high_credit_utilization',
  'category_overspend',
  'data_quality_gap',
])

const recommendationPriorities = new Set<RecommendationPriority>([
  'high',
  'medium',
  'low',
])

const recommendationStatuses = new Set<RecommendationLifecycleStatus>([
  'candidate',
  'active',
  'accepted',
  'dismissed',
  'expired',
])

const slugPattern = /^[a-z0-9][a-z0-9._-]{0,120}$/
const privateFieldPattern =
  /(^|_)(token|secret|password|credential|item_id|webhook|raw|provider_account|provider_account_id|provider_transaction|provider_transaction_id|account_number|routing|mask|email|name|merchant|description|freeform_note|user_note|private_note)s?$/i
const privateFieldAllowlist = new Set([
  'prompt_tokens',
  'completion_tokens',
  'total_tokens',
])
const prohibitedClaimPattern =
  /\b(guarantee|guaranteed|risk-free|will definitely|certain return|tax advice|legal advice)\b/i

function normalizeKey(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/-/g, '_')
    .toLowerCase()
}

function isPrivateFieldKey(normalizedKey: string) {
  if (privateFieldAllowlist.has(normalizedKey)) return false
  if (normalizedKey.startsWith('raw_') || normalizedKey.includes('_raw_')) {
    return true
  }
  return privateFieldPattern.test(normalizedKey)
}

function assertString(value: unknown, field: string) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new RecommendationContractError(
      `${field} must be a non-empty string.`,
      'INVALID_RECOMMENDATION_TEXT',
    )
  }
}

function assertNonnegativeInteger(value: unknown, field: string) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new RecommendationContractError(
      `${field} must be a nonnegative integer.`,
      'INVALID_PROVIDER_METADATA',
    )
  }
}

export function createRecommendationEvidenceId(
  kind: RecommendationEvidenceKind,
  slug: string,
): RecommendationEvidenceId {
  if (!recommendationEvidenceKinds.has(kind)) {
    throw new RecommendationContractError(
      `Unsupported evidence kind: ${kind}`,
      'INVALID_EVIDENCE_ID',
    )
  }
  if (!slugPattern.test(slug)) {
    throw new RecommendationContractError(
      `Invalid evidence slug: ${slug}`,
      'INVALID_EVIDENCE_ID',
    )
  }
  return `ev:${kind}:${slug}`
}

export function createRecommendationCandidateId(
  type: RecommendationCandidateType,
  slug: string,
): RecommendationCandidateId {
  if (!recommendationCandidateTypes.has(type)) {
    throw new RecommendationContractError(
      `Unsupported recommendation type: ${type}`,
      'INVALID_CANDIDATE_ID',
    )
  }
  if (!slugPattern.test(slug)) {
    throw new RecommendationContractError(
      `Invalid recommendation slug: ${slug}`,
      'INVALID_CANDIDATE_ID',
    )
  }
  return `rec:${type}:${slug}`
}

export function isRecommendationEvidenceId(
  value: string,
): value is RecommendationEvidenceId {
  const [, kind, slug, ...extra] = value.split(':')
  return (
    value.startsWith('ev:') &&
    extra.length === 0 &&
    recommendationEvidenceKinds.has(kind as RecommendationEvidenceKind) &&
    slugPattern.test(slug ?? '')
  )
}

export function isRecommendationCandidateId(
  value: string,
): value is RecommendationCandidateId {
  const [, type, slug, ...extra] = value.split(':')
  return (
    value.startsWith('rec:') &&
    extra.length === 0 &&
    recommendationCandidateTypes.has(type as RecommendationCandidateType) &&
    slugPattern.test(slug ?? '')
  )
}

export function isRecommendationPriority(
  value: string,
): value is RecommendationPriority {
  return recommendationPriorities.has(value as RecommendationPriority)
}

export function isRecommendationLifecycleStatus(
  value: string,
): value is RecommendationLifecycleStatus {
  return recommendationStatuses.has(value as RecommendationLifecycleStatus)
}

export function assertRecommendationPayloadSafe(
  value: unknown,
  path = '$',
): void {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertRecommendationPayloadSafe(entry, `${path}[${index.toString()}]`),
    )
    return
  }
  if (typeof value !== 'object') {
    return
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = path === '$' ? `$.${key}` : `${path}.${key}`
    const normalizedKey = normalizeKey(key)
    if (isPrivateFieldKey(normalizedKey)) {
      throw new RecommendationContractError(
        `Recommendation payload contains private field at ${childPath}.`,
        'PRIVATE_FIELD_PRESENT',
      )
    }
    assertRecommendationPayloadSafe(child, childPath)
  }
}

export function assertNoProhibitedRecommendationClaims(
  output: GroundedRecommendationOutput,
): void {
  const text = [output.title, output.rationale, ...output.assumptions].join(
    '\n',
  )
  if (prohibitedClaimPattern.test(text)) {
    throw new RecommendationContractError(
      'Recommendation output contains a prohibited claim.',
      'PROHIBITED_CLAIM_PRESENT',
    )
  }
}

export function validateRecommendationCandidate(
  candidate: RecommendationCandidate,
  evidence: readonly RecommendationEvidenceReference[],
): RecommendationCandidate {
  assertRecommendationPayloadSafe(candidate)
  assertString(candidate.title, 'title')
  assertString(candidate.rationale, 'rationale')

  if (!isRecommendationCandidateId(candidate.id)) {
    throw new RecommendationContractError(
      `Invalid candidate id: ${candidate.id}`,
      'INVALID_CANDIDATE_ID',
    )
  }
  if (!candidate.id.startsWith(`rec:${candidate.type}:`)) {
    throw new RecommendationContractError(
      `Candidate id does not match type: ${candidate.id}`,
      'INVALID_CANDIDATE_ID',
    )
  }
  if (!isRecommendationPriority(candidate.priority)) {
    throw new RecommendationContractError(
      `Invalid recommendation priority: ${candidate.priority}`,
      'INVALID_RECOMMENDATION_PRIORITY',
    )
  }
  if (!isRecommendationLifecycleStatus(candidate.status)) {
    throw new RecommendationContractError(
      `Invalid recommendation status: ${candidate.status}`,
      'INVALID_RECOMMENDATION_STATUS',
    )
  }
  if (
    !Number.isInteger(candidate.confidenceBps) ||
    candidate.confidenceBps < 0 ||
    candidate.confidenceBps > 10_000
  ) {
    throw new RecommendationContractError(
      `Invalid confidence: ${candidate.confidenceBps.toString()}`,
      'INVALID_CONFIDENCE',
    )
  }

  const evidenceIds = new Set(evidence.map((entry) => entry.id))
  for (const evidenceId of candidate.evidenceIds) {
    if (!isRecommendationEvidenceId(evidenceId)) {
      throw new RecommendationContractError(
        `Invalid evidence id: ${evidenceId}`,
        'INVALID_EVIDENCE_ID',
      )
    }
    if (!evidenceIds.has(evidenceId)) {
      throw new RecommendationContractError(
        `Unknown evidence id: ${evidenceId}`,
        'UNKNOWN_EVIDENCE_REFERENCE',
      )
    }
  }

  return candidate
}

export function validateGroundedRecommendationOutput(
  output: GroundedRecommendationOutput,
  candidates: readonly RecommendationCandidate[],
  evidence: readonly RecommendationEvidenceReference[],
): GroundedRecommendationOutput {
  assertRecommendationPayloadSafe(output)
  assertNoProhibitedRecommendationClaims(output)
  assertString(output.title, 'title')
  assertString(output.rationale, 'rationale')

  if (!isRecommendationCandidateId(output.candidateId)) {
    throw new RecommendationContractError(
      `Invalid candidate id: ${output.candidateId}`,
      'INVALID_CANDIDATE_ID',
    )
  }
  if (!Number.isInteger(output.rank) || output.rank < 1) {
    throw new RecommendationContractError(
      `Invalid recommendation rank: ${output.rank.toString()}`,
      'INVALID_RANK',
    )
  }
  if (!isRecommendationPriority(output.priority)) {
    throw new RecommendationContractError(
      `Invalid recommendation priority: ${output.priority}`,
      'INVALID_RECOMMENDATION_PRIORITY',
    )
  }
  if (
    !Number.isInteger(output.confidenceBps) ||
    output.confidenceBps < 0 ||
    output.confidenceBps > 10_000
  ) {
    throw new RecommendationContractError(
      `Invalid confidence: ${output.confidenceBps.toString()}`,
      'INVALID_CONFIDENCE',
    )
  }

  const candidateIds = new Set(candidates.map((candidate) => candidate.id))
  if (!candidateIds.has(output.candidateId)) {
    throw new RecommendationContractError(
      `Unknown candidate id: ${output.candidateId}`,
      'UNKNOWN_CANDIDATE_REFERENCE',
    )
  }

  const evidenceIds = new Set(evidence.map((entry) => entry.id))
  for (const evidenceId of output.evidenceIds) {
    if (!isRecommendationEvidenceId(evidenceId)) {
      throw new RecommendationContractError(
        `Invalid evidence id: ${evidenceId}`,
        'INVALID_EVIDENCE_ID',
      )
    }
    if (!evidenceIds.has(evidenceId)) {
      throw new RecommendationContractError(
        `Unknown evidence id: ${evidenceId}`,
        'UNKNOWN_EVIDENCE_REFERENCE',
      )
    }
  }

  return output
}

export function validateRecommendationProviderMetadata(
  metadata: RecommendationProviderMetadata,
): RecommendationProviderMetadata {
  assertRecommendationPayloadSafe(metadata)
  assertString(metadata.provider, 'provider')
  assertString(metadata.model, 'model')
  assertString(metadata.promptVersion, 'promptVersion')
  assertNonnegativeInteger(metadata.outputSchemaVersion, 'outputSchemaVersion')
  assertNonnegativeInteger(metadata.inputBytes, 'inputBytes')
  assertNonnegativeInteger(metadata.outputBytes, 'outputBytes')

  if (metadata.latencyMs !== undefined) {
    assertNonnegativeInteger(metadata.latencyMs, 'latencyMs')
  }
  if (metadata.promptTokens !== undefined) {
    assertNonnegativeInteger(metadata.promptTokens, 'promptTokens')
  }
  if (metadata.completionTokens !== undefined) {
    assertNonnegativeInteger(metadata.completionTokens, 'completionTokens')
  }
  if (metadata.totalTokens !== undefined) {
    assertNonnegativeInteger(metadata.totalTokens, 'totalTokens')
  }
  if (metadata.estimatedCostMicros !== undefined) {
    assertNonnegativeInteger(
      metadata.estimatedCostMicros,
      'estimatedCostMicros',
    )
  }

  return metadata
}
