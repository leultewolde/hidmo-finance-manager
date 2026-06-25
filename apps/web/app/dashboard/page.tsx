import { redirect } from 'next/navigation'

import { AuthFailure } from '../../lib/auth-policy'
import { requireOwner } from '../../lib/server-auth'
import { SignOutButton } from './sign-out-button'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  let owner

  try {
    owner = await requireOwner()
  } catch (error) {
    if (error instanceof AuthFailure) {
      redirect('/')
    }
    throw error
  }

  return (
    <main className="dashboardShell">
      <header className="dashboardHeader">
        <div>
          <p className="eyebrow">Authenticated owner workspace</p>
          <h1 className="dashboardTitle">Financial command center</h1>
        </div>
        <SignOutButton />
      </header>

      <section className="ownerCard">
        <p className="sectionLabel">Session verified</p>
        <h2>Welcome, {owner.email}</h2>
        <p>
          Firebase verified your identity and the server matched your immutable
          UID to the configured application owner.
        </p>
      </section>
    </main>
  )
}
