import { randomUUID } from 'node:crypto'

import { and, asc, desc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm'

import type {
  Account,
  Transaction,
  TransactionSplit,
} from '@hidmo/finance-engine'
import { assertTransactionSplits } from '@hidmo/finance-engine'

import type { Database } from './client.js'
import {
  accounts,
  auditEvents,
  budgetLines,
  budgets,
  classificationRules,
  connections,
  institutions,
  liabilities,
  metricSnapshots,
  recommendations,
  syncJobs,
  taskExecutions,
  transferMatches,
  transactionSplits,
  transactions,
  users,
} from './schema.js'

export class UserRepository {
  constructor(private readonly db: Database) {}

  async getById(userId: string) {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    return user
  }

  async getByFirebaseUid(firebaseUid: string) {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.firebaseUid, firebaseUid))
      .limit(1)
    return user
  }

  async ensureOwner(firebaseUid: string, email: string) {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('hidmo-single-owner'))`,
      )

      const [existing] = await tx
        .select()
        .from(users)
        .where(eq(users.firebaseUid, firebaseUid))
        .limit(1)

      if (existing !== undefined) {
        if (existing.email !== email) {
          const [updated] = await tx
            .update(users)
            .set({ email, updatedAt: new Date() })
            .where(eq(users.id, existing.id))
            .returning()
          return updated
        }
        return existing
      }

      const [soleOwner] = await tx.select().from(users).limit(1)
      if (soleOwner !== undefined) {
        if (soleOwner.firebaseUid !== 'synthetic-owner') {
          throw new Error(
            'Configured Firebase owner does not match database owner',
          )
        }

        const [updated] = await tx
          .update(users)
          .set({ firebaseUid, email, updatedAt: new Date() })
          .where(eq(users.id, soleOwner.id))
          .returning()
        return updated
      }

      const [created] = await tx
        .insert(users)
        .values({ id: randomUUID(), firebaseUid, email })
        .returning()
      return created
    })
  }
}

export interface ConnectedAccountInput {
  providerAccountId: string
  persistentProviderAccountId?: string
  name: string
  mask?: string
  kind:
    | 'checking'
    | 'savings'
    | 'cash'
    | 'brokerage'
    | 'retirement'
    | 'property'
    | 'credit_card'
    | 'personal_loan'
    | 'auto_loan'
    | 'student_loan'
    | 'mortgage'
    | 'line_of_credit'
  accountClass: 'asset' | 'liability'
  subtype?: string
  currentBalanceMinor: bigint
  availableBalanceMinor?: bigint
  creditLimitMinor?: bigint
  currency: 'USD' | 'EUR'
  balanceAsOf: string
}

export interface TokenEnvelopeInput {
  encryptedAccessToken: string
  wrappedDataKey: string
  encryptionNonce: string
  encryptionTag: string
  encryptionAlgorithm: string
  kmsKeyName: string
}

export class ConnectionRepository {
  constructor(private readonly db: Database) {}

  async listForUser(userId: string) {
    return this.db
      .select()
      .from(connections)
      .where(eq(connections.userId, userId))
      .orderBy(asc(connections.id))
  }

  async listWithAccountsForUser(userId: string) {
    const connectionRows = await this.db
      .select({
        id: connections.id,
        institutionName: institutions.name,
        status: connections.status,
        lastSuccessfulSyncAt: connections.lastSuccessfulSyncAt,
        errorCode: connections.errorCode,
        reconnectRequiredAt: connections.reconnectRequiredAt,
        createdAt: connections.createdAt,
      })
      .from(connections)
      .leftJoin(institutions, eq(connections.institutionId, institutions.id))
      .where(
        and(
          eq(connections.userId, userId),
          eq(connections.status, 'active'),
          isNotNull(connections.encryptedAccessToken),
        ),
      )
      .orderBy(asc(connections.createdAt))

    const accountRows = await this.db
      .select({
        id: accounts.id,
        connectionId: accounts.connectionId,
        name: accounts.name,
        mask: accounts.mask,
        kind: accounts.kind,
        currentBalanceMinor: accounts.currentBalanceMinor,
        currency: accounts.currency,
      })
      .from(accounts)
      .where(
        and(
          eq(accounts.userId, userId),
          eq(accounts.active, true),
          isNotNull(accounts.connectionId),
        ),
      )
      .orderBy(asc(accounts.name))

    return connectionRows.map((connection) => ({
      ...connection,
      institutionName: connection.institutionName ?? 'Connected institution',
      accounts: accountRows.filter(
        (account) => account.connectionId === connection.id,
      ),
    }))
  }

  async createPlaidConnection(input: {
    userId: string
    plaidItemId: string
    institutionProviderId?: string
    institutionName: string
    consentExpiresAt?: Date
    tokenEnvelope: TokenEnvelopeInput
    accounts: readonly ConnectedAccountInput[]
  }) {
    return this.db.transaction(async (tx) => {
      let institutionId: string | null = null

      if (input.institutionProviderId !== undefined) {
        const [existingInstitution] = await tx
          .select()
          .from(institutions)
          .where(
            eq(institutions.plaidInstitutionId, input.institutionProviderId),
          )
          .limit(1)

        if (existingInstitution === undefined) {
          institutionId = randomUUID()
          await tx.insert(institutions).values({
            id: institutionId,
            plaidInstitutionId: input.institutionProviderId,
            name: input.institutionName,
          })
        } else {
          institutionId = existingInstitution.id
          await tx
            .update(institutions)
            .set({ name: input.institutionName, updatedAt: new Date() })
            .where(eq(institutions.id, institutionId))
        }
      }

      const connectionId = randomUUID()
      await tx.insert(connections).values({
        id: connectionId,
        userId: input.userId,
        institutionId,
        plaidItemId: input.plaidItemId,
        consentExpiresAt: input.consentExpiresAt,
        ...input.tokenEnvelope,
      })

      await tx.insert(accounts).values(
        input.accounts.map((account) => ({
          id: randomUUID(),
          userId: input.userId,
          connectionId,
          providerAccountId: account.providerAccountId,
          persistentProviderAccountId:
            account.persistentProviderAccountId ?? null,
          name: account.name,
          mask: account.mask ?? null,
          kind: account.kind,
          accountClass: account.accountClass,
          subtype: account.subtype ?? null,
          currentBalanceMinor: account.currentBalanceMinor,
          availableBalanceMinor: account.availableBalanceMinor ?? null,
          creditLimitMinor: account.creditLimitMinor ?? null,
          currency: account.currency,
          balanceSource: 'connected' as const,
          dataQuality: 'verified' as const,
          balanceAsOf: account.balanceAsOf,
          manual: false as const,
        })),
      )

      return connectionId
    })
  }

  async getTokenEnvelopeForUser(userId: string, connectionId: string) {
    const [connection] = await this.db
      .select()
      .from(connections)
      .where(
        and(
          eq(connections.id, connectionId),
          eq(connections.userId, userId),
          eq(connections.status, 'active'),
        ),
      )
      .limit(1)

    return connection
  }

  async revokeForUser(userId: string, connectionId: string) {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(accounts)
        .where(
          and(
            eq(accounts.userId, userId),
            eq(accounts.connectionId, connectionId),
          ),
        )

      const revoked = await tx
        .update(connections)
        .set({
          status: 'revoked',
          encryptedAccessToken: null,
          wrappedDataKey: null,
          encryptionNonce: null,
          encryptionTag: null,
          encryptionAlgorithm: null,
          kmsKeyName: null,
          updatedAt: new Date(),
        })
        .where(
          and(eq(connections.id, connectionId), eq(connections.userId, userId)),
        )
        .returning({ id: connections.id })

      if (revoked.length !== 1) {
        throw new Error('Connection not found for owner')
      }
    })
  }

  async recordSyncError(
    userId: string,
    connectionId: string,
    errorCode: string,
    reconnectRequired: boolean,
  ) {
    await this.db
      .update(connections)
      .set({
        status: reconnectRequired ? 'attention_required' : 'active',
        errorCode,
        reconnectRequiredAt: reconnectRequired ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(
        and(eq(connections.id, connectionId), eq(connections.userId, userId)),
      )
  }
}

export class AccountRepository {
  constructor(private readonly db: Database) {}

  async listForUser(userId: string): Promise<Account[]> {
    const rows = await this.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.active, true)))
      .orderBy(asc(accounts.id))

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      balanceMinor: row.currentBalanceMinor,
      currency: row.currency,
      ...(row.creditLimitMinor === null
        ? {}
        : { creditLimitMinor: row.creditLimitMinor }),
      balanceAsOf: row.balanceAsOf,
      balanceSource: row.balanceSource,
      dataQuality: row.dataQuality,
    }))
  }
}

export class TransactionRepository {
  constructor(private readonly db: Database) {}

  async listForUser(
    userId: string,
  ): Promise<{ transactions: Transaction[]; splits: TransactionSplit[] }> {
    const transactionRows = await this.db
      .select()
      .from(transactions)
      .where(
        and(eq(transactions.userId, userId), eq(transactions.removed, false)),
      )
      .orderBy(asc(transactions.postedDate), asc(transactions.id))

    const ids = transactionRows.map((row) => row.id)
    const splitRows =
      ids.length === 0
        ? []
        : await this.db
            .select()
            .from(transactionSplits)
            .where(
              and(
                eq(transactionSplits.userId, userId),
                inArray(transactionSplits.transactionId, ids),
              ),
            )
            .orderBy(asc(transactionSplits.id))

    return {
      transactions: transactionRows.map((row) => ({
        id: row.id,
        accountId: row.accountId,
        postedDate: row.postedDate,
        amountMinor: row.normalizedAmountMinor,
        currency: row.currency,
        direction: row.normalizedAmountMinor >= 0n ? 'inflow' : 'outflow',
        economicType: row.economicType,
        category: row.appCategory,
        state: row.state,
        reviewed: row.userReviewed,
      })),
      splits: splitRows.map((row) => ({
        id: row.id,
        transactionId: row.transactionId,
        amountMinor: row.amountMinor,
        economicType: row.economicType,
        category: row.category,
      })),
    }
  }

  async listRecentForUser(userId: string, limit = 100) {
    return this.db
      .select({
        id: transactions.id,
        accountName: accounts.name,
        accountMask: accounts.mask,
        postedDate: transactions.postedDate,
        merchantName: transactions.merchantName,
        description: transactions.originalDescription,
        normalizedAmountMinor: transactions.normalizedAmountMinor,
        currency: transactions.currency,
        state: transactions.state,
        economicType: transactions.economicType,
        category: transactions.appCategory,
        providerCategory: transactions.providerCategory,
        confidenceBps: transactions.classificationConfidenceBps,
        reviewed: transactions.userReviewed,
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .where(
        and(eq(transactions.userId, userId), eq(transactions.removed, false)),
      )
      .orderBy(desc(transactions.postedDate), desc(transactions.createdAt))
      .limit(limit)
  }

  async applyPlaidSync(input: {
    userId: string
    connectionId: string
    startingCursor: string | null
    finalCursor: string
    added: readonly PlaidTransactionInput[]
    modified: readonly PlaidTransactionInput[]
    removedProviderTransactionIds: readonly string[]
  }) {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${input.connectionId}))`,
      )

      const [connection] = await tx
        .select()
        .from(connections)
        .where(
          and(
            eq(connections.id, input.connectionId),
            eq(connections.userId, input.userId),
            eq(connections.status, 'active'),
          ),
        )
        .limit(1)

      if (connection === undefined) {
        throw new Error('Connection not found for owner')
      }
      if (connection.transactionCursor !== input.startingCursor) {
        throw new Error('Transaction cursor changed during synchronization')
      }

      const accountRows = await tx
        .select({
          id: accounts.id,
          providerAccountId: accounts.providerAccountId,
        })
        .from(accounts)
        .where(
          and(
            eq(accounts.userId, input.userId),
            eq(accounts.connectionId, input.connectionId),
            isNotNull(accounts.providerAccountId),
          ),
        )
      const accountIds = new Map(
        accountRows.map((account) => [
          account.providerAccountId as string,
          account.id,
        ]),
      )

      for (const transaction of [...input.added, ...input.modified]) {
        const accountId = accountIds.get(transaction.providerAccountId)
        if (accountId === undefined) {
          throw new Error('Plaid transaction references an unknown account')
        }

        if (transaction.pendingProviderTransactionId !== undefined) {
          await tx
            .update(transactions)
            .set({ removed: true, updatedAt: new Date() })
            .where(
              and(
                eq(transactions.userId, input.userId),
                inArray(transactions.accountId, [...accountIds.values()]),
                eq(
                  transactions.providerTransactionId,
                  transaction.pendingProviderTransactionId,
                ),
              ),
            )
        }

        const [existing] = await tx
          .select()
          .from(transactions)
          .where(
            and(
              eq(transactions.accountId, accountId),
              eq(
                transactions.providerTransactionId,
                transaction.providerTransactionId,
              ),
            ),
          )
          .limit(1)

        const providerValues = {
          pendingProviderTransactionId:
            transaction.pendingProviderTransactionId ?? null,
          authorizedDate: transaction.authorizedDate ?? null,
          postedDate: transaction.postedDate,
          rawProviderAmountMinor: transaction.rawProviderAmountMinor,
          normalizedAmountMinor: transaction.normalizedAmountMinor,
          currency: transaction.currency,
          merchantName: transaction.merchantName ?? null,
          originalDescription: transaction.originalDescription,
          state: transaction.state,
          removed: false,
          providerCategory: transaction.providerCategory ?? null,
          providerCategoryConfidenceBps:
            transaction.providerCategoryConfidenceBps ?? null,
          updatedAt: new Date(),
        } as const

        if (existing === undefined) {
          await tx.insert(transactions).values({
            id: randomUUID(),
            userId: input.userId,
            accountId,
            providerTransactionId: transaction.providerTransactionId,
            ...providerValues,
            economicType: transaction.economicType,
            appCategory: transaction.appCategory,
            classificationConfidenceBps:
              transaction.providerCategoryConfidenceBps ?? null,
            deduplicationFingerprint: transaction.deduplicationFingerprint,
          })
        } else {
          await tx
            .update(transactions)
            .set({
              ...providerValues,
              ...(existing.userReviewed
                ? {}
                : {
                    economicType: transaction.economicType,
                    appCategory: transaction.appCategory,
                    classificationConfidenceBps:
                      transaction.providerCategoryConfidenceBps ?? null,
                  }),
            })
            .where(eq(transactions.id, existing.id))
        }
      }

      if (input.removedProviderTransactionIds.length > 0) {
        await tx
          .update(transactions)
          .set({ removed: true, updatedAt: new Date() })
          .where(
            and(
              eq(transactions.userId, input.userId),
              inArray(transactions.accountId, [...accountIds.values()]),
              inArray(
                transactions.providerTransactionId,
                input.removedProviderTransactionIds,
              ),
            ),
          )
      }

      await tx
        .update(connections)
        .set({
          transactionCursor: input.finalCursor,
          lastSuccessfulSyncAt: new Date(),
          errorCode: null,
          reconnectRequiredAt: null,
          updatedAt: new Date(),
        })
        .where(eq(connections.id, input.connectionId))

      return {
        added: input.added.length,
        modified: input.modified.length,
        removed: input.removedProviderTransactionIds.length,
      }
    })
  }

  async replaceSplits(
    userId: string,
    transactionId: string,
    splits: readonly TransactionSplit[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.id, transactionId),
            eq(transactions.userId, userId),
          ),
        )
        .limit(1)

      if (row === undefined) {
        throw new Error('Transaction not found for owner')
      }

      if (splits.length > 0) {
        assertTransactionSplits(
          {
            id: row.id,
            accountId: row.accountId,
            postedDate: row.postedDate,
            amountMinor: row.normalizedAmountMinor,
            currency: row.currency,
            direction: row.normalizedAmountMinor >= 0n ? 'inflow' : 'outflow',
            economicType: row.economicType,
            category: row.appCategory,
            state: row.state,
            reviewed: row.userReviewed,
          },
          splits,
        )
      }

      await tx
        .delete(transactionSplits)
        .where(
          and(
            eq(transactionSplits.transactionId, transactionId),
            eq(transactionSplits.userId, userId),
          ),
        )

      if (splits.length > 0) {
        await tx.insert(transactionSplits).values(
          splits.map((split) => ({
            id: split.id,
            userId,
            transactionId,
            amountMinor: split.amountMinor,
            economicType: split.economicType,
            category: split.category,
          })),
        )
      }

      await tx
        .update(transactions)
        .set({
          userReviewed: true,
          classificationConfidenceBps: 10_000,
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, transactionId))
      await tx.delete(metricSnapshots).where(eq(metricSnapshots.userId, userId))
      await tx.insert(auditEvents).values({
        id: randomUUID(),
        userId,
        actor: 'owner',
        action:
          splits.length === 0
            ? 'transaction.splits.removed'
            : 'transaction.splits.replaced',
        targetType: 'transaction',
        targetId: transactionId,
        metadata: { splitCount: splits.length },
      })
    })
  }

  async correctForUser(
    userId: string,
    transactionId: string,
    input: {
      economicType:
        | PlaidTransactionInput['economicType']
        | 'transfer'
        | 'debt_payment'
        | 'adjustment'
      category: string
    },
  ) {
    await this.db.transaction(async (tx) => {
      const [transaction] = await tx
        .select({
          amountMinor: transactions.normalizedAmountMinor,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.id, transactionId),
            eq(transactions.userId, userId),
            eq(transactions.removed, false),
          ),
        )
        .limit(1)
      if (transaction === undefined) {
        throw new Error('Transaction not found for owner')
      }
      if (
        ((input.economicType === 'income' || input.economicType === 'refund') &&
          transaction.amountMinor <= 0n) ||
        (input.economicType === 'expense' && transaction.amountMinor >= 0n)
      ) {
        throw new Error('Classification does not match transaction direction')
      }

      const updated = await tx
        .update(transactions)
        .set({
          economicType: input.economicType,
          appCategory: input.category,
          userReviewed: true,
          classificationConfidenceBps: 10_000,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(transactions.id, transactionId),
            eq(transactions.userId, userId),
            eq(transactions.removed, false),
          ),
        )
        .returning({ id: transactions.id })
      if (updated.length !== 1) throw new Error('Transaction update failed')

      await tx.delete(metricSnapshots).where(eq(metricSnapshots.userId, userId))
      await tx.insert(auditEvents).values({
        id: randomUUID(),
        userId,
        actor: 'owner',
        action: 'transaction.classification.corrected',
        targetType: 'transaction',
        targetId: transactionId,
        metadata: {
          economicType: input.economicType,
          category: input.category,
        },
      })
    })
  }

  async listForClassification(userId: string) {
    return this.db
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        accountClass: accounts.accountClass,
        postedDate: transactions.postedDate,
        amountMinor: transactions.normalizedAmountMinor,
        merchantName: transactions.merchantName,
        description: transactions.originalDescription,
        providerCategory: transactions.providerCategory,
        economicType: transactions.economicType,
        category: transactions.appCategory,
        reviewed: transactions.userReviewed,
        removed: transactions.removed,
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .where(eq(transactions.userId, userId))
  }

  async applyClassificationSuggestions(
    userId: string,
    decisions: readonly {
      transactionId: string
      economicType:
        | PlaidTransactionInput['economicType']
        | 'transfer'
        | 'debt_payment'
        | 'adjustment'
      category: string
      confidenceBps: number
    }[],
  ) {
    await this.db.transaction(async (tx) => {
      for (const decision of decisions) {
        await tx
          .update(transactions)
          .set({
            economicType: decision.economicType,
            appCategory: decision.category,
            classificationConfidenceBps: decision.confidenceBps,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(transactions.id, decision.transactionId),
              eq(transactions.userId, userId),
              eq(transactions.userReviewed, false),
            ),
          )
      }
      await tx.delete(metricSnapshots).where(eq(metricSnapshots.userId, userId))
    })
  }
}

