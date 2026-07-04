import { describe, expect, it } from 'vitest'

import type { FinancialAnalysisAiProvider } from '@hidmo/ai'
import type { createRepositories } from '@hidmo/database'
import type {
  AnalysisInput,
  AnalysisPeriod,
  FinancialAnalysisNarrative,
} from '@hidmo/finance-engine'
import {
  buildFinancialAnalysisSummary,
  syntheticHousehold,
} from '@hidmo/finance-engine'

import {
  AnalysisGenerationError,
  computeAnalysisInputHash,
  generateFinancialAnalysis,
  serializeDeterministicSummaryForStorage,
} from './service.js'
import { stableJsonStringify } from './hash.js'

type Repositories = Pick<
  ReturnType<typeof createRepositories>,
  'analysisInputs' | 'analysisSnapshots' | 'analysisJobs'
>

type SnapshotRecord = {
  id: string
  userId: string
  periodStart: string
  periodEnd: string
  inputHash: string
  formulaVersion: string
  deterministicSummary: Record<string, unknown>
  narrative: Record<string, unknown> | null
  status: 'draft' | 'complete' | 'failed'
  completedAt: Date | null
  lastErrorCode: string | null
}

type JobRecord = {
  id: string
  userId: string
  snapshotId: string | null
  periodStart: string
  periodEnd: string
  inputHash: string
  formulaVersion: string
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  completedAt: Date | null
  lastErrorCode: string | null
}

const period: AnalysisPeriod = {
  startDate: '2026-06-01',
  endDate: '2026-06-30',
  label: 'June 2026',
}

const analysisInput: AnalysisInput = {
  period,
  accounts: syntheticHousehold.accounts,
  debts: syntheticHousehold.debts,
  transactions: [
    ...syntheticHousehold.transactions,
    syntheticHousehold.loanPaymentTransaction,
  ],
  splits: syntheticHousehold.loanPaymentSplits,
  budgetLines: syntheticHousehold.budget,
  reviewedTransactionsOnly: true,
}

const narrative: FinancialAnalysisNarrative = {
  currentStanding: 'Positive free cash flow.',
  budgetSummary: 'Income exceeds expenses.',
  recommendedActions: [
    {
      priority: 'high',
      title: 'Assign surplus',
      rationale: 'Available surplus should be given a job.',
    },
  ],
  caveats: ['Reviewed transactions only.'],
  disclaimer: 'Planning assistance only.',
}

function createSuccessfulProvider(
  calls: string[] = [],
): FinancialAnalysisAiProvider {
  return {
    async generateNarrative(request) {
      calls.push(request.snapshotId ?? 'missing-snapshot')
      return {
        narrative,
        metadata: {
          provider: 'test',
          model: 'test-model',
          promptVersion: 'financial-analysis-narrative/v1',
          outputSchemaVersion: 1,
          inputBytes: 100,
          outputBytes: 200,
        },
      }
    },
  }
}

