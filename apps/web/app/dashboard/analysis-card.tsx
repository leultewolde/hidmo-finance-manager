'use client'

import { useMemo, useState } from 'react'

type AnalysisJobView = {
  id: string
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  lastErrorCode: string | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
}

type AnalysisNarrativeView = {
  currentStanding: string
  budgetSummary: string
  recommendedActions: {
    priority: 'high' | 'medium' | 'low'
    title: string
    rationale: string
  }[]
  caveats: string[]
  disclaimer: string
}

type AnalysisSummaryView = {
  currency: string
  netWorthMinor: string
  liquidCashMinor: string
  freeCashFlowMinor: string
  savingsRateBps: number | null
  totalDebtMinor: string
  savingsCapacityAfterMinimumDebtMinor: string
  emergencyFundCoverageMonthsHundredths: number | null
  transactionsAvailable: number
  transactionsIncluded: number
  coverageNotes: { severity: 'info' | 'warning'; message: string }[]
  riskIndicators: {
    severity: 'info' | 'warning' | 'critical'
    message: string
  }[]
}

export type AnalysisSnapshotView = {
  id: string
  status: 'draft' | 'complete' | 'failed'
  periodStart: string
  periodEnd: string
  inputHash: string
  formulaVersion: string
  createdAt: string
  completedAt: string | null
  lastErrorCode: string | null
  narrative: AnalysisNarrativeView | null
  summary: AnalysisSummaryView | null
}

type AnalysisPeriodView = {
  startDate: string
  endDate: string
  label: string
}

type QueueResponse = {
  status?: string
  error?: string
  taskName?: string
  idempotencyKey?: string
}

async function csrfToken() {
  const response = await fetch('/api/auth/csrf', {
    cache: 'no-store',
    credentials: 'same-origin',
  })
  const body = (await response.json()) as { csrfToken?: string }
  if (!response.ok || body.csrfToken === undefined) {
    throw new Error('Could not initialize a secure request.')
  }
  return body.csrfToken
}

function formatMoney(amountMinor: string, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(Number(amountMinor) / 100)
}

function formatPercentBps(value: number | null) {
  if (value === null) return 'Not enough data'
  return `${(value / 100).toFixed(1)}%`
}

function formatCoverageMonths(value: number | null) {
  if (value === null) return 'Not enough data'
  return `${(value / 100).toFixed(1)} months`
}

function formatStatus(status: AnalysisJobView['status']) {
  switch (status) {
    case 'queued':
      return 'Queued'
    case 'running':
      return 'Running'
    case 'succeeded':
      return 'Succeeded'
    case 'failed':
      return 'Failed'
  }
}

function jobMessage(job: AnalysisJobView | null) {
  if (job === null) return 'No analysis generation job has run for this period.'

  switch (job.status) {
    case 'queued':
      return `Queued ${new Date(job.createdAt).toLocaleString()}. Refresh shortly to see the result.`
    case 'running':
      return `Running since ${new Date(job.startedAt ?? job.createdAt).toLocaleString()}.`
    case 'succeeded':
      return `Completed ${new Date(job.completedAt ?? job.createdAt).toLocaleString()}.`
    case 'failed':
      return `Failed ${new Date(job.completedAt ?? job.createdAt).toLocaleString()}${job.lastErrorCode === null ? '' : ` · ${job.lastErrorCode}`}.`
  }
}

function priorityLabel(priority: 'high' | 'medium' | 'low') {
  switch (priority) {
    case 'high':
      return 'High priority'
    case 'medium':
      return 'Medium priority'
    case 'low':
      return 'Low priority'
  }
}

