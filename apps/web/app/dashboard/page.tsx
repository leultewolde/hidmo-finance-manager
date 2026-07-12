import { redirect } from 'next/navigation'

import { calculateCashFlow } from '@hidmo/finance-engine'

import { requireDatabaseOwner } from '../../lib/application-services'
import { AuthFailure } from '../../lib/auth-policy'
import {
  PlaidConnectionManager,
  type ConnectionView,
} from './plaid-connection-manager'
import { AnalysisCard, type AnalysisSnapshotView } from './analysis-card'
import {
  RecommendationCard,
  type RecommendationView,
} from './recommendation-card'
import { ExportCard } from './export-card'
import {
  AccountDeletionCard,
  type AccountDeletionStatus,
} from './account-deletion-card'
import { ReviewQueue } from './review-queue'
import { SignOutButton } from './sign-out-button'
import { serializeRecommendationView } from '../../lib/recommendation-view'

export const dynamic = 'force-dynamic'

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringValue(value: unknown, fallback = '0') {
  return typeof value === 'string' ? value : fallback
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

function actionPriority(value: unknown): 'high' | 'medium' | 'low' | null {
  return value === 'high' || value === 'medium' || value === 'low'
    ? value
    : null
}

function analysisNotes(
  value: unknown,
): { severity: 'info' | 'warning'; message: string }[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry) => {
    const record = asRecord(entry)
    if (record === null || typeof record.message !== 'string') return []
    return [
      {
        severity: record.severity === 'warning' ? 'warning' : 'info',
        message: record.message,
      },
    ]
  })
}

function riskIndicators(
  value: unknown,
): { severity: 'info' | 'warning' | 'critical'; message: string }[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry) => {
    const record = asRecord(entry)
    if (record === null || typeof record.message !== 'string') return []
    const severity =
      record.severity === 'critical' || record.severity === 'warning'
        ? record.severity
        : 'info'
    return [{ severity, message: record.message }]
  })
}

function analysisNarrative(value: unknown): AnalysisSnapshotView['narrative'] {
  const record = asRecord(value)
  if (
    record === null ||
    typeof record.currentStanding !== 'string' ||
    typeof record.budgetSummary !== 'string' ||
    typeof record.disclaimer !== 'string'
  ) {
    return null
  }

  const recommendedActions = Array.isArray(record.recommendedActions)
    ? record.recommendedActions.flatMap((entry) => {
        const action = asRecord(entry)
        const priority = actionPriority(action?.priority)
        if (
          action === null ||
          priority === null ||
          typeof action.title !== 'string' ||
          typeof action.rationale !== 'string'
        ) {
          return []
        }
        return [
          {
            priority,
            title: action.title,
            rationale: action.rationale,
          },
        ]
      })
    : []

  return {
    currentStanding: record.currentStanding,
    budgetSummary: record.budgetSummary,
    recommendedActions,
    caveats: stringArray(record.caveats),
    disclaimer: record.disclaimer,
  }
}

