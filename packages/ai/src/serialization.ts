import type { DeterministicFinancialSummary } from '@hidmo/finance-engine'

import { AnalysisAiError } from './errors.js'
import type { JsonValue } from './types.js'

export const defaultMaxAnalysisPayloadBytes = 24_000

const blockedKeyPattern =
  /(^|_)(token|secret|password|credential|item_id|webhook|raw|provider_account|provider_account_id|provider_transaction|provider_transaction_id|account_number|routing|mask|email|name|merchant|description|freeform_note|user_note|private_note)s?$/i

function normalizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/-/g, '_')
    .toLowerCase()
}

function assertAllowedKey(key: string, path: string): void {
  if (blockedKeyPattern.test(normalizeKey(key))) {
    throw new AnalysisAiError(
      `AI payload contains blocked field at ${path}`,
      'AI_PAYLOAD_BLOCKED_FIELD',
    )
  }
}

function toJsonValue(value: unknown, path: string): JsonValue {
  if (typeof value === 'bigint') {
    return value.toString()
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => toJsonValue(entry, `${path}[${index}]`))
  }
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, JsonValue> = {}
    for (const [key, child] of Object.entries(value)) {
      const childPath = path === '$' ? `$.${key}` : `${path}.${key}`
      assertAllowedKey(key, childPath)
      result[key] = toJsonValue(child, childPath)
    }
    return result
  }

  throw new AnalysisAiError(
    `AI payload contains unsupported value at ${path}`,
    'AI_PAYLOAD_BLOCKED_FIELD',
  )
}

export function serializeFinancialSummaryForAi(
  summary: DeterministicFinancialSummary,
): JsonValue {
  return toJsonValue(summary, '$')
}

export function measureJsonPayloadBytes(payload: JsonValue): number {
  return Buffer.byteLength(JSON.stringify(payload), 'utf8')
}

export function assertPayloadSize(
  payload: JsonValue,
  maxBytes = defaultMaxAnalysisPayloadBytes,
): number {
  const bytes = measureJsonPayloadBytes(payload)
  if (bytes > maxBytes) {
    throw new AnalysisAiError(
      `AI payload is ${bytes.toString()} bytes, exceeding limit ${maxBytes.toString()}`,
      'AI_PAYLOAD_TOO_LARGE',
    )
  }
  return bytes
}