export class LiabilityRepository {
  constructor(private readonly db: Database) {}

  async listForUser(userId: string) {
    return this.db
      .select()
      .from(liabilities)
      .where(eq(liabilities.userId, userId))
      .orderBy(asc(liabilities.id))
  }
}

export class BudgetRepository {
  constructor(private readonly db: Database) {}

  async getForPeriod(userId: string, periodStart: string, periodEnd: string) {
    const [budget] = await this.db
      .select()
      .from(budgets)
      .where(
        and(
          eq(budgets.userId, userId),
          eq(budgets.periodStart, periodStart),
          eq(budgets.periodEnd, periodEnd),
        ),
      )
      .limit(1)

    if (budget === undefined) {
      return undefined
    }

    const lines = await this.db
      .select()
      .from(budgetLines)
      .where(
        and(
          eq(budgetLines.userId, userId),
          eq(budgetLines.budgetId, budget.id),
        ),
      )
      .orderBy(asc(budgetLines.category))

    return { budget, lines }
  }
}

export class TransferRepository {
  constructor(private readonly db: Database) {}

  async create(input: typeof transferMatches.$inferInsert) {
    const [created] = await this.db
      .insert(transferMatches)
      .values(input)
      .returning()
    return created
  }

  async refreshCandidates(
    userId: string,
    candidates: readonly {
      transactionOutId: string
      transactionInId: string
      scoreBps: number
      method: 'internal_transfer' | 'credit_card_payment'
      autoAccept: boolean
    }[],
  ) {
    await this.db.transaction(async (tx) => {
      for (const candidate of candidates) {
        const [existing] = await tx
          .select()
          .from(transferMatches)
          .where(
            and(
              eq(transferMatches.userId, userId),
              or(
                and(
                  eq(
                    transferMatches.transactionOutId,
                    candidate.transactionOutId,
                  ),
                  eq(
                    transferMatches.transactionInId,
                    candidate.transactionInId,
                  ),
                ),
                and(
                  eq(
                    transferMatches.transactionOutId,
                    candidate.transactionInId,
                  ),
                  eq(
                    transferMatches.transactionInId,
                    candidate.transactionOutId,
                  ),
                ),
              ),
            ),
          )
          .limit(1)
        if (existing !== undefined) continue

        const status = candidate.autoAccept ? 'accepted' : 'candidate'
        await tx.insert(transferMatches).values({
          id: randomUUID(),
          userId,
          transactionOutId: candidate.transactionOutId,
          transactionInId: candidate.transactionInId,
          scoreBps: candidate.scoreBps,
          status,
          method: candidate.method,
          reviewedAt: candidate.autoAccept ? new Date() : null,
        })

        if (candidate.autoAccept) {
          const economicType =
            candidate.method === 'credit_card_payment'
              ? 'debt_payment'
              : 'transfer'
          await tx
            .update(transactions)
            .set({
              economicType,
              appCategory:
                candidate.method === 'credit_card_payment'
                  ? 'Credit card payment'
                  : 'Transfer',
              classificationConfidenceBps: candidate.scoreBps,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(transactions.userId, userId),
                inArray(transactions.id, [
                  candidate.transactionOutId,
                  candidate.transactionInId,
                ]),
                eq(transactions.userReviewed, false),
              ),
            )
        }
      }
      await tx.delete(metricSnapshots).where(eq(metricSnapshots.userId, userId))
    })
  }

