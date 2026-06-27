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
    lastSuccessfulSyncAt:
      connection.lastSuccessfulSyncAt?.toISOString() ?? null,
    errorCode: connection.errorCode,
    reconnectRequiredAt: connection.reconnectRequiredAt?.toISOString() ?? null,
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
  const transactionRows =
    await ownerContext.repositories.transactions.listRecentForUser(
      ownerContext.databaseOwner.id,
    )

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

      <section className="transactionsSection">
        <div>
          <p className="sectionLabel">Latest activity</p>
          <h2>Transactions</h2>
        </div>
        {transactionRows.length === 0 ? (
          <p className="emptyConnections">No synchronized transactions yet.</p>
        ) : (
          <ul className="transactionList">
            {transactionRows.map((transaction) => (
              <li key={transaction.id}>
                <div>
                  <strong>
                    {transaction.merchantName ?? transaction.description}
                  </strong>
                  <span>
                    {transaction.postedDate} · {transaction.accountName}
                    {transaction.accountMask === null
                      ? ''
                      : ` •••• ${transaction.accountMask}`}{' '}
                    · {transaction.state}
                  </span>
                </div>
                <strong>
                  {new Intl.NumberFormat('en-US', {
                    style: 'currency',
                    currency: transaction.currency,
                  }).format(Number(transaction.normalizedAmountMinor) / 100)}
                </strong>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
