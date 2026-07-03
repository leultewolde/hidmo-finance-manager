'use client'

import { useEffect, useState } from 'react'
import {
  usePlaidLink,
  type PlaidLinkOnExit,
  type PlaidLinkOnSuccess,
} from 'react-plaid-link'

type SyncJobView = {
  id: string
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  trigger: string
  lastErrorCode: string | null
  cloudTaskName: string | null
  result: Record<string, unknown>
  createdAt: string
  startedAt: string | null
  completedAt: string | null
}

type ConnectionHealthView = {
  accountCount: number
  transactionCount: number
  latestTransactionDate: string | null
}

export interface ConnectionView {
  id: string
  institutionName: string
  status: string
  lastSuccessfulSyncAt: string | null
  errorCode: string | null
  reconnectRequiredAt: string | null
  createdAt: string
  health: ConnectionHealthView
  latestSyncJob: SyncJobView | null
  recentSyncJobs: SyncJobView[]
  accounts: {
    id: string
    name: string
    mask: string | null
    kind: string
    currentBalanceMinor: string
    currency: string
  }[]
}

async function requestCsrfToken() {
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

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`
}

function syncErrorMessage(code: string | undefined) {
  switch (code) {
    case 'PRODUCT_NOT_READY':
      return 'Plaid is still preparing transactions. Wait about a minute, then try Sync now again.'
    case 'ITEM_LOGIN_REQUIRED':
      return 'Plaid requires this institution to be reconnected before new transactions can sync.'
    case 'INVALID_ACCESS_TOKEN':
      return 'This Plaid connection is no longer valid. Disconnect it and connect it again.'
    case 'RATE_LIMIT_EXCEEDED':
      return 'Plaid is receiving too many requests. Wait a minute, then try again.'
    case 'INTERNAL_SERVER_ERROR':
      return 'Plaid encountered a temporary error. Wait a minute, then try again.'
    case 'TOKEN_DECRYPTION_FAILED':
      return 'The saved Plaid connection cannot be unlocked. Restore the original LOCAL_TOKEN_ENCRYPTION_KEY, restart the app, and try again.'
    default:
      return code === undefined
        ? 'Transactions could not be synchronized.'
        : `Transactions could not be synchronized. Plaid error: ${code}.`
  }
}

function daysSince(value: string | null) {
  if (value === null) return null
  return Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000)
}

function connectionHealth(connection: ConnectionView): {
  status: 'healthy' | 'syncing' | 'warning' | 'error'
  title: string
  details: string[]
} {
  const latestJob = connection.latestSyncJob
  const syncAgeDays = daysSince(connection.lastSuccessfulSyncAt)
  const details = [
    pluralize(connection.health.accountCount, 'active account'),
    pluralize(connection.health.transactionCount, 'transaction'),
  ]

  if (connection.health.latestTransactionDate !== null) {
    details.push(
      `Latest transaction ${connection.health.latestTransactionDate}`,
    )
  }

  if (connection.lastSuccessfulSyncAt !== null) {
    details.push(
      `Last successful sync ${new Date(
        connection.lastSuccessfulSyncAt,
      ).toLocaleString()}`,
    )
  }

  if (connection.reconnectRequiredAt !== null) {
    return {
      status: 'error',
      title: 'Reconnect required',
      details: [
        ...details,
        `Reconnect requested ${new Date(
          connection.reconnectRequiredAt,
        ).toLocaleString()}`,
      ],
    }
  }

  if (connection.errorCode !== null) {
    return {
      status: 'error',
      title: 'Connection error',
      details: [...details, syncErrorMessage(connection.errorCode)],
    }
  }

  if (latestJob?.status === 'failed') {
    return {
      status: 'error',
      title: 'Latest sync failed',
      details: [
        ...details,
        syncErrorMessage(latestJob.lastErrorCode ?? undefined),
      ],
    }
  }

  if (latestJob?.status === 'queued' || latestJob?.status === 'running') {
    return {
      status: 'syncing',
      title: latestJob.status === 'queued' ? 'Sync queued' : 'Sync running',
      details,
    }
  }

  if (connection.lastSuccessfulSyncAt === null) {
    return {
      status: 'warning',
      title: 'No successful sync yet',
      details,
    }
  }

  if (syncAgeDays !== null && syncAgeDays >= 2) {
    return {
      status: 'warning',
      title: `Data may be stale (${syncAgeDays} days)`,
      details,
    }
  }

  if (connection.health.accountCount === 0) {
    return {
      status: 'warning',
      title: 'No active accounts',
      details,
    }
  }

  if (connection.health.transactionCount === 0) {
    return {
      status: 'warning',
      title: 'No transactions synchronized',
      details,
    }
  }

  return {
    status: 'healthy',
    title: 'Data current',
    details,
  }
}

function connectionNeedsReconnect(connection: ConnectionView) {
  return (
    connection.status === 'attention_required' ||
    connection.reconnectRequiredAt !== null ||
    connection.errorCode === 'ITEM_LOGIN_REQUIRED' ||
    connection.errorCode === 'INVALID_ACCESS_TOKEN' ||
    connection.errorCode === 'ITEM_NOT_SUPPORTED'
  )
}

function numberResult(
  result: Record<string, unknown>,
  key: 'added' | 'modified' | 'removed' | 'classified',
) {
  const value = result[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function syncJobCompletedAt(job: SyncJobView) {
  return job.completedAt ?? job.startedAt ?? job.createdAt
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString()
}

function formatSyncTrigger(trigger: string) {
  return trigger
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ')
}

function formatSyncStatus(status: SyncJobView['status']) {
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

function syncJobTimestampLabel(job: SyncJobView) {
  switch (job.status) {
    case 'queued':
      return `Queued ${formatDateTime(job.createdAt)}`
    case 'running':
      return `Started ${formatDateTime(job.startedAt ?? job.createdAt)}`
    case 'succeeded':
      return `Completed ${formatDateTime(job.completedAt ?? job.createdAt)}`
    case 'failed':
      return `Failed ${formatDateTime(job.completedAt ?? job.createdAt)}`
  }
}

function syncResultSummary(job: SyncJobView) {
  if (job.status === 'queued') return 'Waiting for worker'
  if (job.status === 'running') return 'Worker is processing'
  if (job.status === 'failed') {
    return syncErrorMessage(job.lastErrorCode ?? undefined)
  }

  const added = numberResult(job.result, 'added')
  const modified = numberResult(job.result, 'modified')
  const removed = numberResult(job.result, 'removed')
  const classified = numberResult(job.result, 'classified')

  if (added === 0 && modified === 0 && removed === 0 && classified === 0) {
    return 'No transaction changes'
  }

  return `${added} added · ${modified} updated · ${removed} removed · ${classified} classified`
}

function syncJobMessage(connection: ConnectionView) {
  const job = connection.latestSyncJob
  if (job === null) return null

  switch (job.status) {
    case 'queued':
      return `Sync queued ${formatDateTime(job.createdAt)}. Refresh shortly to see progress.`
    case 'running':
      return `Sync running since ${formatDateTime(job.startedAt ?? job.createdAt)}.`
    case 'succeeded':
      return `Latest sync completed ${formatDateTime(
        job.completedAt ?? job.createdAt,
      )} · ${numberResult(job.result, 'added')} added, ${numberResult(
        job.result,
        'modified',
      )} updated, ${numberResult(job.result, 'removed')} removed, ${numberResult(
        job.result,
        'classified',
      )} classified.`
    case 'failed':
      return `${syncErrorMessage(
        job.lastErrorCode ?? undefined,
      )} Retry uses the same safe manual sync queue. Last attempt failed ${formatDateTime(
        job.completedAt ?? job.createdAt,
      )}.`
  }
}

function syncJobDetails(job: SyncJobView) {
  const details = [
    `${formatSyncTrigger(job.trigger)} trigger`,
    syncJobTimestampLabel(job),
  ]

  if (job.cloudTaskName !== null) {
    details.push(
      `Task ${job.cloudTaskName.split('/').at(-1) ?? job.cloudTaskName}`,
    )
  }

  if (job.status === 'failed' && job.lastErrorCode !== null) {
    details.push(`Error ${job.lastErrorCode}`)
  }

  return details
}

function syncActionLabel(connection: ConnectionView, needsReconnect: boolean) {
  if (needsReconnect) return 'Reconnect required'

  switch (connection.latestSyncJob?.status) {
    case 'queued':
      return 'Sync queued'
    case 'running':
      return 'Sync running'
    case 'failed':
      return 'Retry sync'
    default:
      return 'Sync now'
  }
}

function disconnectErrorMessage(code: string | undefined) {
  switch (code) {
    case 'TOKEN_DECRYPTION_FAILED':
      return 'The saved Plaid connection cannot be unlocked. Restore the original LOCAL_TOKEN_ENCRYPTION_KEY, restart the app, and try again.'
    case 'ITEM_LOGIN_REQUIRED':
    case 'INVALID_ACCESS_TOKEN':
    case 'ITEM_NOT_FOUND':
      return 'Plaid no longer recognizes this connection. Its local data must be removed before reconnecting.'
    case 'CONNECTION_NOT_FOUND':
      return 'This connection is no longer available. Refresh the dashboard before trying again.'
    case 'INTERNAL_SERVER_ERROR':
    case 'RATE_LIMIT_EXCEEDED':
      return 'Plaid could not disconnect the institution temporarily. Wait a minute, then try again.'
    default:
      return code === undefined
        ? 'The institution could not be disconnected.'
        : `The institution could not be disconnected. Plaid error: ${code}.`
  }
}

export function PlaidConnectionManager({
  initialConnections,
}: {
  initialConnections: ConnectionView[]
}) {
  const [linkToken, setLinkToken] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [working, setWorking] = useState(false)

  const onSuccess: PlaidLinkOnSuccess = async (publicToken) => {
    setStatus('Securing connection and importing accounts…')
    try {
      const csrfToken = await requestCsrfToken()
      const response = await fetch('/api/plaid/exchange', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csrfToken, publicToken }),
      })
      if (!response.ok) {
        throw new Error('The connected institution could not be saved.')
      }
      window.location.reload()
    } catch (error) {
      setWorking(false)
      setLinkToken(null)
      setStatus(error instanceof Error ? error.message : 'Connection failed.')
    }
  }

  const onExit: PlaidLinkOnExit = (error) => {
    setWorking(false)
    setLinkToken(null)
    setStatus(
      error === null
        ? 'Connection canceled.'
        : 'Plaid Link closed before the connection completed.',
    )
  }

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit,
  })

  useEffect(() => {
    if (linkToken !== null && ready) {
      open()
    }
  }, [linkToken, open, ready])

  async function beginConnection() {
    setWorking(true)
    setStatus('Preparing a secure Plaid Link session…')
    try {
      const response = await fetch('/api/plaid/link-token', {
        method: 'POST',
        credentials: 'same-origin',
      })
      const body = (await response.json()) as { linkToken?: string }
      if (!response.ok || body.linkToken === undefined) {
        throw new Error('Plaid Link could not be initialized.')
      }
      setLinkToken(body.linkToken)
      setStatus('')
    } catch (error) {
      setWorking(false)
      setStatus(error instanceof Error ? error.message : 'Connection failed.')
    }
  }

  async function disconnect(connectionId: string) {
    if (
      !window.confirm('Disconnect this institution and remove its accounts?')
    ) {
      return
    }
    setWorking(true)
    setStatus('Revoking Plaid access…')
    try {
      const csrfToken = await requestCsrfToken()
      const response = await fetch(`/api/connections/${connectionId}`, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csrfToken }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          code?: string
        }
        throw new Error(disconnectErrorMessage(body.code))
      }
      window.location.reload()
    } catch (error) {
      setWorking(false)
      setStatus(error instanceof Error ? error.message : 'Disconnect failed.')
    }
  }

  async function sync(connectionId: string) {
    setWorking(true)
    setStatus('Synchronizing transaction updates…')
    try {
      const csrfToken = await requestCsrfToken()
      const response = await fetch(`/api/connections/${connectionId}/sync`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csrfToken }),
      })
      const body = (await response.json().catch(() => ({}))) as {
        code?: string
        error?: string
        reason?: string
        status?: string
        syncJobId?: string
      }
      if (!response.ok) {
        throw new Error(
          response.status === 409
            ? body.code === 'ITEM_LOGIN_REQUIRED' ||
              body.code === 'INVALID_ACCESS_TOKEN' ||
              body.code === 'ITEM_NOT_SUPPORTED'
              ? syncErrorMessage(body.code)
              : 'A synchronization is already running.'
            : syncErrorMessage(body.code),
        )
      }
      setWorking(false)
      if (body.status === 'ignored') {
        setStatus(
          body.reason === 'recent_noop_sync'
            ? 'Recent synchronization found no changes. Wait about a minute before syncing again.'
            : 'A synchronization is already queued or running. Refresh shortly to see progress.',
        )
      } else {
        setStatus('Synchronization queued. Refresh shortly to see progress.')
      }
    } catch (error) {
      setWorking(false)
      setStatus(error instanceof Error ? error.message : 'Sync failed.')
    }
  }

  return (
    <section className="connectionsSection">
      <div className="connectionsHeading">
        <div>
          <p className="sectionLabel">Plaid Sandbox</p>
          <h2>Connected institutions</h2>
        </div>
        <button
          className="primaryButton"
          disabled={working}
          onClick={beginConnection}
          type="button"
        >
          {working ? 'Working…' : 'Connect account'}
        </button>
      </div>

      {status === '' ? null : (
        <p className="connectionStatus" role="status">
          {status}
        </p>
      )}

      {initialConnections.length === 0 ? (
        <div className="emptyConnections">
          No institutions connected. Use Plaid Sandbox to add test accounts.
        </div>
      ) : (
        <div className="connectionGrid">
          {initialConnections.map((connection) => (
            <ConnectionCard
              connection={connection}
              disconnect={disconnect}
              key={connection.id}
              sync={sync}
              working={working}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function ConnectionCard({
  connection,
  disconnect,
  sync,
  working,
}: {
  connection: ConnectionView
  disconnect(connectionId: string): void
  sync(connectionId: string): void
  working: boolean
}) {
  const health = connectionHealth(connection)
  const needsReconnect = connectionNeedsReconnect(connection)
  const syncButtonLabel = syncActionLabel(connection, needsReconnect)

  return (
    <article className="connectionCard">
      <div className="connectionCardHeader">
        <div>
          <h3>{connection.institutionName}</h3>
          <p>Connected {new Date(connection.createdAt).toLocaleDateString()}</p>
          <p>
            {connection.lastSuccessfulSyncAt === null
              ? 'Transactions not synchronized yet'
              : `Last synced ${new Date(
                  connection.lastSuccessfulSyncAt,
                ).toLocaleString()}`}
          </p>
          <div className={`connectionHealth connectionHealth-${health.status}`}>
            <strong>{health.title}</strong>
            <span>{health.details.join(' · ')}</span>
          </div>
          {connection.reconnectRequiredAt === null ? null : (
            <p className="attentionText">Reconnect required</p>
          )}
          {connection.errorCode === null ? null : (
            <p className="attentionText">
              {syncErrorMessage(connection.errorCode)}
            </p>
          )}
          {needsReconnect ? (
            <div className="reconnectPanel">
              <strong>Reconnect path</strong>
              <p>
                This connection cannot use normal Sync now until Plaid access is
                restored. For now, remove this institution and connect it again
                with Plaid Sandbox.
              </p>
            </div>
          ) : null}
          {connection.latestSyncJob === null ? null : (
            <div
              className={`syncJobPanel syncJobPanel-${connection.latestSyncJob.status}`}
            >
              <div className="syncJobPanelHeader">
                <strong>Sync status</strong>
                <span>{formatSyncStatus(connection.latestSyncJob.status)}</span>
              </div>
              <p>{syncJobMessage(connection)}</p>
              <p className="syncJobMetadata">
                {syncJobDetails(connection.latestSyncJob).join(' · ')}
              </p>
            </div>
          )}
        </div>
        <div className="connectionActions">
          <button
            className="secondaryButton"
            disabled={
              working ||
              needsReconnect ||
              connection.latestSyncJob?.status === 'queued' ||
              connection.latestSyncJob?.status === 'running'
            }
            onClick={() => sync(connection.id)}
            type="button"
          >
            {syncButtonLabel}
          </button>
          <button
            className="textButton"
            disabled={working}
            onClick={() => disconnect(connection.id)}
            type="button"
          >
            {needsReconnect ? 'Remove connection' : 'Disconnect'}
          </button>
        </div>
      </div>
      <ul className="accountList">
        {connection.accounts.map((account) => (
          <li key={account.id}>
            <div>
              <strong>{account.name}</strong>
              <span>
                {account.kind.replaceAll('_', ' ')}
                {account.mask === null ? '' : ` •••• ${account.mask}`}
              </span>
            </div>
            <strong>
              {formatMoney(account.currentBalanceMinor, account.currency)}
            </strong>
          </li>
        ))}
      </ul>
      {connection.recentSyncJobs.length === 0 ? null : (
        <details className="syncHistory">
          <summary>
            Recent syncs
            <span>{connection.recentSyncJobs.length} shown</span>
          </summary>
          <ul>
            {connection.recentSyncJobs.map((job) => (
              <li key={job.id}>
                <div>
                  <strong>
                    {formatSyncTrigger(job.trigger)} ·{' '}
                    {formatSyncStatus(job.status)}
                  </strong>
                  <span>{formatDateTime(syncJobCompletedAt(job))}</span>
                </div>
                <span
                  className={`syncHistoryResult syncHistoryResult-${job.status}`}
                >
                  {syncResultSummary(job)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  )
}