  async listCandidates(userId: string) {
    return this.db
      .select()
      .from(transferMatches)
      .where(
        and(
          eq(transferMatches.userId, userId),
          eq(transferMatches.status, 'candidate'),
        ),
      )
      .orderBy(desc(transferMatches.scoreBps))
  }

  async listAccepted(userId: string) {
    return this.db
      .select({
        transactionOutId: transferMatches.transactionOutId,
        transactionInId: transferMatches.transactionInId,
        method: transferMatches.method,
        scoreBps: transferMatches.scoreBps,
      })
      .from(transferMatches)
      .where(
        and(
          eq(transferMatches.userId, userId),
          eq(transferMatches.status, 'accepted'),
        ),
      )
  }

  async reapplyAccepted(userId: string) {
    const accepted = await this.listAccepted(userId)
    await this.db.transaction(async (tx) => {
      for (const match of accepted) {
        const economicType =
          match.method === 'credit_card_payment' ? 'debt_payment' : 'transfer'
        await tx
          .update(transactions)
          .set({
            economicType,
            appCategory:
              match.method === 'credit_card_payment'
                ? 'Credit card payment'
                : 'Transfer',
            classificationConfidenceBps: match.scoreBps,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(transactions.userId, userId),
              inArray(transactions.id, [
                match.transactionOutId,
                match.transactionInId,
              ]),
              eq(transactions.userReviewed, false),
            ),
          )
      }
    })
  }