function createRepositoriesFake(input: AnalysisInput = analysisInput) {
  const snapshots = new Map<string, SnapshotRecord>()
  const jobs = new Map<string, JobRecord>()
  const transitions: string[] = []

  function keyFor(inputHash: string, formulaVersion: string) {
    return `${period.startDate}:${period.endDate}:${inputHash}:${formulaVersion}`
  }

  const repositories = {
    analysisInputs: {
      async buildForPeriod() {
        return input
      },
    },
    analysisSnapshots: {
      async createDraft(createInput: {
        id: string
        userId: string
        period: AnalysisPeriod
        inputHash: string
        formulaVersion: string
        deterministicSummary: Record<string, unknown>
      }) {
        transitions.push('snapshot:draft')
        const key = keyFor(createInput.inputHash, createInput.formulaVersion)
        const existing = snapshots.get(key)
        const snapshot: SnapshotRecord = {
          id: existing?.id ?? createInput.id,
          userId: createInput.userId,
          periodStart: createInput.period.startDate,
          periodEnd: createInput.period.endDate,
          inputHash: createInput.inputHash,
          formulaVersion: createInput.formulaVersion,
          deterministicSummary: createInput.deterministicSummary,
          narrative: null,
          status: 'draft',
          completedAt: null,
          lastErrorCode: null,
        }
        snapshots.set(key, snapshot)
        return snapshot
      },
      async getForInput(
        _userId: string,
        _period: AnalysisPeriod,
        inputHash: string,
        formulaVersion: string,
      ) {
        return snapshots.get(keyFor(inputHash, formulaVersion))
      },
      async markComplete(snapshotId: string, completedNarrative: object) {
        transitions.push('snapshot:complete')
        const snapshot = [...snapshots.values()].find(
          (candidate) => candidate.id === snapshotId,
        )
        if (snapshot === undefined) throw new Error('snapshot missing')
        snapshot.status = 'complete'
        snapshot.narrative = completedNarrative as Record<string, unknown>
        snapshot.completedAt = new Date('2026-07-01T00:00:00.000Z')
        return snapshot
      },
      async markFailed(snapshotId: string, errorCode: string) {
        transitions.push(`snapshot:failed:${errorCode}`)
        const snapshot = [...snapshots.values()].find(
          (candidate) => candidate.id === snapshotId,
        )
        if (snapshot === undefined) throw new Error('snapshot missing')
        snapshot.status = 'failed'
        snapshot.lastErrorCode = errorCode
        snapshot.completedAt = new Date('2026-07-01T00:00:00.000Z')
        return snapshot
      },
    },
    analysisJobs: {
      async createQueued(createInput: {
        id: string
        userId: string
        snapshotId?: string
        period: AnalysisPeriod
        inputHash: string
        formulaVersion: string
      }) {
        transitions.push('job:queued')
        const job: JobRecord = {
          id: createInput.id,
          userId: createInput.userId,
          snapshotId: createInput.snapshotId ?? null,
          periodStart: createInput.period.startDate,
          periodEnd: createInput.period.endDate,
          inputHash: createInput.inputHash,
          formulaVersion: createInput.formulaVersion,
          status: 'queued',
          completedAt: null,
          lastErrorCode: null,
        }
        jobs.set(job.id, job)
        return job
      },
      async markRunning(jobId: string) {
        transitions.push('job:running')
        const job = jobs.get(jobId)
        if (job === undefined) throw new Error('job missing')
        job.status = 'running'
        return job
      },
      async markSucceeded(jobId: string, snapshotId: string) {
        transitions.push('job:succeeded')
        const job = jobs.get(jobId)
        if (job === undefined) throw new Error('job missing')
        job.status = 'succeeded'
        job.snapshotId = snapshotId
        job.completedAt = new Date('2026-07-01T00:00:00.000Z')
        return job
      },
      async markFailed(jobId: string, errorCode: string) {
        transitions.push(`job:failed:${errorCode}`)
        const job = jobs.get(jobId)
        if (job === undefined) throw new Error('job missing')
        job.status = 'failed'
        job.lastErrorCode = errorCode
        job.completedAt = new Date('2026-07-01T00:00:00.000Z')
        return job
      },
    },
  } as unknown as Repositories

  return {
    repositories,
    snapshots,
    jobs,
    transitions,
  }
}

