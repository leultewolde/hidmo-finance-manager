import { syntheticHousehold, getAccountClass } from '@hidmo/finance-engine'

import type { Database } from './client.js'
import { syntheticIds } from './ids.js'
import {
  accounts,
  budgetLines,
  budgets,
  connections,
  institutions,
  liabilities,
  transactionSplits,
  transactions,
  users,
} from './schema.js'

const budgetLineIds = [
  '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000002',
  '40000000-0000-4000-8000-000000000003',
] as const

const liabilityIds = [
  '50000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000002',
  '50000000-0000-4000-8000-000000000003',
] as const

const splitIds = [
  '60000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000002',
  '60000000-0000-4000-8000-000000000003',
] as const

const accountIds: Record<string, string> = syntheticIds.accounts
const transactionIds: Record<string, string> = syntheticIds.transactions

export async function seedSyntheticHousehold(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(users)
      .values({
        id: syntheticIds.user,
        firebaseUid: 'synthetic-owner',
        email: 'owner@example.invalid',
      })
      .onConflictDoNothing()

    await tx
      .insert(institutions)
      .values({
        id: syntheticIds.institution,
        plaidInstitutionId: 'ins_synthetic',
        name: 'Synthetic Bank',
      })
      .onConflictDoNothing()

    await tx
      .insert(connections)
      .values({
        id: syntheticIds.connection,
        userId: syntheticIds.user,
        institutionId: syntheticIds.institution,
        plaidItemId: 'item_synthetic',
      })
      .onConflictDoNothing()

    await tx
      .insert(accounts)
      .values(
        syntheticHousehold.accounts.map((account) => ({
          id: accountIds[account.id]!,
          userId: syntheticIds.user,
          connectionId:
            account.balanceSource === 'connected'
              ? syntheticIds.connection
              : null,
          providerAccountId:
            account.balanceSource === 'connected'
              ? `provider_${account.id}`
              : null,
          name: account.name,
          kind: account.kind,
          accountClass: getAccountClass(account.kind),
          currentBalanceMinor: account.balanceMinor,
          creditLimitMinor: account.creditLimitMinor ?? null,
          currency: account.currency,
          balanceSource: account.balanceSource,
          dataQuality: account.dataQuality,
          balanceAsOf: account.balanceAsOf,
          manual: account.balanceSource === 'manual',
        })),
      )
      .onConflictDoNothing()

    const allTransactions = [
      ...syntheticHousehold.transactions,
      syntheticHousehold.loanPaymentTransaction,
    ]
    await tx
      .insert(transactions)
      .values(
        allTransactions.map((transaction) => ({
          id: transactionIds[transaction.id]!,
          userId: syntheticIds.user,
          accountId: accountIds[transaction.accountId]!,
          providerTransactionId: `provider_${transaction.id}`,
          postedDate: transaction.postedDate,
          rawProviderAmountMinor: -transaction.amountMinor,
          normalizedAmountMinor: transaction.amountMinor,
          currency: transaction.currency,
          state: transaction.state,
          economicType: transaction.economicType,
          appCategory: transaction.category,
          userReviewed: transaction.reviewed,
          deduplicationFingerprint: `synthetic:${transaction.id}`,
        })),
      )
      .onConflictDoNothing()

    await tx
      .insert(transactionSplits)
      .values(
        syntheticHousehold.loanPaymentSplits.map((split, index) => ({
          id: splitIds[index]!,
          userId: syntheticIds.user,
          transactionId: syntheticIds.transactions['loan-payment'],
          amountMinor: split.amountMinor,
          economicType: split.economicType,
          category: split.category,
        })),
      )
      .onConflictDoNothing()

    await tx
      .insert(liabilities)
      .values(
        syntheticHousehold.debts.map((debt, index) => ({
          id: liabilityIds[index]!,
          userId: syntheticIds.user,
          accountId: accountIds[debt.id]!,
          kind: debt.kind,
          principalBalanceMinor: debt.balanceMinor,
          aprBps: debt.aprBps,
          minimumPaymentMinor: debt.minimumPaymentMinor,
          source:
            debt.id === 'personal-loan-1'
              ? ('manual' as const)
              : ('provider' as const),
          fieldProvenance: {
            aprBps: debt.id === 'personal-loan-1' ? 'user' : 'provider',
          },
        })),
      )
      .onConflictDoNothing()

    await tx
      .insert(budgets)
      .values({
        id: syntheticIds.budget,
        userId: syntheticIds.user,
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        currency: 'USD',
      })
      .onConflictDoNothing()

    await tx
      .insert(budgetLines)
      .values(
        syntheticHousehold.budget.map((line, index) => ({
          id: budgetLineIds[index]!,
          userId: syntheticIds.user,
          budgetId: syntheticIds.budget,
          category: line.category,
          plannedMinor: line.plannedMinor,
        })),
      )
      .onConflictDoNothing()
  })
}