  async review(userId: string, matchId: string, accept: boolean) {
    await this.db.transaction(async (tx) => {
      const [match] = await tx
        .select()
        .from(transferMatches)
        .where(
          and(
            eq(transferMatches.id, matchId),
            eq(transferMatches.userId, userId),
            eq(transferMatches.status, 'candidate'),
          ),
        )
        .limit(1)
      if (match === undefined) {
        throw new Error('Transfer match not found for owner')
      }

      await tx
        .update(transferMatches)
        .set({
          status: accept ? 'accepted' : 'rejected',
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(transferMatches.id, matchId))

      if (accept) {
        const economicType =
          match.method === 'credit_card_payment' ? 'debt_payment' : 'transfer'
        await tx
          .update(transactions)
          .set({
            economicType,
            appCategory:
              match.method === 'credit_card_payment'
                ? 'Credit card payment'
                : 'Transfer',
            userReviewed: true,
            classificationConfidenceBps: 10_000,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(transactions.userId, userId),
              inArray(transactions.id, [
                match.transactionOutId,
                match.transactionInId,
              ]),
            ),
          )
      }
      await tx.delete(metricSnapshots).where(eq(metricSnapshots.userId, userId))
      await tx.insert(auditEvents).values({
        id: randomUUID(),
        userId,
        actor: 'owner',
        action: accept ? 'transfer_match.accepted' : 'transfer_match.rejected',
        targetType: 'transfer_match',
        targetId: matchId,
        metadata: { method: match.method },
      })
    })
  }
}

export class ClassificationRuleRepository {
  constructor(private readonly db: Database) {}

