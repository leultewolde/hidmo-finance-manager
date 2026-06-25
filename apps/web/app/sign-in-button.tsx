'use client'

import { useState } from 'react'

import { signInOwnerWithGoogle } from '../lib/firebase-client'

interface CsrfResponse {
  csrfToken?: string
}

export function SignInButton() {
  const [status, setStatus] = useState<'idle' | 'working' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function signIn() {
    setStatus('working')
    setMessage('')

    try {
      const csrfResponse = await fetch('/api/auth/csrf', {
        cache: 'no-store',
        credentials: 'same-origin',
      })
      const csrf = (await csrfResponse.json()) as CsrfResponse

      if (!csrfResponse.ok || csrf.csrfToken === undefined) {
        throw new Error('Could not initialize a secure sign-in request.')
      }

      const idToken = await signInOwnerWithGoogle()
      const sessionResponse = await fetch('/api/auth/session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csrfToken: csrf.csrfToken, idToken }),
      })

      if (!sessionResponse.ok) {
        const result = (await sessionResponse.json()) as { error?: string }
        if (result.error === 'owner-required') {
          throw new Error('This Google account is not authorized as the owner.')
        }
        throw new Error('The secure application session could not be created.')
      }

      window.location.assign('/dashboard')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : 'Sign-in failed.')
    }
  }

  return (
    <div className="signInActions">
      <button
        className="primaryButton"
        disabled={status === 'working'}
        onClick={signIn}
        type="button"
      >
        {status === 'working' ? 'Signing in…' : 'Continue with Google'}
      </button>
      {status === 'error' ? (
        <p className="authError" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  )
}
