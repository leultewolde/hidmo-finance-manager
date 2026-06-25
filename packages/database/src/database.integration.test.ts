import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  calculateBalanceSheet,
  calculateCashFlow,
  syntheticHousehold,
} from '@hidmo/finance-engine'

import { createDatabase, createDatabasePool } from './client.js'
import { syntheticIds } from './ids.js'
import { createRepositories } from './repositories.js'
import {
  accounts,
  connections,
  transactionSplits,
  transactions,
  users,
} from './schema.js'
import { seedSyntheticHousehold } from './seed.js'

const databaseUrl = process.env.DATABASE_URL
if (databaseUrl === undefined) {
  throw new Error('DATABASE_URL is required for database integration tests')
}

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url))
const pool = createDatabasePool(databaseUrl)
const db = createDatabase(pool)
const repositories = createRepositories(db)

beforeAll(async () => {
  await db.execute(sql`drop schema if exists public cascade`)
  await db.execute(sql`drop schema if exists drizzle cascade`)
  await db.execute(sql`create schema public`)
  await migrate(db, { migrationsFolder })
  await migrate(db, { migrationsFolder })
  await seedSyntheticHousehold(db)
  await seedSyntheticHousehold(db)
})

afterAll(async () => {
  await pool.end()
})

describe('database migrations and synthetic seed', () => {
  it('creates the complete initial table set', async () => {
    const result = await pool.query<{ table_name: string }>(
      `select table_name
       from information_schema.tables
       where table_schema = 'public'
       order by table_name`,
    )

    expect(result.rows.map((row) => row.table_name)).toEqual([
      'accounts',
      'audit_events',
      'budget_lines',
      'budgets',
      'classification_rules',
      'connections',
      'goals',
      'institutions',
      'liabilities',
      'metric_snapshots',
      'recommendations',
      'recurring_streams',
      'task_executions',
      'transaction_splits',
      'transactions',
      'transfer_matches',
      'users',
    ])
  })

  it('stores only encrypted token envelope columns', async () => {
    const result = await pool.query<{ column_name: string }>(
      `select column_name
       from information_schema.columns
       where table_schema = 'public' and table_name = 'connections'`,
    )
    const columns = result.rows.map((row) => row.column_name)

    expect(columns).not.toContain('access_token')
    expect(columns).toContain('encrypted_access_token')
    expect(columns).toContain('wrapped_data_key')
    expect(columns).toContain('kms_key_name')
  })

  it('rejects incomplete encrypted-token envelopes', async () => {
    await expect(
      db.insert(connections).values({
        id: randomUUID(),
        userId: syntheticIds.user,
        plaidItemId: `partial-envelope-${randomUUID()}`,
        encryptedAccessToken: 'ciphertext-only',
      }),
    ).rejects.toThrow()
  })

  it('seeds deterministically without duplicates', async () => {
    const accountRows = await db.select().from(accounts)
    const transactionRows = await db.select().from(transactions)
    const splitRows = await db.select().from(transactionSplits)

    expect(accountRows).toHaveLength(7)
    expect(transactionRows).toHaveLength(11)
    expect(splitRows).toHaveLength(3)
  })

  it('reconciles repository records with finance-engine fixtures', async () => {
    const accountRecords = await repositories.accounts.listForUser(
      syntheticIds.user,
    )
    const transactionRecords = await repositories.transactions.listForUser(
      syntheticIds.user,
    )

    expect(calculateBalanceSheet(accountRecords)).toEqual(
      calculateBalanceSheet(syntheticHousehold.accounts),
    )
    expect(
      calculateCashFlow(
        transactionRecords.transactions,
        { startDate: '2026-06-01', endDate: '2026-06-30' },
        transactionRecords.splits,
      ),
    ).toEqual(
      calculateCashFlow(
        [
          ...syntheticHousehold.transactions,
          syntheticHousehold.loanPaymentTransaction,
        ],
        { startDate: '2026-06-01', endDate: '2026-06-30' },
        syntheticHousehold.loanPaymentSplits,
      ),
    )
  })
})

describe('database constraints and transactions', () => {
  it('enforces the single-owner invariant', async () => {
    await expect(
      db.insert(users).values({
        id: randomUUID(),
        firebaseUid: 'second-owner',
        email: 'second@example.invalid',
      }),
    ).rejects.toThrow()
  })

  it('rejects duplicate provider account IDs within a connection', async () => {
    await expect(
      db.insert(accounts).values({
        id: randomUUID(),
        userId: syntheticIds.user,
        connectionId: syntheticIds.connection,
        providerAccountId: 'provider_checking-1',
        name: 'Duplicate checking',
        kind: 'checking',
        accountClass: 'asset',
        currentBalanceMinor: 1n,
        currency: 'USD',
        balanceSource: 'connected',
        dataQuality: 'verified',
        balanceAsOf: '2026-06-30',
      }),
    ).rejects.toThrow()
  })

  it('rejects invalid ownership references', async () => {
    await expect(
      db.insert(accounts).values({
        id: randomUUID(),
        userId: randomUUID(),
        name: 'Orphan manual account',
        kind: 'cash',
        accountClass: 'asset',
        currentBalanceMinor: 1n,
        currency: 'USD',
        balanceSource: 'manual',
        dataQuality: 'verified',
        balanceAsOf: '2026-06-30',
        manual: true,
      }),
    ).rejects.toThrow()
  })

  it('rolls back a failed multi-table transaction completely', async () => {
    const temporaryUserId = randomUUID()

    await expect(
      db.transaction(async (tx) => {
        await tx.insert(users).values({
          id: temporaryUserId,
          firebaseUid: 'rollback-owner',
          email: 'rollback@example.invalid',
        })
        await tx.insert(accounts).values({
          id: randomUUID(),
          userId: temporaryUserId,
          name: 'Invalid account',
          kind: 'cash',
          accountClass: 'asset',
          currentBalanceMinor: -1n,
          currency: 'USD',
          balanceSource: 'manual',
          dataQuality: 'verified',
          balanceAsOf: '2026-06-30',
          manual: true,
        })
      }),
    ).rejects.toThrow()

    const persisted = await db
      .select()
      .from(users)
      .where(eq(users.id, temporaryUserId))
    expect(persisted).toHaveLength(0)
  })

  it('claims task idempotency keys only once', async () => {
    const input = {
      id: randomUUID(),
      userId: syntheticIds.user,
      idempotencyKey: `test:${randomUUID()}`,
      operation: 'integration-test',
      schemaVersion: 1,
    }

    await expect(repositories.taskExecutions.claim(input)).resolves.toBe(true)
    await expect(
      repositories.taskExecutions.claim({ ...input, id: randomUUID() }),
    ).resolves.toBe(false)
  })

  it('preserves existing splits when replacement validation fails', async () => {
    const transactionId = syntheticIds.transactions['loan-payment']
    const before = await db
      .select()
      .from(transactionSplits)
      .where(eq(transactionSplits.transactionId, transactionId))

    await expect(
      repositories.transactions.replaceSplits(
        syntheticIds.user,
        transactionId,
        [
          {
            id: randomUUID(),
            transactionId,
            amountMinor: -1n,
            economicType: 'expense',
            category: 'invalid',
          },
        ],
      ),
    ).rejects.toThrow(/must sum/)

    const after = await db
      .select()
      .from(transactionSplits)
      .where(eq(transactionSplits.transactionId, transactionId))
    expect(after).toEqual(before)
  })
})