  async listActive(userId: string) {
    return this.db
      .select()
      .from(classificationRules)
      .where(
        and(
          eq(classificationRules.userId, userId),
          eq(classificationRules.active, true),
        ),
      )
      .orderBy(asc(classificationRules.priority), asc(classificationRules.id))
  }

  async create(input: {
    userId: string
    matchConditions: Record<string, unknown>
    economicType: (typeof classificationRules.$inferInsert)['economicType']
    category: string
    priority: number
  }) {
    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(classificationRules)
        .values({ id: randomUUID(), ...input })
        .returning()
      await tx.insert(auditEvents).values({
        id: randomUUID(),
        userId: input.userId,
        actor: 'owner',
        action: 'classification_rule.created',
        targetType: 'classification_rule',
        targetId: created?.id,
        metadata: {
          economicType: input.economicType,
          category: input.category,
        },
      })
      return created
    })
  }

  async remove(userId: string, ruleId: string) {
    await this.db.transaction(async (tx) => {
      const removed = await tx
        .delete(classificationRules)
        .where(
          and(
            eq(classificationRules.id, ruleId),
            eq(classificationRules.userId, userId),
          ),
        )
        .returning({ id: classificationRules.id })
      if (removed.length !== 1) {
        throw new Error('Classification rule not found for owner')
      }
      await tx.insert(auditEvents).values({
        id: randomUUID(),
        userId,
        actor: 'owner',
        action: 'classification_rule.removed',
        targetType: 'classification_rule',
        targetId: ruleId,
        metadata: {},
      })
    })
  }
}

