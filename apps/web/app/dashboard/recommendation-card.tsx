'use client'

import { useMemo, useState } from 'react'

type RecommendationPriority = 'high' | 'medium' | 'low'
type RecommendationStatus = 'candidate' | 'active' | 'accepted' | 'dismissed'

type RecommendationEvidenceView = {
  id: string
  kind: string
  label: string
  amountMinor: string | null
  percentageBps: number | null
  currency: string | null
  severity: 'info' | 'warning' | 'critical' | null
}

export type RecommendationView = {
  rowId: string
  candidateId: string
  type: string
  status: RecommendationStatus
  priority: RecommendationPriority
  rank: number | null
  title: string
  rationale: string
  evidence: RecommendationEvidenceView[]
  assumptions: string[]
  estimatedMonthlyImpactMinor: string | null
  currency: string
  confidenceBps: number
  formulaVersion: string
  policyVersion: string
  modelProvider: string | null
  modelName: string | null
  promptVersion: string | null
  updatedAt: string
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

function priorityLabel(priority: RecommendationPriority) {
  switch (priority) {
    case 'high':
      return 'High'
    case 'medium':
      return 'Medium'
    case 'low':
      return 'Low'
  }
}

function typeLabel(type: string) {
  return type
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function formatMoney(amountMinor: string, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(Number(amountMinor) / 100)
}

function formatPercentBps(value: number) {
  return `${(value / 100).toFixed(1)}%`
}

function statusMessage(status: RecommendationStatus) {
  switch (status) {
    case 'candidate':
      return 'Candidate awaiting grounding'
    case 'active':
      return 'Ready for review'
    case 'accepted':
      return 'Accepted'
    case 'dismissed':
      return 'Dismissed'
  }
}

export function RecommendationCard({
  currentPeriod,
  initialRecommendations,
}: {
  currentPeriod: { startDate: string; endDate: string; label: string }
  initialRecommendations: RecommendationView[]
}) {
  const [recommendations, setRecommendations] = useState(initialRecommendations)
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState('')

  const activeCount = useMemo(
    () =>
      recommendations.filter(
        (recommendation) =>
          recommendation.status === 'active' ||
          recommendation.status === 'candidate',
      ).length,
    [recommendations],
  )

  async function refreshRecommendations() {
    setWorking(true)
    setMessage('Queueing recommendation refresh…')
    try {
      const token = await csrfToken()
      const response = await fetch('/api/recommendations/generate', {
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
            ? 'Recommendation refresh could not be queued.'
            : `Recommendation refresh could not be queued: ${body.error}.`,
        )
      }
      setMessage('Recommendation refresh queued. Refresh shortly to see it.')
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Recommendation refresh failed.',
      )
    } finally {
      setWorking(false)
    }
  }

  async function updateRecommendationStatus(
    recommendation: RecommendationView,
    status: 'accepted' | 'dismissed',
  ) {
    setMessage(
      status === 'accepted'
        ? 'Saving accepted recommendation…'
        : 'Dismissing recommendation…',
    )
    try {
      const token = await csrfToken()
      const response = await fetch(
        `/api/recommendations/${recommendation.rowId}`,
        {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ csrfToken: token, status }),
        },
      )
      const body = (await response.json().catch(() => ({}))) as {
        error?: string
        recommendation?: RecommendationView
      }
      if (!response.ok || body.recommendation === undefined) {
        throw new Error(
          body.error === undefined
            ? 'Recommendation status could not be saved.'
            : `Recommendation status could not be saved: ${body.error}.`,
        )
      }
      setRecommendations((current) =>
        current.map((entry) =>
          entry.rowId === recommendation.rowId ? body.recommendation! : entry,
        ),
      )
      setMessage(
        status === 'accepted'
          ? 'Recommendation marked accepted.'
          : 'Recommendation dismissed.',
      )
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Recommendation status update failed.',
      )
    }
  }

  return (
    <section className="recommendationsSection">
      <div className="analysisHeader">
        <div>
          <p className="sectionLabel">Evidence-grounded planning</p>
          <h2>Recommendations</h2>
          <p>
            Current period: {currentPeriod.label} ({currentPeriod.startDate} to{' '}
            {currentPeriod.endDate}). Recommendations are generated from
            deterministic evidence first, then ranked and explained.
          </p>
        </div>
        <button
          className="primaryButton"
          disabled={working}
          onClick={refreshRecommendations}
          type="button"
        >
          {working ? 'Queueing…' : 'Refresh recommendations'}
        </button>
      </div>

      {message === '' ? null : (
        <p className="connectionStatus" role="status">
          {message}
        </p>
      )}

      <div className="recommendationSummaryGrid">
        <article>
          <span>Visible recommendations</span>
          <strong>{activeCount.toLocaleString()}</strong>
          <p>Active and candidate recommendations for the selected period.</p>
        </article>
        <article>
          <span>Safety rule</span>
          <strong>Evidence only</strong>
          <p>Each recommendation references deterministic evidence IDs.</p>
        </article>
      </div>

      {recommendations.length === 0 ? (
        <div className="analysisEmpty">
          <strong>No recommendations yet.</strong>
          <p>
            Refresh recommendations after transactions are synchronized and
            reviewed. The worker will build deterministic candidates, ground
            them, and store the result.
          </p>
        </div>
      ) : (
        <ol className="recommendationList">
          {recommendations.map((recommendation) => (
            <li
              className={`recommendationItem recommendationItem-${recommendation.priority}`}
              key={recommendation.rowId}
            >
              <article>
                <div className="recommendationHeader">
                  <div>
                    <p className="sectionLabel">
                      {recommendation.rank === null
                        ? 'Unranked'
                        : `Rank ${recommendation.rank}`}{' '}
                      · {priorityLabel(recommendation.priority)}
                    </p>
                    <h3>{recommendation.title}</h3>
                    <p>{recommendation.rationale}</p>
                  </div>
                  <span
                    className={`recommendationStatus recommendationStatus-${recommendation.status}`}
                  >
                    {statusMessage(recommendation.status)}
                  </span>
                </div>

                <div className="recommendationFacts">
                  <span>{typeLabel(recommendation.type)}</span>
                  <span>
                    Confidence {formatPercentBps(recommendation.confidenceBps)}
                  </span>
                  {recommendation.estimatedMonthlyImpactMinor ===
                  null ? null : (
                    <span>
                      Estimated monthly impact{' '}
                      {formatMoney(
                        recommendation.estimatedMonthlyImpactMinor,
                        recommendation.currency,
                      )}
                    </span>
                  )}
                </div>

                <details className="recommendationDetails">
                  <summary>Evidence and assumptions</summary>
                  <div className="recommendationDetailsGrid">
                    <div>
                      <h4>Evidence</h4>
                      <ul>
                        {recommendation.evidence.map((evidence) => (
                          <li key={evidence.id}>
                            <strong>{evidence.label}</strong>
                            <span>
                              {evidence.kind}
                              {evidence.amountMinor === null ||
                              evidence.currency === null
                                ? ''
                                : ` · ${formatMoney(
                                    evidence.amountMinor,
                                    evidence.currency,
                                  )}`}
                              {evidence.percentageBps === null
                                ? ''
                                : ` · ${formatPercentBps(
                                    evidence.percentageBps,
                                  )}`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h4>Assumptions</h4>
                      {recommendation.assumptions.length === 0 ? (
                        <p>No additional assumptions recorded.</p>
                      ) : (
                        <ul>
                          {recommendation.assumptions.map((assumption) => (
                            <li key={assumption}>{assumption}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </details>

                <div className="recommendationFooter">
                  <p>
                    {recommendation.modelProvider === null
                      ? 'Grounded by deterministic policy only.'
                      : `Grounded by ${recommendation.modelProvider} · ${recommendation.modelName ?? 'unknown model'} · ${recommendation.promptVersion ?? 'unknown prompt'}`}
                  </p>
                  <div>
                    <button
                      className="secondaryButton"
                      disabled={recommendation.status === 'accepted'}
                      onClick={() =>
                        void updateRecommendationStatus(
                          recommendation,
                          'accepted',
                        )
                      }
                      type="button"
                    >
                      Accept
                    </button>
                    <button
                      className="textButton"
                      disabled={recommendation.status === 'dismissed'}
                      onClick={() =>
                        void updateRecommendationStatus(
                          recommendation,
                          'dismissed',
                        )
                      }
                      type="button"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </article>
            </li>
          ))}
        </ol>
      )}

      <p className="recommendationDisclaimer">
        Planning assistance only. Recommendations are based on app data and
        deterministic policy rules; they are not financial, legal, tax, or
        investment advice.
      </p>
    </section>
  )
}
