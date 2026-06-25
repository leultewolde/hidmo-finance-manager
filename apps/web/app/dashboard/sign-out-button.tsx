'use client'

import { useState } from 'react'

export function SignOutButton() {
  const [working, setWorking] = useState(false)

  async function signOut() {
    setWorking(true)
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
    })

    if (response.ok) {
      window.location.assign('/')
      return
    }

    setWorking(false)
  }

  return (
    <button
      className="secondaryButton"
      disabled={working}
      onClick={signOut}
      type="button"
    >
      {working ? 'Signing out…' : 'Sign out'}
    </button>
  )
}