export class MetricRepository {
  constructor(private readonly db: Database) {}

  async save(input: typeof metricSnapshots.$inferInsert) {
    const [created] = await this.db
      .insert(metricSnapshots)
      .values(input)
      .returning()
    return created
  }

  async listForUser(userId: string, metricKey: string) {
    return this.db
      .select()
      .from(metricSnapshots)
      .where(
        and(
          eq(metricSnapshots.userId, userId),
          eq(metricSnapshots.metricKey, metricKey),
        ),
      )
      .orderBy(asc(metricSnapshots.calculatedAt))
  }
}

export class RecommendationRepository {
  constructor(private readonly db: Database) {}

  async save(input: typeof recommendations.$inferInsert) {
    const [created] = await this.db
      .insert(recommendations)
      .values(input)
      .returning()
    return created
  }

  async listActiveForUser(userId: string) {
    return this.db
      .select()
      .from(recommendations)
      .where(
        and(
          eq(recommendations.userId, userId),
          eq(recommendations.status, 'active'),
        ),
      )
      .orderBy(asc(recommendations.priority), asc(recommendations.id))
  }
}

export class TaskExecutionRepository {
  constructor(private readonly db: Database) {}

  async claim(input: {
    id: string
    userId?: string
    idempotencyKey: string
    operation: string
    schemaVersion: number
  }): Promise<boolean> {
    const inserted = await this.db
      .insert(taskExecutions)
      .values({
        id: input.id,
        userId: input.userId,
        idempotencyKey: input.idempotencyKey,
        operation: input.operation,
        schemaVersion: input.schemaVersion,
        status: 'started',
      })
      .onConflictDoNothing({ target: taskExecutions.idempotencyKey })
      .returning({ id: taskExecutions.id })

    return inserted.length === 1
  }

