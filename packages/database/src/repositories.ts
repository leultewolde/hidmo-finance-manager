import { randomUUID } from 'node:crypto'

import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm'

import type {
  Account,
  Transaction,
  TransactionSplit,
} from '@hidmo/finance-engine'
import { assertTransactionSplits } from '@hidmo/finance-engine'

import type { Database } from './client.js'
import {
  accounts,
  budgetLines,
  budgets,
  connections,
  institutions,
  liabilities,
  metricSnapshots,
  recommendations,
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
        createdAt: connections.createdAt,
      })
      .from(connections)
      .leftJoin(institutions, eq(connections.institutionId, institutions.id))
      .where(
        and(eq(connections.userId, userId), eq(connections.status, 'active')),
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
}

export function createRepositories(db: Database) {
  return {
    users: new UserRepository(db),
    connections: new ConnectionRepository(db),
    accounts: new AccountRepository(db),
    transactions: new TransactionRepository(db),
    transfers: new TransferRepository(db),
    liabilities: new LiabilityRepository(db),
    budgets: new BudgetRepository(db),
    metrics: new MetricRepository(db),
    recommendations: new RecommendationRepository(db),
    taskExecutions: new TaskExecutionRepository(db),
  }
}
