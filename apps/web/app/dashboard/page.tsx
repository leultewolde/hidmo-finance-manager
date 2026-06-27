import { redirect } from 'next/navigation'

import { requireDatabaseOwner } from '../../lib/application-services'
import { AuthFailure } from '../../lib/auth-policy'
import {
  PlaidConnectionManager,
  type ConnectionView,
} from './plaid-connection-manager'
import { SignOutButton } from './sign-out-button'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  let ownerContext

  try {
    ownerContext = await requireDatabaseOwner()
  } catch (error) {
    if (error instanceof AuthFailure) {
      redirect('/')
    }
    throw error
  }

  const connectionRows =
    await ownerContext.repositories.connections.listWithAccountsForUser(
      ownerContext.databaseOwner.id,
    )
  const connections: ConnectionView[] = connectionRows.map((connection) => ({
    id: connection.id,
    institutionName: connection.institutionName,
    status: connection.status,
    createdAt: connection.createdAt.toISOString(),
    accounts: connection.accounts.map((account) => ({
      id: account.id,
      name: account.name,
      mask: account.mask,
      kind: account.kind,
      currentBalanceMinor: account.currentBalanceMinor.toString(),
      currency: account.currency,
    })),
  }))

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
        <h2>Welcome, {ownerContext.firebaseOwner.email}</h2>
        <p>
          Firebase verified your identity and the server matched your immutable
          UID to the configured application owner.
        </p>
      </section>

      <PlaidConnectionManager initialConnections={connections} />
    </main>
  )
}