  async complete(id: string) {
    await this.db
      .update(taskExecutions)
      .set({
        status: 'completed',
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(taskExecutions.id, id))
  }

  async fail(id: string, errorCode: string, attemptCount: number) {
    await this.db
      .update(taskExecutions)
      .set({
        status: 'failed',
        lastErrorCode: errorCode,
        attemptCount,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(taskExecutions.id, id))
  }
}

export class SyncJobRepository {
  constructor(private readonly db: Database) {}

  async createQueued(input: {
    id: string
    userId: string
    connectionId: string
    operation: string
    trigger: string
    idempotencyKey: string
  }) {
    const [created] = await this.db
      .insert(syncJobs)
      .values({
        id: input.id,
        userId: input.userId,
        connectionId: input.connectionId,
        operation: input.operation,
        trigger: input.trigger,
        idempotencyKey: input.idempotencyKey,
        status: 'queued',
      })
      .returning()
    return created
  }

  async markEnqueued(id: string, cloudTaskName: string) {
    await this.db
      .update(syncJobs)
      .set({ cloudTaskName, updatedAt: new Date() })
      .where(eq(syncJobs.id, id))
  }

  async markRunning(id: string) {
    await this.db
      .update(syncJobs)
      .set({
        status: 'running',
        startedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(syncJobs.id, id))
  }

  async markSucceeded(id: string, result: Record<string, unknown>) {
    await this.db
      .update(syncJobs)
      .set({
        status: 'succeeded',
        completedAt: new Date(),
        lastErrorCode: null,
        result,
        updatedAt: new Date(),
      })
      .where(eq(syncJobs.id, id))
  }

  async markFailed(id: string, errorCode: string) {
    await this.db
      .update(syncJobs)
      .set({
        status: 'failed',
        completedAt: new Date(),
        lastErrorCode: errorCode,
        updatedAt: new Date(),
      })
      .where(eq(syncJobs.id, id))
  }

  async listRecentForUser(userId: string, limit = 50) {
    return this.db
      .select()
      .from(syncJobs)
      .where(eq(syncJobs.userId, userId))
      .orderBy(desc(syncJobs.createdAt))
      .limit(limit)
  }
}

export interface PlaidTransactionInput {
  providerTransactionId: string
  providerAccountId: string
  pendingProviderTransactionId?: string
  authorizedDate?: string
  postedDate: string
  rawProviderAmountMinor: bigint
  normalizedAmountMinor: bigint
  currency: 'USD' | 'EUR'
  merchantName?: string
  originalDescription: string
  state: 'pending' | 'posted'
  providerCategory?: string
  providerCategoryConfidenceBps?: number
  economicType: 'income' | 'expense' | 'refund' | 'unknown'
  appCategory: string
  deduplicationFingerprint: string
}

export function createRepositories(db: Database) {
  return {
    users: new UserRepository(db),
    connections: new ConnectionRepository(db),
    accounts: new AccountRepository(db),
    transactions: new TransactionRepository(db),
    transfers: new TransferRepository(db),
    classificationRules: new ClassificationRuleRepository(db),
    liabilities: new LiabilityRepository(db),
    budgets: new BudgetRepository(db),
    metrics: new MetricRepository(db),
    recommendations: new RecommendationRepository(db),
    taskExecutions: new TaskExecutionRepository(db),
    syncJobs: new SyncJobRepository(db),
  }
}
