import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { eq, inArray, sql } from 'drizzle-orm'
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
      'sync_jobs',
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

  it('persists and revokes a Plaid connection without plaintext tokens', async () => {
    const plaidItemId = `item-${randomUUID()}`
    const connectionId = await repositories.connections.createPlaidConnection({
      userId: syntheticIds.user,
      plaidItemId,
      institutionProviderId: `institution-${randomUUID()}`,
      institutionName: 'Integration Test Bank',
      tokenEnvelope: {
        encryptedAccessToken: 'encrypted-token',
        wrappedDataKey: 'nonce.tag.wrapped-key',
        encryptionNonce: 'token-nonce',
        encryptionTag: 'token-tag',
        encryptionAlgorithm: 'aes-256-gcm',
        kmsKeyName: 'local://plaid-token-wrapping/v1',
      },
      accounts: [
        {
          providerAccountId: `account-${randomUUID()}`,
          name: 'Integration checking',
          mask: '4321',
          kind: 'checking',
          accountClass: 'asset',
          currentBalanceMinor: 12_345n,
          currency: 'USD',
          balanceAsOf: '2026-06-25',
        },
      ],
    })

    const stored = await repositories.connections.getTokenEnvelopeForUser(
      syntheticIds.user,
      connectionId,
    )
    expect(stored).toMatchObject({
      plaidItemId,
      encryptedAccessToken: 'encrypted-token',
      status: 'active',
    })

    const visible = await repositories.connections.listWithAccountsForUser(
      syntheticIds.user,
    )
    expect(
      visible.find((connection) => connection.id === connectionId),
    ).toMatchObject({
      institutionName: 'Integration Test Bank',
      accounts: [
        expect.objectContaining({
          name: 'Integration checking',
          currentBalanceMinor: 12_345n,
        }),
      ],
    })

    await repositories.connections.revokeForUser(
      syntheticIds.user,
      connectionId,
    )
    const revoked = await db
      .select()
      .from(connections)
      .where(eq(connections.id, connectionId))
    expect(revoked[0]).toMatchObject({
      status: 'revoked',
      encryptedAccessToken: null,
      wrappedDataKey: null,
    })
    expect(
      await db
        .select()
        .from(accounts)
        .where(eq(accounts.connectionId, connectionId)),
    ).toHaveLength(0)
  })

  it('applies transaction pages idempotently and advances the cursor atomically', async () => {
    const providerTransactionId = `sync-${randomUUID()}`
    const fingerprint = `sync:${randomUUID()}`
    const transaction = {
      providerTransactionId,
      providerAccountId: 'provider_checking-1',
      postedDate: '2026-06-26',
      rawProviderAmountMinor: 2_500n,
      normalizedAmountMinor: -2_500n,
      currency: 'USD' as const,
      originalDescription: 'Sanitized merchant',
      state: 'pending' as const,
      economicType: 'expense' as const,
      appCategory: 'FOOD_AND_DRINK',
      deduplicationFingerprint: fingerprint,
    }

    await repositories.transactions.applyPlaidSync({
      userId: syntheticIds.user,
      connectionId: syntheticIds.connection,
      startingCursor: null,
      finalCursor: 'cursor-1',
      added: [transaction],
      modified: [],
      removedProviderTransactionIds: [],
    })
    await repositories.transactions.applyPlaidSync({
      userId: syntheticIds.user,
      connectionId: syntheticIds.connection,
      startingCursor: 'cursor-1',
      finalCursor: 'cursor-2',
      added: [],
      modified: [
        {
          ...transaction,
          state: 'posted',
          normalizedAmountMinor: -2_600n,
          rawProviderAmountMinor: 2_600n,
        },
      ],
      removedProviderTransactionIds: [],
    })

    const rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.providerTransactionId, providerTransactionId))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      state: 'posted',
      normalizedAmountMinor: -2_600n,
      removed: false,
    })

    const [connection] = await db
      .select()
      .from(connections)
      .where(eq(connections.id, syntheticIds.connection))
    expect(connection?.transactionCursor).toBe('cursor-2')

    const pendingProviderId = `pending-${randomUUID()}`
    await repositories.transactions.applyPlaidSync({
      userId: syntheticIds.user,
      connectionId: syntheticIds.connection,
      startingCursor: 'cursor-2',
      finalCursor: 'cursor-3',
      added: [
        {
          ...transaction,
          providerTransactionId: pendingProviderId,
          state: 'pending',
          deduplicationFingerprint: `sync:${randomUUID()}`,
        },
      ],
      modified: [],
      removedProviderTransactionIds: [],
    })
    const postedProviderId = `posted-${randomUUID()}`
    await repositories.transactions.applyPlaidSync({
      userId: syntheticIds.user,
      connectionId: syntheticIds.connection,
      startingCursor: 'cursor-3',
      finalCursor: 'cursor-4',
      added: [
        {
          ...transaction,
          providerTransactionId: postedProviderId,
          pendingProviderTransactionId: pendingProviderId,
          state: 'posted',
          deduplicationFingerprint: `sync:${randomUUID()}`,
        },
      ],
      modified: [],
      removedProviderTransactionIds: [],
    })

    const replacementRows = await db
      .select()
      .from(transactions)
      .where(
        inArray(transactions.providerTransactionId, [
          pendingProviderId,
          postedProviderId,
        ]),
      )
    expect(
      replacementRows.find(
        (row) => row.providerTransactionId === pendingProviderId,
      )?.removed,
    ).toBe(true)
    expect(
      replacementRows.find(
        (row) => row.providerTransactionId === postedProviderId,
      )?.removed,
    ).toBe(false)

    await repositories.transactions.applyPlaidSync({
      userId: syntheticIds.user,
      connectionId: syntheticIds.connection,
      startingCursor: 'cursor-4',
      finalCursor: 'cursor-5',
      added: [],
      modified: [],
      removedProviderTransactionIds: [postedProviderId],
    })
    const [removedPosted] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.providerTransactionId, postedProviderId))
    expect(removedPosted?.removed).toBe(true)

    await expect(
      repositories.transactions.applyPlaidSync({
        userId: syntheticIds.user,
        connectionId: syntheticIds.connection,
        startingCursor: 'stale-cursor',
        finalCursor: 'must-not-commit',
        added: [],
        modified: [],
        removedProviderTransactionIds: [],
      }),
    ).rejects.toThrow('cursor changed')
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

  it('tracks Plaid sync job lifecycle for dashboard status', async () => {
    const jobId = randomUUID()
    const idempotencyKey = `plaid-sync:${syntheticIds.connection}:${jobId}`

    const created = await repositories.syncJobs.createQueued({
      id: jobId,
      userId: syntheticIds.user,
      connectionId: syntheticIds.connection,
      operation: 'plaid.transactions.sync',
      trigger: 'manual',
      idempotencyKey,
    })
    if (created === undefined) throw new Error('Sync job was not created')
    expect(created.status).toBe('queued')

    await repositories.syncJobs.markEnqueued(jobId, 'plaid-sync/tasks/test')
    await repositories.syncJobs.markRunning(jobId)
    await repositories.syncJobs.markSucceeded(jobId, {
      added: 1,
      modified: 2,
      removed: 0,
      classified: 3,
    })

    const [latest] = await repositories.syncJobs.listRecentForUser(
      syntheticIds.user,
      1,
    )
    if (latest === undefined) throw new Error('Sync job was not listed')
    expect(latest).toMatchObject({
      id: jobId,
      connectionId: syntheticIds.connection,
      cloudTaskName: 'plaid-sync/tasks/test',
      status: 'succeeded',
      lastErrorCode: null,
    })
    expect(latest.result).toMatchObject({ added: 1, classified: 3 })
    expect(latest.startedAt).toBeInstanceOf(Date)
    expect(latest.completedAt).toBeInstanceOf(Date)
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

  it('removes transaction splits transactionally', async () => {
    const transactionId = syntheticIds.transactions['loan-payment']
    await repositories.transactions.replaceSplits(
      syntheticIds.user,
      transactionId,
      [],
    )
    expect(
      await db
        .select()
        .from(transactionSplits)
        .where(eq(transactionSplits.transactionId, transactionId)),
    ).toHaveLength(0)
  })

  it('preserves a user correction across provider synchronization', async () => {
    const transactionId = syntheticIds.transactions['pending-dining']
    await repositories.transactions.correctForUser(
      syntheticIds.user,
      transactionId,
      { economicType: 'expense', category: 'Dining override' },
    )

    const [connection] = await db
      .select()
      .from(connections)
      .where(eq(connections.id, syntheticIds.connection))
    const [account] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, syntheticIds.accounts['credit-card-1']))
    const [transaction] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, transactionId))

    await repositories.transactions.applyPlaidSync({
      userId: syntheticIds.user,
      connectionId: syntheticIds.connection,
      startingCursor: connection?.transactionCursor ?? null,
      finalCursor: `correction-${randomUUID()}`,
      added: [],
      modified: [
        {
          providerTransactionId: transaction!.providerTransactionId!,
          providerAccountId: account!.providerAccountId!,
          postedDate: transaction!.postedDate,
          rawProviderAmountMinor: 9_999n,
          normalizedAmountMinor: -9_999n,
          currency: 'USD',
          originalDescription: 'Provider changed description',
          state: 'posted',
          providerCategory: 'GENERAL_MERCHANDISE',
          economicType: 'expense',
          appCategory: 'Provider shopping',
          deduplicationFingerprint: transaction!.deduplicationFingerprint,
        },
      ],
      removedProviderTransactionIds: [],
    })

    const [updated] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, transactionId))
    expect(updated).toMatchObject({
      normalizedAmountMinor: -9_999n,
      appCategory: 'Dining override',
      economicType: 'expense',
      userReviewed: true,
      classificationConfidenceBps: 10_000,
    })

    await expect(
      repositories.transactions.correctForUser(
        syntheticIds.user,
        transactionId,
        { economicType: 'income', category: 'Invalid direction' },
      ),
    ).rejects.toThrow('does not match transaction direction')
  })
})
