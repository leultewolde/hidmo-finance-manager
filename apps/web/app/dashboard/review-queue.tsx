'use client'

import { useState } from 'react'

interface ReviewTransaction {
  id: string
  merchant: string
  accountName: string
  accountMask: string | null
  postedDate: string
  amountMinor: string
  currency: string
  economicType: string
  category: string
  providerCategory: string | null
  confidenceBps: number | null
  reviewed: boolean
  splitCount: number
}

interface MatchView {
  id: string
  outLabel: string
  inLabel: string
  scoreBps: number
  method: string
}

interface RuleView {
  id: string
  condition: string
  category: string
  economicType: string
}

async function csrfToken() {
  const response = await fetch('/api/auth/csrf', {
    cache: 'no-store',
    credentials: 'same-origin',
  })
  const body = (await response.json()) as { csrfToken?: string }
  if (!response.ok || body.csrfToken === undefined) {
    throw new Error('Could not initialize secure request')
  }
  return body.csrfToken
}

function TransactionEditor({
  transaction,
}: {
  transaction: ReviewTransaction
}) {
  const [economicType, setEconomicType] = useState(transaction.economicType)
  const [category, setCategory] = useState(transaction.category)
  const [working, setWorking] = useState(false)
  const [savedClassification, setSavedClassification] = useState({
    economicType: transaction.economicType,
    category: transaction.category,
  })
  const [splitCount, setSplitCount] = useState(transaction.splitCount)
  const [feedback, setFeedback] = useState<{
    kind: 'success' | 'error'
    message: string
  } | null>(null)
  const dirty =
    economicType !== savedClassification.economicType ||
    category.trim() !== savedClassification.category

  function errorMessage(error: unknown, fallback: string) {
    return error instanceof Error ? error.message : fallback
  }

  async function save() {
    setFeedback(null)
    if (category.trim() === '') {
      setFeedback({ kind: 'error', message: 'Category is required.' })
      return
    }
    try {
      setWorking(true)
      const token = await csrfToken()
      const response = await fetch(`/api/transactions/${transaction.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csrfToken: token,
          economicType,
          category,
        }),
      })
      const result = (await response.json().catch(() => ({}))) as {
        message?: string
      }
      if (!response.ok) {
        throw new Error(result.message ?? 'The correction could not be saved.')
      }
      const normalizedCategory = category.trim()
      setCategory(normalizedCategory)
      setSavedClassification({ economicType, category: normalizedCategory })
      setFeedback({
        kind: 'success',
        message: 'Applied. This transaction is now reviewed.',
      })
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: errorMessage(error, 'The correction could not be saved.'),
      })
    } finally {
      setWorking(false)
    }
  }

  async function createRule() {
    setFeedback(null)
    try {
      setWorking(true)
      const token = await csrfToken()
      const response = await fetch('/api/classification-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csrfToken: token,
          merchantContains: transaction.merchant,
          economicType,
          category,
        }),
      })
      const result = (await response.json().catch(() => ({}))) as {
        message?: string
      }
      if (!response.ok) {
        throw new Error(result.message ?? 'The rule could not be saved.')
      }
      setFeedback({
        kind: 'success',
        message: `Rule applied to merchants containing “${transaction.merchant}”.`,
      })
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: errorMessage(error, 'The rule could not be saved.'),
      })
    } finally {
      setWorking(false)
    }
  }

  async function split() {
    setFeedback(null)
    const firstCategory = window.prompt('First split category')
    if (firstCategory === null) return
    if (firstCategory.trim() === '') {
      setFeedback({
        kind: 'error',
        message: 'The first split category is required.',
      })
      return
    }
    const firstAmount = window.prompt('First split amount in dollars')
    if (firstAmount === null) return
    const cents = Math.round(Number(firstAmount) * 100)
    if (!Number.isFinite(cents) || cents <= 0) {
      setFeedback({
        kind: 'error',
        message: 'Enter a positive dollar amount, such as 20 or 20.50.',
      })
      return
    }

    const total = BigInt(transaction.amountMinor)
    const signedFirst = total < 0n ? -BigInt(cents) : BigInt(cents)
    const remainder = total - signedFirst
    if (
      remainder === 0n ||
      (total < 0n && remainder > 0n) ||
      (total > 0n && remainder < 0n)
    ) {
      setFeedback({
        kind: 'error',
        message: 'The first split must be smaller than the transaction total.',
      })
      return
    }
    const secondCategory =
      window.prompt('Second split category', transaction.category) ??
      transaction.category
    if (secondCategory.trim() === '') {
      setFeedback({
        kind: 'error',
        message: 'The second split category is required.',
      })
      return
    }

    try {
      setWorking(true)
      const token = await csrfToken()
      const response = await fetch(
        `/api/transactions/${transaction.id}/splits`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            csrfToken: token,
            splits: [
              {
                amountMinor: signedFirst.toString(),
                economicType,
                category: firstCategory.trim(),
              },
              {
                amountMinor: remainder.toString(),
                economicType,
                category: secondCategory.trim(),
              },
            ],
          }),
        },
      )
      const result = (await response.json()) as { message?: string }
      if (!response.ok) {
        throw new Error(result.message ?? 'The split could not be saved.')
      }
      setFeedback({
        kind: 'success',
        message: 'Applied. The transaction is split into two categories.',
      })
      setSplitCount(2)
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: errorMessage(error, 'The split could not be saved.'),
      })
    } finally {
      setWorking(false)
    }
  }

  async function removeSplits() {
    setFeedback(null)
    try {
      setWorking(true)
      const token = await csrfToken()
      const response = await fetch(
        `/api/transactions/${transaction.id}/splits`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ csrfToken: token }),
        },
      )
      const result = (await response.json()) as { message?: string }
      if (!response.ok) {
        throw new Error(result.message ?? 'The splits could not be removed.')
      }
      setFeedback({
        kind: 'success',
        message: 'Applied. The transaction split was removed.',
      })
      setSplitCount(0)
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: errorMessage(error, 'The splits could not be removed.'),
      })
    } finally {
      setWorking(false)
    }
  }

  return (
    <article className="reviewCard">
      <header className="reviewCardHeader">
        <div className="reviewTransaction">
          <span className="reviewDate">
            {new Date(`${transaction.postedDate}T00:00:00`).toLocaleDateString(
              'en-US',
              { month: 'short', day: 'numeric', year: 'numeric' },
            )}
          </span>
          <h3>{transaction.merchant}</h3>
          <p>
            {transaction.accountName}
            {transaction.accountMask === null
              ? ''
              : ` •••• ${transaction.accountMask}`}
          </p>
        </div>
        <strong className="reviewAmount">
          {new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: transaction.currency,
          }).format(Number(transaction.amountMinor) / 100)}
        </strong>
      </header>
      <div className="classificationContext">
        <div>
          <span>Current classification</span>
          <strong>
            {savedClassification.economicType.replaceAll('_', ' ')} ·{' '}
            {savedClassification.category}
          </strong>
        </div>
        <div>
          <span>Plaid suggestion</span>
          <strong>{transaction.providerCategory ?? 'No suggestion'}</strong>
        </div>
        <div>
          <span>Confidence</span>
          <strong>{Math.round((transaction.confidenceBps ?? 0) / 100)}%</strong>
        </div>
      </div>
      <div className="reviewControls">
        <label>
          Type
          <select
            disabled={working}
            onChange={(event) => {
              setEconomicType(event.target.value)
              setFeedback(null)
            }}
            value={economicType}
          >
            <option value="expense">Expense</option>
            <option value="income">Income</option>
            <option value="refund">Refund</option>
            <option value="transfer">Transfer</option>
            <option value="debt_payment">Debt payment</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
        <label className="categoryField">
          Category
          <input
            disabled={working}
            onChange={(event) => {
              setCategory(event.target.value)
              setFeedback(null)
            }}
            value={category}
          />
        </label>
      </div>
      <div className="reviewActions">
        <button
          className="primaryButton"
          disabled={working || !dirty}
          onClick={save}
          type="button"
        >
          {working
            ? 'Applying…'
            : dirty
              ? 'Apply correction'
              : feedback?.kind === 'success'
                ? 'Applied'
                : 'No changes'}
        </button>
        <button
          className="secondaryButton"
          disabled={working || category.trim() === ''}
          onClick={createRule}
          type="button"
        >
          Save as rule
        </button>
        <button
          className="textButton"
          disabled={working}
          onClick={split}
          type="button"
        >
          Split
        </button>
        {splitCount > 0 ? (
          <button
            className="textButton"
            disabled={working}
            onClick={removeSplits}
            type="button"
          >
            Remove {splitCount} splits
          </button>
        ) : null}
        {dirty ? <span className="unsavedBadge">Unsaved changes</span> : null}
      </div>
      {feedback === null ? null : (
        <p
          className={`reviewFeedback ${feedback.kind}`}
          role={feedback.kind === 'error' ? 'alert' : 'status'}
        >
          {feedback.kind === 'success' ? '✓ ' : 'Unable to apply: '}
          {feedback.message}
        </p>
      )}
    </article>
  )
}

export function ReviewQueue({
  transactions,
  matches,
  rules,
}: {
  transactions: ReviewTransaction[]
  matches: MatchView[]
  rules: RuleView[]
}) {
  async function reviewMatch(matchId: string, decision: 'accept' | 'reject') {
    const token = await csrfToken()
    const response = await fetch(`/api/transfer-matches/${matchId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csrfToken: token, decision }),
    })
    if (response.ok) window.location.reload()
  }

  async function removeRule(ruleId: string) {
    const token = await csrfToken()
    const response = await fetch(`/api/classification-rules/${ruleId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csrfToken: token }),
    })
    if (response.ok) window.location.reload()
  }

  return (
    <section className="reviewSection">
      <div className="reviewSectionHeader">
        <div>
          <p className="sectionLabel">Human review</p>
          <h2>Classification queue</h2>
          <p>
            Review low-confidence transactions. Applied corrections remain
            visible until you refresh.
          </p>
        </div>
        <strong className="queueCount">
          {transactions.length} {transactions.length === 1 ? 'item' : 'items'}
        </strong>
      </div>
      {transactions.length === 0 ? (
        <p className="emptyConnections">No uncertain transactions.</p>
      ) : (
        <div className="reviewGrid">
          {transactions.map((transaction) => (
            <TransactionEditor key={transaction.id} transaction={transaction} />
          ))}
        </div>
      )}

      {matches.length === 0 ? null : (
        <div className="matchQueue">
          <h3>Possible transfers</h3>
          {matches.map((match) => (
            <article className="reviewCard" key={match.id}>
              <p>
                {match.outLabel} ↔ {match.inLabel} ·{' '}
                {match.method.replaceAll('_', ' ')} ·{' '}
                {Math.round(match.scoreBps / 100)}%
              </p>
              <div className="connectionActions">
                <button
                  className="secondaryButton"
                  onClick={() => reviewMatch(match.id, 'accept')}
                  type="button"
                >
                  Accept
                </button>
                <button
                  className="textButton"
                  onClick={() => reviewMatch(match.id, 'reject')}
                  type="button"
                >
                  Reject
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {rules.length === 0 ? null : (
        <div className="ruleList">
          <h3>Active rules</h3>
          {rules.map((rule) => (
            <p key={rule.id}>
              {rule.condition} → {rule.economicType.replaceAll('_', ' ')} /{' '}
              {rule.category}{' '}
              <button
                className="textButton"
                onClick={() => removeRule(rule.id)}
                type="button"
              >
                Remove
              </button>
            </p>
          ))}
        </div>
      )}
    </section>
  )
}
