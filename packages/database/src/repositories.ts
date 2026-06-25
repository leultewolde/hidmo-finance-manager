import { and, asc, eq, inArray } from 'drizzle-orm'

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