export function AnalysisCard({
  currentPeriod,
  latestJob,
  latestSnapshot,
}: {
  currentPeriod: AnalysisPeriodView
  latestJob: AnalysisJobView | null
  latestSnapshot: AnalysisSnapshotView | null
}) {
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState('')
  const queuedOrRunning =
    latestJob?.status === 'queued' || latestJob?.status === 'running'
  const summary = latestSnapshot?.summary ?? null
  const narrative =
    latestSnapshot?.status === 'complete' ? latestSnapshot.narrative : null

  const analysisFreshness = useMemo(() => {
    if (latestSnapshot === null) return 'No completed analysis yet'
    if (latestSnapshot.completedAt === null) {
      return `Snapshot ${latestSnapshot.status}`
    }
    return `Completed ${new Date(latestSnapshot.completedAt).toLocaleString()}`
  }, [latestSnapshot])

  async function generateAnalysis() {
    setWorking(true)
    setMessage('Queueing financial analysis…')
    try {
      const token = await csrfToken()
      const response = await fetch('/api/analysis/generate', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csrfToken: token,
          period: currentPeriod,
        }),
      })
      const body = (await response.json().catch(() => ({}))) as QueueResponse
      if (!response.ok) {
        throw new Error(
          body.error === undefined
            ? 'Analysis could not be queued.'
            : `Analysis could not be queued: ${body.error}.`,
        )
      }
      setMessage('Analysis queued. Refresh shortly to see the result.')
      setWorking(false)
    } catch (error) {
      setWorking(false)
      setMessage(error instanceof Error ? error.message : 'Analysis failed.')
    }
  }

  return (
    <section className="analysisSection">
      <div className="analysisHeader">
        <div>
          <p className="sectionLabel">AI-assisted planning</p>
          <h2>Financial analysis</h2>
          <p>
            Current period: {currentPeriod.label} ({currentPeriod.startDate} to{' '}
            {currentPeriod.endDate})
          </p>
        </div>
        <button
          className="primaryButton"
          disabled={working || queuedOrRunning}
          onClick={generateAnalysis}
          type="button"
        >
          {working
            ? 'Queueing…'
            : queuedOrRunning
              ? 'Analysis running'
              : 'Generate analysis'}
        </button>
      </div>

      {message === '' ? null : (
        <p className="connectionStatus" role="status">
          {message}
        </p>
      )}

      <div className="analysisStatusGrid">
        <article className="analysisStatusCard">
          <span>Latest snapshot</span>
          <strong>{analysisFreshness}</strong>
          <p>
            {latestSnapshot === null
              ? 'Generate an analysis to create the first stored snapshot.'
              : `${latestSnapshot.status} · ${latestSnapshot.formulaVersion}`}
          </p>
        </article>
        <article
          className={`analysisStatusCard analysisJob-${latestJob?.status ?? 'none'}`}
        >
          <span>Generation job</span>
          <strong>
            {latestJob === null
              ? 'Not started'
              : formatStatus(latestJob.status)}
          </strong>
          <p>{jobMessage(latestJob)}</p>
        </article>
      </div>

      {summary === null ? null : (
        <div className="analysisMetricGrid">
          <article>
            <span>Net worth</span>
            <strong>
              {formatMoney(summary.netWorthMinor, summary.currency)}
            </strong>
          </article>
          <article>
            <span>Free cash flow</span>
            <strong>
              {formatMoney(summary.freeCashFlowMinor, summary.currency)}
            </strong>
          </article>
          <article>
            <span>Savings rate</span>
            <strong>{formatPercentBps(summary.savingsRateBps)}</strong>
          </article>
          <article>
            <span>Emergency coverage</span>
            <strong>
              {formatCoverageMonths(
                summary.emergencyFundCoverageMonthsHundredths,
              )}
            </strong>
          </article>
          <article>
            <span>Total debt</span>
            <strong>
              {formatMoney(summary.totalDebtMinor, summary.currency)}
            </strong>
          </article>
          <article>
            <span>Savings capacity</span>
            <strong>
              {formatMoney(
                summary.savingsCapacityAfterMinimumDebtMinor,
                summary.currency,
              )}
            </strong>
          </article>
        </div>
      )}

      {narrative === null ? (
        <div className="analysisEmpty">
          <strong>No completed AI narrative yet.</strong>
          <p>
            Generate analysis to create an explainable snapshot with current
            standing, budget guidance, and prioritized actions.
          </p>
        </div>
      ) : (
        <div className="analysisNarrativeGrid">
          <article>
            <p className="sectionLabel">Current standing</p>
            <p>{narrative.currentStanding}</p>
          </article>
          <article>
            <p className="sectionLabel">Budget summary</p>
            <p>{narrative.budgetSummary}</p>
          </article>
          <article className="analysisActionsCard">
            <p className="sectionLabel">Action plan</p>
            <ol>
              {narrative.recommendedActions.map((action) => (
                <li key={`${action.priority}:${action.title}`}>
                  <div>
                    <span>{priorityLabel(action.priority)}</span>
                    <strong>{action.title}</strong>
                    <p>{action.rationale}</p>
                  </div>
                </li>
              ))}
            </ol>
          </article>
        </div>
      )}

      <details className="analysisCaveats">
        <summary>Coverage, caveats, and safety notes</summary>
        <div>
          {summary === null ? null : (
            <p>
              Used {summary.transactionsIncluded.toLocaleString()} of{' '}
              {summary.transactionsAvailable.toLocaleString()} available
              transactions for this period.
            </p>
          )}
          {summary?.coverageNotes.map((note) => (
            <p key={note.message} className={`coverageNote-${note.severity}`}>
              {note.message}
            </p>
          ))}
          {summary?.riskIndicators.map((risk) => (
            <p key={risk.message} className={`riskNote-${risk.severity}`}>
              {risk.message}
            </p>
          ))}
          {narrative?.caveats.map((caveat) => (
            <p key={caveat}>{caveat}</p>
          ))}
          <p>
            {narrative?.disclaimer ??
              'This is planning assistance based on your app data, not financial, legal, tax, or investment advice.'}
          </p>
        </div>
      </details>
    </section>
  )
}