function analysisSummary(value: unknown): AnalysisSnapshotView['summary'] {
  const summary = asRecord(value)
  if (summary === null) return null

  const balanceSheet = asRecord(summary.balanceSheet)
  const cashFlow = asRecord(summary.cashFlow)
  const debt = asRecord(summary.debt)
  const budgetBaseline = asRecord(summary.budgetBaseline)
  const coverage = asRecord(summary.coverage)
  if (
    balanceSheet === null ||
    cashFlow === null ||
    debt === null ||
    budgetBaseline === null ||
    coverage === null ||
    typeof summary.currency !== 'string'
  ) {
    return null
  }

  return {
    currency: summary.currency,
    netWorthMinor: stringValue(balanceSheet.netWorthMinor),
    liquidCashMinor: stringValue(balanceSheet.liquidCashMinor),
    freeCashFlowMinor: stringValue(cashFlow.freeCashFlowMinor),
    savingsRateBps: numberValue(cashFlow.savingsRateBps),
    totalDebtMinor: stringValue(debt.totalDebtMinor),
    savingsCapacityAfterMinimumDebtMinor: stringValue(
      budgetBaseline.savingsCapacityAfterMinimumDebtMinor,
    ),
    emergencyFundCoverageMonthsHundredths: numberValue(
      summary.emergencyFundCoverageMonthsHundredths,
    ),
    transactionsAvailable: numberValue(coverage.transactionsAvailable) ?? 0,
    transactionsIncluded: numberValue(coverage.transactionsIncluded) ?? 0,
    coverageNotes: analysisNotes(coverage.coverageNotes),
    riskIndicators: riskIndicators(summary.riskIndicators),
  }
}

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
  const recentDeletionRequests =
    await ownerContext.repositories.deletionRequests.listRecentForUser(
      ownerContext.databaseOwner.id,
    )
  const latestUserDeletionRequest = recentDeletionRequests.find(
    (request) => request.scope === 'user',
  )
  const accountDeletionStatus: AccountDeletionStatus =
    latestUserDeletionRequest === undefined
      ? { status: 'none', deletionRequestId: null }
      : {
          status: latestUserDeletionRequest.status,
          deletionRequestId: latestUserDeletionRequest.id,
        }
  const deletionActive =
    accountDeletionStatus.status === 'queued' ||
    accountDeletionStatus.status === 'running'
  const recentSyncJobs =
    await ownerContext.repositories.syncJobs.listRecentForUser(
      ownerContext.databaseOwner.id,
    )
  const latestSyncJobByConnection = new Map<
    string,
    (typeof recentSyncJobs)[number]
  >()
  const syncJobsByConnection = new Map<
    string,
    (typeof recentSyncJobs)[number][]
  >()
  for (const job of recentSyncJobs) {
    if (!latestSyncJobByConnection.has(job.connectionId)) {
      latestSyncJobByConnection.set(job.connectionId, job)
    }
    const jobs = syncJobsByConnection.get(job.connectionId) ?? []
    if (jobs.length < 5) {
      jobs.push(job)
      syncJobsByConnection.set(job.connectionId, jobs)
    }
  }
  const serializeSyncJob = (job: (typeof recentSyncJobs)[number]) => ({
    id: job.id,
    status: job.status,
    trigger: job.trigger,
    lastErrorCode: job.lastErrorCode,
    cloudTaskName: job.cloudTaskName,
    result:
      typeof job.result === 'object' && job.result !== null
        ? (job.result as Record<string, unknown>)
        : {},
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
  })
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
  const transactionCountsByAccount = new Map<string, number>()
  const latestTransactionDateByAccount = new Map<string, string>()
  for (const transaction of transactionDetails.transactions) {
    transactionCountsByAccount.set(
      transaction.accountId,
      (transactionCountsByAccount.get(transaction.accountId) ?? 0) + 1,
    )
    const latestTransactionDate = latestTransactionDateByAccount.get(
      transaction.accountId,
    )
    if (
      latestTransactionDate === undefined ||
      transaction.postedDate > latestTransactionDate
    ) {
      latestTransactionDateByAccount.set(
        transaction.accountId,
        transaction.postedDate,
      )
    }
  }
  const connections: ConnectionView[] = connectionRows.map((connection) => {
    const transactionCount = connection.accounts.reduce(
      (count, account) =>
        count + (transactionCountsByAccount.get(account.id) ?? 0),
      0,
    )
    const latestTransactionDate = connection.accounts.reduce<string | null>(
      (latest, account) => {
        const accountLatest = latestTransactionDateByAccount.get(account.id)
        if (accountLatest === undefined) return latest
        if (latest === null || accountLatest > latest) return accountLatest
        return latest
      },
      null,
    )

    return {
      id: connection.id,
      institutionName: connection.institutionName,
      status: connection.status,
      lastSuccessfulSyncAt:
        connection.lastSuccessfulSyncAt?.toISOString() ?? null,
      errorCode: connection.errorCode,
      reconnectRequiredAt:
        connection.reconnectRequiredAt?.toISOString() ?? null,
      createdAt: connection.createdAt.toISOString(),
      health: {
        accountCount: connection.accounts.length,
        transactionCount,
        latestTransactionDate,
      },
      latestSyncJob: (() => {
        const job = latestSyncJobByConnection.get(connection.id)
        if (job === undefined) return null
        return serializeSyncJob(job)
      })(),
      recentSyncJobs: (syncJobsByConnection.get(connection.id) ?? []).map(
        serializeSyncJob,
      ),
      accounts: connection.accounts.map((account) => ({
        id: account.id,
        name: account.name,
        mask: account.mask,
        kind: account.kind,
        currentBalanceMinor: account.currentBalanceMinor.toString(),
        currency: account.currency,
      })),
    }
  })
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
  const analysisPeriod = {
    startDate: monthStart,
    endDate: monthEnd,
    label: new Intl.DateTimeFormat('en-US', {
      month: 'long',
      timeZone: 'UTC',
      year: 'numeric',
    }).format(new Date(`${monthStart}T00:00:00.000Z`)),
  }
  const [latestAnalysisSnapshot, latestAnalysisJob, currentRecommendations] =
    await Promise.all([
      ownerContext.repositories.analysisSnapshots.getLatestForUserPeriod(
        ownerContext.databaseOwner.id,
        analysisPeriod,
      ),
      ownerContext.repositories.analysisJobs.getLatestForUserPeriod(
        ownerContext.databaseOwner.id,
        analysisPeriod,
      ),
      ownerContext.repositories.recommendations.listCurrentForUserPeriod(
        ownerContext.databaseOwner.id,
        analysisPeriod,
      ),
    ])
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

      <PlaidConnectionManager
        deletionActive={deletionActive}
        initialConnections={connections}
      />

      <AnalysisCard
        currentPeriod={analysisPeriod}
        deletionActive={deletionActive}
        latestJob={
          latestAnalysisJob === undefined
            ? null
            : {
                id: latestAnalysisJob.id,
                status: latestAnalysisJob.status,
                lastErrorCode: latestAnalysisJob.lastErrorCode,
                createdAt: latestAnalysisJob.createdAt.toISOString(),
                startedAt: latestAnalysisJob.startedAt?.toISOString() ?? null,
                completedAt:
                  latestAnalysisJob.completedAt?.toISOString() ?? null,
              }
        }
        latestSnapshot={
          latestAnalysisSnapshot === undefined
            ? null
            : {
                id: latestAnalysisSnapshot.id,
                status: latestAnalysisSnapshot.status,
                periodStart: latestAnalysisSnapshot.periodStart,
                periodEnd: latestAnalysisSnapshot.periodEnd,
                inputHash: latestAnalysisSnapshot.inputHash,
                formulaVersion: latestAnalysisSnapshot.formulaVersion,
                createdAt: latestAnalysisSnapshot.createdAt.toISOString(),
                completedAt:
                  latestAnalysisSnapshot.completedAt?.toISOString() ?? null,
                lastErrorCode: latestAnalysisSnapshot.lastErrorCode,
                narrative: analysisNarrative(latestAnalysisSnapshot.narrative),
                summary: analysisSummary(
                  latestAnalysisSnapshot.deterministicSummary,
                ),
              }
        }
      />

      <RecommendationCard
        currentPeriod={analysisPeriod}
        deletionActive={deletionActive}
        initialRecommendations={
          currentRecommendations.map(
            serializeRecommendationView,
          ) as RecommendationView[]
        }
      />

      <ExportCard deletionActive={deletionActive} />

      <AccountDeletionCard initialStatus={accountDeletionStatus} />

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