describe('analysis generation service', () => {
  it('generates deterministic summary, stores snapshot, calls provider, and marks lifecycle complete', async () => {
    const fake = createRepositoriesFake()
    const providerCalls: string[] = []

    const result = await generateFinancialAnalysis({
      userId: '00000000-0000-4000-8000-000000000001',
      period,
      repositories: fake.repositories,
      aiProvider: createSuccessfulProvider(providerCalls),
      createId: (() => {
        const ids = ['snapshot-id', 'job-id']
        return () => ids.shift() ?? 'extra-id'
      })(),
    })

    expect(result).toMatchObject({
      status: 'generated',
      snapshotId: 'snapshot-id',
      jobId: 'job-id',
      narrative,
      aiMetadata: {
        provider: 'test',
        model: 'test-model',
      },
    })
    expect(result.inputHash).toMatch(/^[0-9a-f]{64}$/)
    expect(providerCalls).toHaveLength(1)
    expect(fake.transitions).toEqual([
      'snapshot:draft',
      'job:queued',
      'job:running',
      'snapshot:complete',
      'job:succeeded',
    ])
    expect([...fake.snapshots.values()][0]?.deterministicSummary).toMatchObject(
      {
        cashFlow: {
          freeCashFlowMinor: '253500',
        },
      },
    )
    expect([...fake.jobs.values()][0]).toMatchObject({
      id: 'job-id',
      snapshotId: 'snapshot-id',
      status: 'succeeded',
    })
  })

  it('reuses a completed snapshot for the same input hash without calling provider', async () => {
    const fake = createRepositoriesFake()
    const providerCalls: string[] = []

    await generateFinancialAnalysis({
      userId: '00000000-0000-4000-8000-000000000001',
      period,
      repositories: fake.repositories,
      aiProvider: createSuccessfulProvider(providerCalls),
      createId: (() => {
        const ids = ['snapshot-id', 'job-id']
        return () => ids.shift() ?? 'extra-id'
      })(),
    })

    providerCalls.length = 0
    const reused = await generateFinancialAnalysis({
      userId: '00000000-0000-4000-8000-000000000001',
      period,
      repositories: fake.repositories,
      aiProvider: createSuccessfulProvider(providerCalls),
      createId: () => 'should-not-be-used',
    })

    expect(reused).toMatchObject({
      status: 'reused',
      snapshotId: 'snapshot-id',
      narrative,
    })
    expect(providerCalls).toHaveLength(0)
  })

  it('marks snapshot and job failed when provider generation fails', async () => {
    const fake = createRepositoriesFake()
    const failingProvider: FinancialAnalysisAiProvider = {
      async generateNarrative() {
        throw Object.assign(new Error('provider failed'), {
          code: 'AI_PROVIDER_REQUEST_FAILED',
        })
      },
    }

    await expect(
      generateFinancialAnalysis({
        userId: '00000000-0000-4000-8000-000000000001',
        period,
        repositories: fake.repositories,
        aiProvider: failingProvider,
        createId: (() => {
          const ids = ['snapshot-id', 'job-id']
          return () => ids.shift() ?? 'extra-id'
        })(),
      }),
    ).rejects.toBeInstanceOf(AnalysisGenerationError)

    expect(fake.transitions).toEqual([
      'snapshot:draft',
      'job:queued',
      'job:running',
      'snapshot:failed:AI_PROVIDER_REQUEST_FAILED',
      'job:failed:AI_PROVIDER_REQUEST_FAILED',
    ])
    expect([...fake.snapshots.values()][0]).toMatchObject({
      status: 'failed',
      lastErrorCode: 'AI_PROVIDER_REQUEST_FAILED',
    })
    expect([...fake.jobs.values()][0]).toMatchObject({
      status: 'failed',
      lastErrorCode: 'AI_PROVIDER_REQUEST_FAILED',
    })
  })

  it('serializes deterministic summaries into JSON-safe storage objects', () => {
    const result = buildFinancialAnalysisSummary(analysisInput).value
    const serialized = serializeDeterministicSummaryForStorage(result)

    expect(serialized).toMatchObject({
      cashFlow: {
        freeCashFlowMinor: '253500',
      },
      balanceSheet: {
        netWorthMinor: '4010000',
      },
    })
  })

  it('hashes logically equivalent objects independent of object key order', () => {
    expect(stableJsonStringify({ b: 2, a: 1 })).toBe(
      stableJsonStringify({ a: 1, b: 2 }),
    )
    expect(
      computeAnalysisInputHash({
        ...analysisInput,
        generatedAt: '2026-07-01T00:00:00.000Z',
      }),
    ).toMatch(/^[0-9a-f]{64}$/)
    expect(
      computeAnalysisInputHash({
        ...analysisInput,
        generatedAt: '2026-07-01T00:00:00.000Z',
      }),
    ).toBe(
      computeAnalysisInputHash({
        ...analysisInput,
        generatedAt: '2026-07-02T00:00:00.000Z',
      }),
    )
  })
})
