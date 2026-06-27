import { redirect } from 'next/navigation'

import { calculateCashFlow } from '@hidmo/finance-engine'

import { requireDatabaseOwner } from '../../lib/application-services'
import { AuthFailure } from '../../lib/auth-policy'
import {
  PlaidConnectionManager,
  type ConnectionView,
} from './plaid-connection-manager'
import { ReviewQueue } from './review-queue'
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
  const [transactionDetails, transferCandidates, classificationRules] =
    await Promise.all([
      ownerContext.repositories.transactions.listForUser(
        ownerContext.databaseOwner.id,
      ),
      ownerContext.repositories.transfers.listCandidates(
        ownerContext.databaseOwner.id,
      ),
      ownerContext.repositories.classificationRules.listActive(
        ownerContext.databaseOwner.id,
      ),
    ])
  const splitCounts = new Map<string, number>()
  for (const split of transactionDetails.splits) {
    splitCounts.set(
      split.transactionId,
      (splitCounts.get(split.transactionId) ?? 0) + 1,
    )
  }
  const labels = new Map(
    transactionRows.map((transaction) => [
      transaction.id,
      transaction.merchantName ??
        transaction.description ??
        transaction.accountName,
    ]),
  )
  const now = new Date()
  const monthStart = `${now.toISOString().slice(0, 7)}-01`
  const monthEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  )
    .toISOString()
    .slice(0, 10)
  const usdTransactions = transactionDetails.transactions.filter(
    (transaction) => transaction.currency === 'USD',
  )
  const calculationTransactions = usdTransactions.map((transaction) => {
    const incompatible =
      ((transaction.economicType === 'income' ||
        transaction.economicType === 'refund') &&
        transaction.amountMinor <= 0n) ||
      (transaction.economicType === 'expense' && transaction.amountMinor >= 0n)
    return incompatible
      ? { ...transaction, economicType: 'unknown' as const }
      : transaction
  })
  const reviewedTransactions = calculationTransactions.filter(
    (transaction) => transaction.reviewed,
  )
  const reviewedIds = new Set(
    reviewedTransactions.map((transaction) => transaction.id),
  )
  const allCashFlow = calculateCashFlow(
    calculationTransactions,
    { startDate: monthStart, endDate: monthEnd },
    transactionDetails.splits,
  ).value
  const reviewedCashFlow = calculateCashFlow(
    reviewedTransactions,
    { startDate: monthStart, endDate: monthEnd },
    transactionDetails.splits.filter((split) =>
      reviewedIds.has(split.transactionId),
    ),
  ).value

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

      <section className="classificationSummary">
        <p className="sectionLabel">Current month</p>
        <h2>Reviewed and uncertain totals</h2>
        <div className="summaryGrid">
          <div>
            <span>Income</span>
            <strong>
              ${(Number(allCashFlow.incomeMinor) / 100).toLocaleString()}
            </strong>
          </div>
          <div>
            <span>Expenses</span>
            <strong>
              $
              {(
                Number(allCashFlow.expenseOutflowsMinor) / 100
              ).toLocaleString()}
            </strong>
          </div>
          <div>
            <span>Unreviewed impact</span>
            <strong>
              $
              {(
                Number(
                  allCashFlow.incomeMinor -
                    reviewedCashFlow.incomeMinor +
                    (allCashFlow.expenseOutflowsMinor -
                      reviewedCashFlow.expenseOutflowsMinor),
                ) / 100
              ).toLocaleString()}
            </strong>
          </div>
        </div>
      </section>

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

      <ReviewQueue
        matches={transferCandidates.map((match) => ({
          id: match.id,
          outLabel:
            labels.get(match.transactionOutId) ?? 'Outgoing transaction',
          inLabel: labels.get(match.transactionInId) ?? 'Incoming transaction',
          scoreBps: match.scoreBps,
          method: match.method,
        }))}
        rules={classificationRules.map((rule) => {
          const conditions =
            typeof rule.matchConditions === 'object' &&
            rule.matchConditions !== null
              ? (rule.matchConditions as Record<string, unknown>)
              : {}
          return {
            id: rule.id,
            condition:
              typeof conditions.merchantContains === 'string'
                ? `Merchant contains “${conditions.merchantContains}”`
                : 'Custom condition',
            category: rule.category,
            economicType: rule.economicType,
          }
        })}
        reviewedTransactions={transactionRows
          .filter((transaction) => transaction.reviewed)
          .map((transaction) => ({
            id: transaction.id,
            merchant:
              transaction.merchantName ??
              transaction.description ??
              transaction.accountName,
            accountName: transaction.accountName,
            accountMask: transaction.accountMask,
            postedDate: transaction.postedDate,
            amountMinor: transaction.normalizedAmountMinor.toString(),
            currency: transaction.currency,
            economicType: transaction.economicType,
            category: transaction.category,
            providerCategory: transaction.providerCategory,
            confidenceBps: transaction.confidenceBps,
            reviewed: transaction.reviewed,
            splitCount: splitCounts.get(transaction.id) ?? 0,
          }))}
        transactions={transactionRows
          .filter(
            (transaction) =>
              !transaction.reviewed && (transaction.confidenceBps ?? 0) < 9_000,
          )
          .map((transaction) => ({
            id: transaction.id,
            merchant:
              transaction.merchantName ??
              transaction.description ??
              transaction.accountName,
            accountName: transaction.accountName,
            accountMask: transaction.accountMask,
            postedDate: transaction.postedDate,
            amountMinor: transaction.normalizedAmountMinor.toString(),
            currency: transaction.currency,
            economicType: transaction.economicType,
            category: transaction.category,
            providerCategory: transaction.providerCategory,
            confidenceBps: transaction.confidenceBps,
            reviewed: transaction.reviewed,
            splitCount: splitCounts.get(transaction.id) ?? 0,
          }))}
      />
    </main>
  )
}
