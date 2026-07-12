'use client'

import { useState } from 'react'

export type AccountDeletionStatus = {
  status: 'none' | 'queued' | 'running' | 'succeeded' | 'failed'
  deletionRequestId: string | null
}

const CONFIRMATION_PHRASE = 'DELETE MY HIDMO ACCOUNT'

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

function statusLabel(status: AccountDeletionStatus['status']) {
  switch (status) {
    case 'none':
      return 'Not requested'
    case 'queued':
      return 'Queued'
    case 'running':
      return 'Running'
    case 'succeeded':
      return 'Completed'
    case 'failed':
      return 'Failed'
  }
}

export function AccountDeletionCard({
  initialStatus,
}: {
  initialStatus: AccountDeletionStatus
}) {
  const [status, setStatus] = useState(initialStatus)
  const [confirmationPhrase, setConfirmationPhrase] = useState('')
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState('')

  const active = status.status === 'queued' || status.status === 'running'
  const canSubmit = confirmationPhrase === CONFIRMATION_PHRASE && !working

  async function requestDeletion() {
    setWorking(true)
    setMessage('Queueing full account deletion…')
    try {
      const token = await csrfToken()
      const response = await fetch('/api/account/deletion', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csrfToken: token,
          confirmationPhrase,
        }),
      })
      const body = (await response.json().catch(() => ({}))) as {
        status?: 'queued' | 'already_queued'
        deletionRequestId?: string
        error?: string
        requiredPhrase?: string
      }
      if (!response.ok) {
        throw new Error(
          body.error === undefined
            ? 'Account deletion could not be queued.'
            : `Account deletion could not be queued: ${body.error}.`,
        )
      }

      setStatus({
        status: body.status === 'already_queued' ? 'queued' : 'queued',
        deletionRequestId: body.deletionRequestId ?? null,
      })
      setConfirmationPhrase('')
      setMessage('Full account deletion queued. Refresh shortly for status.')
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Account deletion request failed.',
      )
    } finally {
      setWorking(false)
    }
  }

  return (
    <section className="dangerZone">
      <div>
        <p className="sectionLabel">Danger zone</p>
        <h2>Full account deletion</h2>
        <p>
          This queues deletion of your Hidmo account data. The worker revokes
          Plaid access where possible, destroys local token material, and
          deletes financial records through the database cascade. Only
          content-free deletion audit status/counts are retained.
        </p>
      </div>

      <div className="deletionStatusPanel">
        <span>Deletion status</span>
        <strong>{statusLabel(status.status)}</strong>
        {status.deletionRequestId === null ? null : (
          <p>Request: {status.deletionRequestId}</p>
        )}
        {active ? (
          <p>
            Account deletion is active. Export, sync, analysis, recommendations,
            and Plaid connection changes are disabled.
          </p>
        ) : null}
      </div>

      <label className="dangerConfirm">
        <span>
          Type <strong>{CONFIRMATION_PHRASE}</strong> to queue full account
          deletion.
        </span>
        <input
          autoComplete="off"
          disabled={active || working}
          onChange={(event) => setConfirmationPhrase(event.target.value)}
          placeholder={CONFIRMATION_PHRASE}
          type="text"
          value={confirmationPhrase}
        />
      </label>

      <button
        className="dangerButton"
        disabled={active || !canSubmit}
        onClick={requestDeletion}
        type="button"
      >
        {active
          ? 'Deletion already queued'
          : working
            ? 'Queueing deletion…'
            : 'Queue full account deletion'}
      </button>

      {message === '' ? null : (
        <p className="connectionStatus" role="status">
          {message}
        </p>
      )}
    </section>
  )
}
