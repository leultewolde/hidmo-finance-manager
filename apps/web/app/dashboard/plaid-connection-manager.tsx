'use client'

import { useEffect, useState } from 'react'
import {
  usePlaidLink,
  type PlaidLinkOnExit,
  type PlaidLinkOnSuccess,
} from 'react-plaid-link'

export interface ConnectionView {
  id: string
  institutionName: string
  status: string
  createdAt: string
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
        throw new Error('The institution could not be disconnected.')
      }
      window.location.reload()
    } catch (error) {
      setWorking(false)
      setStatus(error instanceof Error ? error.message : 'Disconnect failed.')
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
            <article className="connectionCard" key={connection.id}>
              <div className="connectionCardHeader">
                <div>
                  <h3>{connection.institutionName}</h3>
                  <p>
                    Connected{' '}
                    {new Date(connection.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  className="textButton"
                  disabled={working}
                  onClick={() => disconnect(connection.id)}
                  type="button"
                >
                  Disconnect
                </button>
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
                      {formatMoney(
                        account.currentBalanceMinor,
                        account.currency,
                      )}
                    </strong>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
