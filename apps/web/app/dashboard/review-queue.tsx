'use client'

import { useState } from 'react'

interface ReviewTransaction {
  id: string
  merchant: string
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
  const [splitFeedback, setSplitFeedback] = useState<{
    kind: 'success' | 'error'
    message: string
  } | null>(null)

  async function save() {
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
    if (response.ok) window.location.reload()
    setWorking(false)
  }

  async function createRule() {
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
    if (response.ok) window.location.reload()
    setWorking(false)
  }

  async function split() {
    setSplitFeedback(null)
    const firstCategory = window.prompt('First split category')
    if (firstCategory === null) return
    if (firstCategory.trim() === '') {
      setSplitFeedback({
        kind: 'error',
        message: 'The first split category is required.',
      })
      return
    }
    const firstAmount = window.prompt('First split amount in dollars')
    if (firstAmount === null) return
    const cents = Math.round(Number(firstAmount) * 100)
    if (!Number.isFinite(cents) || cents <= 0) {
      setSplitFeedback({
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
      setSplitFeedback({
        kind: 'error',
        message: 'The first split must be smaller than the transaction total.',
      })
      return
    }
    const secondCategory =
      window.prompt('Second split category', transaction.category) ??
      transaction.category
    if (secondCategory.trim() === '') {
      setSplitFeedback({
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
      setSplitFeedback({
        kind: 'success',
        message: 'Split saved successfully. Refreshing…',
      })
      window.setTimeout(() => window.location.reload(), 900)
    } catch (error) {
      setWorking(false)
      setSplitFeedback({
        kind: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'The split could not be saved.',
      })
    }
  }

  async function removeSplits() {
    setSplitFeedback(null)
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
      setSplitFeedback({
        kind: 'success',
        message: 'Splits removed successfully. Refreshing…',
      })
      window.setTimeout(() => window.location.reload(), 900)
    } catch (error) {
      setWorking(false)
      setSplitFeedback({
        kind: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'The splits could not be removed.',
      })
    }
  }

  return (
    <article className="reviewCard">
      <div>
        <strong>{transaction.merchant}</strong>
        <p>
          {new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: transaction.currency,
          }).format(Number(transaction.amountMinor) / 100)}
          {' · '}
          Plaid: {transaction.providerCategory ?? 'No suggestion'}
          {' · '}
          confidence {Math.round((transaction.confidenceBps ?? 0) / 100)}%
        </p>
      </div>
      <div className="reviewControls">
        <select
          aria-label="Economic type"
          onChange={(event) => setEconomicType(event.target.value)}
          value={economicType}
        >
          <option value="expense">Expense</option>
          <option value="income">Income</option>
          <option value="refund">Refund</option>
          <option value="transfer">Transfer</option>
          <option value="debt_payment">Debt payment</option>
          <option value="unknown">Unknown</option>
        </select>
        <input
          aria-label="Category"
          onChange={(event) => setCategory(event.target.value)}
          value={category}
        />
        <button
          className="secondaryButton"
          disabled={working}
          onClick={save}
          type="button"
        >
          Save correction
        </button>
        <button className="textButton" onClick={createRule} type="button">
          Save as rule
        </button>
        <button className="textButton" onClick={split} type="button">
          Split
        </button>
        {transaction.splitCount > 0 ? (
          <button className="textButton" onClick={removeSplits} type="button">
            Remove splits
          </button>
        ) : null}
      </div>
      {splitFeedback === null ? null : (
        <p
          className={`splitFeedback ${splitFeedback.kind}`}
          role={splitFeedback.kind === 'error' ? 'alert' : 'status'}
        >
          {splitFeedback.message}
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
      <p className="sectionLabel">Human review</p>
      <h2>Classification queue</h2>
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
