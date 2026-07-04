import { randomUUID } from 'node:crypto'

import type {
  AnalysisNarrativeResult,
  FinancialAnalysisAiProvider,
  JsonValue,
} from '@hidmo/ai'
import { serializeFinancialSummaryForAi } from '@hidmo/ai'
import type { createRepositories } from '@hidmo/database'
import {
  buildFinancialAnalysisSummary,
  formulaDefinitions,
  type AnalysisInput,
  type AnalysisPeriod,
  type DeterministicFinancialSummary,
  type FinancialAnalysisNarrative,
} from '@hidmo/finance-engine'

import { sha256StableJson, stableJsonStringify } from './hash.js'

type Repositories = Pick<
  ReturnType<typeof createRepositories>,
  'analysisInputs' | 'analysisSnapshots' | 'analysisJobs'
>

type JsonObject = Record<string, unknown>

export type AnalysisGenerationStatus = 'generated' | 'reused'

export type AnalysisGenerationResult = {
  status: AnalysisGenerationStatus
  userId: string
  period: AnalysisPeriod
  inputHash: string
  formulaVersion: string
  snapshotId: string
  jobId?: string
  deterministicSummary: DeterministicFinancialSummary
  narrative: FinancialAnalysisNarrative
  aiMetadata?: AnalysisNarrativeResult['metadata']
}

export type AnalysisGenerationServiceInput = {
  userId: string
  period: AnalysisPeriod
  repositories: Repositories
  aiProvider: FinancialAnalysisAiProvider
  jobId?: string
  snapshotId?: string
  locale?: string
  maxPayloadBytes?: number
  createId?: () => string
}

export class AnalysisGenerationError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'ANALYSIS_INPUT_UNAVAILABLE'
      | 'ANALYSIS_SNAPSHOT_NOT_CREATED'
      | 'ANALYSIS_JOB_NOT_CREATED'
      | 'ANALYSIS_PROVIDER_FAILED',
    readonly originalError?: unknown,
  ) {
    super(message)
    this.name = 'AnalysisGenerationError'
  }
}

function asJsonObject(value: JsonValue): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new AnalysisGenerationError(
      'Serialized deterministic summary must be a JSON object.',
      'ANALYSIS_SNAPSHOT_NOT_CREATED',
    )
  }
  return value as JsonObject
}

export function serializeDeterministicSummaryForStorage(
  summary: DeterministicFinancialSummary,
): JsonObject {
  return asJsonObject(serializeFinancialSummaryForAi(summary))
}

export function computeAnalysisInputHash(input: AnalysisInput): string {
  const stableInput = { ...input }
  delete stableInput.generatedAt
  return sha256StableJson(stableInput)
}

export function computeAnalysisSummaryHash(
  summary: DeterministicFinancialSummary,
): string {
  return sha256StableJson(serializeFinancialSummaryForAi(summary))
}

function providerErrorCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code
  }
  return 'ANALYSIS_PROVIDER_FAILED'
}

export async function generateFinancialAnalysis(
  input: AnalysisGenerationServiceInput,
): Promise<AnalysisGenerationResult> {
  const createId = input.createId ?? randomUUID
  const formulaVersion = formulaDefinitions.financialAnalysisSummary.version
  const analysisInput = await input.repositories.analysisInputs.buildForPeriod(
    input.userId,
    input.period,
  )
  const deterministicSummary =
    buildFinancialAnalysisSummary(analysisInput).value
  const inputHash = computeAnalysisInputHash(analysisInput)

  const existingSnapshot =
    await input.repositories.analysisSnapshots.getForInput(
      input.userId,
      input.period,
      inputHash,
      formulaVersion,
    )

  if (
    existingSnapshot !== undefined &&
    existingSnapshot.status === 'complete' &&
    existingSnapshot.narrative !== null
  ) {
    return {
      status: 'reused',
      userId: input.userId,
      period: input.period,
      inputHash,
      formulaVersion,
      snapshotId: existingSnapshot.id,
      deterministicSummary,
      narrative: existingSnapshot.narrative as FinancialAnalysisNarrative,
    }
  }

  const snapshot = await input.repositories.analysisSnapshots.createDraft({
    id: input.snapshotId ?? createId(),
    userId: input.userId,
    period: input.period,
    inputHash,
    formulaVersion,
    deterministicSummary:
      serializeDeterministicSummaryForStorage(deterministicSummary),
  })

  if (snapshot === undefined) {
    throw new AnalysisGenerationError(
      'Analysis snapshot could not be created.',
      'ANALYSIS_SNAPSHOT_NOT_CREATED',
    )
  }

  const job = await input.repositories.analysisJobs.createQueued({
    id: input.jobId ?? createId(),
    userId: input.userId,
    snapshotId: snapshot.id,
    period: input.period,
    inputHash,
    formulaVersion,
  })

  if (job === undefined) {
    await input.repositories.analysisSnapshots.markFailed(
      snapshot.id,
      'ANALYSIS_JOB_NOT_CREATED',
    )
    throw new AnalysisGenerationError(
      'Analysis job could not be created.',
      'ANALYSIS_JOB_NOT_CREATED',
    )
  }

  await input.repositories.analysisJobs.markRunning(job.id)

  let aiResult: AnalysisNarrativeResult
  try {
    aiResult = await input.aiProvider.generateNarrative({
      summary: deterministicSummary,
      snapshotId: snapshot.id,
      ...(input.locale === undefined ? {} : { locale: input.locale }),
      ...(input.maxPayloadBytes === undefined
        ? {}
        : { maxPayloadBytes: input.maxPayloadBytes }),
    })
  } catch (error) {
    const code = providerErrorCode(error)
    await input.repositories.analysisSnapshots.markFailed(snapshot.id, code)
    await input.repositories.analysisJobs.markFailed(job.id, code)
    throw new AnalysisGenerationError(
      'Analysis provider failed while generating narrative.',
      'ANALYSIS_PROVIDER_FAILED',
      error,
    )
  }

  await input.repositories.analysisSnapshots.markComplete(
    snapshot.id,
    aiResult.narrative as unknown as JsonObject,
  )
  await input.repositories.analysisJobs.markSucceeded(job.id, snapshot.id)

  return {
    status: 'generated',
    userId: input.userId,
    period: input.period,
    inputHash,
    formulaVersion,
    snapshotId: snapshot.id,
    jobId: job.id,
    deterministicSummary,
    narrative: aiResult.narrative,
    aiMetadata: aiResult.metadata,
  }
}

export function analysisInputDebugFingerprint(input: AnalysisInput): string {
  return stableJsonStringify(input)
}
