import { randomUUID } from 'node:crypto'

import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  or,
  sql,
} from 'drizzle-orm'

import type {
  Account,
  AccountKind,
  AnalysisInput,
  DatePeriod,
  Debt,
  RecommendationCandidate,
  RecommendationEvidenceReference,
  GroundedRecommendationOutput,
  RecommendationLifecycleStatus,
  RecommendationPriority,
  RecommendationProviderMetadata,
  Transaction,
  TransactionSplit,
} from '@hidmo/finance-engine'
import {
  assertTransactionSplits,
  validateRecommendationCandidate,
} from '@hidmo/finance-engine'
import type {
  ExportAnalysisSnapshotRow,
  ExportBudgetRow,
  ExportClassificationRuleRow,
  ExportConnectionRow,
  ExportManualLoanRow,
  ExportRecommendationRow,
  FinanceExportData,
} from '@hidmo/export'

import type { Database } from './client.js'
import {
  accounts,
  analysisJobs,
  analysisSnapshots,
  auditEvents,
  budgetLines,
  budgets,
  classificationRules,
  connections,
  deletionRequests,
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

type JsonObject = Record<string, unknown>

function asJsonObject(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null
}

function jsonString(value: unknown): string {
  return JSON.stringify(value ?? null)
}

function stringMetadataField(
  metadata: unknown,
  field: 'provider' | 'model' | 'promptVersion',
): string | null {
  const record = asJsonObject(metadata)
  const value = record?.[field]
  return typeof value === 'string' ? value : null
}

export type RecommendationReadModel = RecommendationCandidate & {
  rowId: string
  userId: string
  period: DatePeriod
  inputHash: string
  formulaVersion: string
  policyVersion: string
  rank?: number
  evidence: RecommendationEvidenceReference[]
  narrative?: string
  modelMetadata?: JsonObject
  createdAt: Date
  updatedAt: Date
}

type RecommendationBatchInput = {
  userId: string
  period: DatePeriod
  inputHash: string
  formulaVersion: string
  policyVersion: string
  evidence: readonly RecommendationEvidenceReference[]
  candidates: readonly RecommendationCandidate[]
}

type RecommendationGroundedBatchInput = {
  userId: string
  period: DatePeriod
  inputHash: string
  formulaVersion: string
  policyVersion: string
  recommendations: readonly GroundedRecommendationOutput[]
  metadata: RecommendationProviderMetadata
}

type SerializedRecommendationEvidence = Omit<
  RecommendationEvidenceReference,
  'amountMinor'
> & {
  amountMinor?: string
}

function serializeRecommendationEvidence(
  evidence: RecommendationEvidenceReference,
): SerializedRecommendationEvidence {
  const serialized: SerializedRecommendationEvidence = {
    id: evidence.id,
    kind: evidence.kind,
    label: evidence.label,
  }
  if (evidence.period !== undefined) serialized.period = evidence.period
  if (evidence.amountMinor !== undefined) {
    serialized.amountMinor = evidence.amountMinor.toString()
  }
  if (evidence.percentageBps !== undefined) {
    serialized.percentageBps = evidence.percentageBps
  }
  if (evidence.currency !== undefined) serialized.currency = evidence.currency
  if (evidence.severity !== undefined) serialized.severity = evidence.severity
  return serialized
}

function deserializeRecommendationEvidence(
  evidence: SerializedRecommendationEvidence,
): RecommendationEvidenceReference {
  const deserialized: RecommendationEvidenceReference = {
    id: evidence.id,
    kind: evidence.kind,
    label: evidence.label,
  }
  if (evidence.period !== undefined) deserialized.period = evidence.period
  if (evidence.amountMinor !== undefined) {
    deserialized.amountMinor = BigInt(evidence.amountMinor)
  }
  if (evidence.percentageBps !== undefined) {
    deserialized.percentageBps = evidence.percentageBps
  }
  if (evidence.currency !== undefined) deserialized.currency = evidence.currency
  if (evidence.severity !== undefined) {
    deserialized.severity = evidence.severity
  }
  return deserialized
}

function recommendationPriorityOrder(priority: RecommendationPriority) {
  switch (priority) {
    case 'high':
      return 1
    case 'medium':
      return 2
    case 'low':
      return 3
  }
}

function recommendationOrderSql() {
  return sql`case ${recommendations.priority}
    when 'high' then 1
    when 'medium' then 2
    else 3
  end`
}

function toDebtKind(kind: AccountKind): Debt['kind'] {
  switch (kind) {
    case 'credit_card':
    case 'personal_loan':
    case 'auto_loan':
    case 'student_loan':
    case 'mortgage':
    case 'line_of_credit':
      return kind
    default:
      throw new Error(`Unsupported liability account kind: ${kind}`)
  }
}

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
          inArray(connections.status, ['active', 'attention_required']),
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
          inArray(connections.status, ['active', 'attention_required']),
        ),
      )
      .limit(1)

    return connection
  }

  async getActiveByPlaidItemId(plaidItemId: string) {
    const [connection] = await this.db
      .select({
        id: connections.id,
        userId: connections.userId,
      })
      .from(connections)
      .where(
        and(
          eq(connections.plaidItemId, plaidItemId),
          eq(connections.status, 'active'),
          isNotNull(connections.encryptedAccessToken),
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

export class AnalysisInputRepository {
  constructor(private readonly db: Database) {}

  async buildForPeriod(
    userId: string,
    period: DatePeriod,
  ): Promise<AnalysisInput> {
    const accountRows = await this.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.active, true)))
      .orderBy(asc(accounts.id))

    const liabilityRows = await this.db
      .select({
        id: liabilities.id,
        accountId: liabilities.accountId,
        accountName: accounts.name,
        kind: liabilities.kind,
        principalBalanceMinor: liabilities.principalBalanceMinor,
        aprBps: liabilities.aprBps,
        minimumPaymentMinor: liabilities.minimumPaymentMinor,
        currency: accounts.currency,
      })
      .from(liabilities)
      .innerJoin(accounts, eq(liabilities.accountId, accounts.id))
      .where(
        and(
          eq(liabilities.userId, userId),
          eq(accounts.userId, userId),
          eq(accounts.active, true),
        ),
      )
      .orderBy(asc(liabilities.id))

    const transactionRows = await this.db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.removed, false),
          gte(transactions.postedDate, period.startDate),
          sql`${transactions.postedDate} <= ${period.endDate}`,
        ),
      )
      .orderBy(asc(transactions.postedDate), asc(transactions.id))

    const transactionIds = transactionRows.map((row) => row.id)
    const splitRows =
      transactionIds.length === 0
        ? []
        : await this.db
            .select()
            .from(transactionSplits)
            .where(
              and(
                eq(transactionSplits.userId, userId),
                inArray(transactionSplits.transactionId, transactionIds),
              ),
            )
            .orderBy(asc(transactionSplits.id))

    const budget = await new BudgetRepository(this.db).getForPeriod(
      userId,
      period.startDate,
      period.endDate,
    )

    return {
      period,
      reviewedTransactionsOnly: true,
      accounts: accountRows.map(
        (row): Account => ({
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
        }),
      ),
      debts: liabilityRows.map(
        (row): Debt => ({
          id: row.accountId,
          name: row.accountName,
          kind: toDebtKind(row.kind),
          balanceMinor: row.principalBalanceMinor,
          aprBps: row.aprBps ?? 0,
          minimumPaymentMinor: row.minimumPaymentMinor ?? 0n,
          currency: row.currency,
        }),
      ),
      transactions: transactionRows.map(
        (row): Transaction => ({
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
        }),
      ),
      splits: splitRows.map(
        (row): TransactionSplit => ({
          id: row.id,
          transactionId: row.transactionId,
          amountMinor: row.amountMinor,
          economicType: row.economicType,
          category: row.category,
        }),
      ),
      budgetLines:
        budget?.lines.map((line) => ({
          category: line.category,
          plannedMinor: line.plannedMinor,
        })) ?? [],
    }
  }
}

export class AnalysisSnapshotRepository {
  constructor(private readonly db: Database) {}

  async createDraft(input: {
    id: string
    userId: string
    period: DatePeriod
    inputHash: string
    formulaVersion: string
    deterministicSummary: JsonObject
  }) {
    const [snapshot] = await this.db
      .insert(analysisSnapshots)
      .values({
        id: input.id,
        userId: input.userId,
        periodStart: input.period.startDate,
        periodEnd: input.period.endDate,
        inputHash: input.inputHash,
        formulaVersion: input.formulaVersion,
        deterministicSummary: input.deterministicSummary,
        narrative: null,
        status: 'draft',
        completedAt: null,
        lastErrorCode: null,
      })
      .onConflictDoUpdate({
        target: [
          analysisSnapshots.userId,
          analysisSnapshots.periodStart,
          analysisSnapshots.periodEnd,
          analysisSnapshots.inputHash,
          analysisSnapshots.formulaVersion,
        ],
        set: {
          deterministicSummary: input.deterministicSummary,
          narrative: null,
          status: 'draft',
          completedAt: null,
          lastErrorCode: null,
          updatedAt: new Date(),
        },
      })
      .returning()

    return snapshot
  }

  async markComplete(snapshotId: string, narrative: JsonObject) {
    const [snapshot] = await this.db
      .update(analysisSnapshots)
      .set({
        narrative,
        status: 'complete',
        completedAt: new Date(),
        lastErrorCode: null,
        updatedAt: new Date(),
      })
      .where(eq(analysisSnapshots.id, snapshotId))
      .returning()

    if (snapshot === undefined) {
      throw new Error('Analysis snapshot not found')
    }

    return snapshot
  }

  async markFailed(snapshotId: string, errorCode: string) {
    const [snapshot] = await this.db
      .update(analysisSnapshots)
      .set({
        status: 'failed',
        completedAt: new Date(),
        lastErrorCode: errorCode,
        updatedAt: new Date(),
      })
      .where(eq(analysisSnapshots.id, snapshotId))
      .returning()

    if (snapshot === undefined) {
      throw new Error('Analysis snapshot not found')
    }

    return snapshot
  }

  async getLatestForUserPeriod(userId: string, period: DatePeriod) {
    const [snapshot] = await this.db
      .select()
      .from(analysisSnapshots)
      .where(
        and(
          eq(analysisSnapshots.userId, userId),
          eq(analysisSnapshots.periodStart, period.startDate),
          eq(analysisSnapshots.periodEnd, period.endDate),
        ),
      )
      .orderBy(desc(analysisSnapshots.createdAt), desc(analysisSnapshots.id))
      .limit(1)

    return snapshot
  }

  async getForInput(
    userId: string,
    period: DatePeriod,
    inputHash: string,
    formulaVersion: string,
  ) {
    const [snapshot] = await this.db
      .select()
      .from(analysisSnapshots)
      .where(
        and(
          eq(analysisSnapshots.userId, userId),
          eq(analysisSnapshots.periodStart, period.startDate),
          eq(analysisSnapshots.periodEnd, period.endDate),
          eq(analysisSnapshots.inputHash, inputHash),
          eq(analysisSnapshots.formulaVersion, formulaVersion),
        ),
      )
      .limit(1)

    return snapshot
  }

  async listRecentForUser(userId: string, limit = 10) {
    return this.db
      .select()
      .from(analysisSnapshots)
      .where(eq(analysisSnapshots.userId, userId))
      .orderBy(desc(analysisSnapshots.createdAt), desc(analysisSnapshots.id))
      .limit(limit)
  }
}

export class AnalysisJobRepository {
  constructor(private readonly db: Database) {}

  async createQueued(input: {
    id: string
    userId: string
    snapshotId?: string
    period: DatePeriod
    inputHash: string
    formulaVersion: string
  }) {
    const [job] = await this.db
      .insert(analysisJobs)
      .values({
        id: input.id,
        userId: input.userId,
        snapshotId: input.snapshotId,
        periodStart: input.period.startDate,
        periodEnd: input.period.endDate,
        inputHash: input.inputHash,
        formulaVersion: input.formulaVersion,
        status: 'queued',
      })
      .onConflictDoUpdate({
        target: [
          analysisJobs.userId,
          analysisJobs.periodStart,
          analysisJobs.periodEnd,
          analysisJobs.inputHash,
          analysisJobs.formulaVersion,
        ],
        set: {
          snapshotId: input.snapshotId,
          status: 'queued',
          startedAt: null,
          completedAt: null,
          lastErrorCode: null,
          updatedAt: new Date(),
        },
      })
      .returning()

    return job
  }

  async markRunning(jobId: string) {
    const [job] = await this.db
      .update(analysisJobs)
      .set({
        status: 'running',
        startedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(analysisJobs.id, jobId))
      .returning()

    if (job === undefined) {
      throw new Error('Analysis job not found')
    }

    return job
  }

  async markSucceeded(jobId: string, snapshotId: string) {
    const [job] = await this.db
      .update(analysisJobs)
      .set({
        snapshotId,
        status: 'succeeded',
        completedAt: new Date(),
        lastErrorCode: null,
        updatedAt: new Date(),
      })
      .where(eq(analysisJobs.id, jobId))
      .returning()

    if (job === undefined) {
      throw new Error('Analysis job not found')
    }

    return job
  }

  async markFailed(jobId: string, errorCode: string) {
    const [job] = await this.db
      .update(analysisJobs)
      .set({
        status: 'failed',
        completedAt: new Date(),
        lastErrorCode: errorCode,
        updatedAt: new Date(),
      })
      .where(eq(analysisJobs.id, jobId))
      .returning()

    if (job === undefined) {
      throw new Error('Analysis job not found')
    }

    return job
  }

  async getLatestForUserPeriod(userId: string, period: DatePeriod) {
    const [job] = await this.db
      .select()
      .from(analysisJobs)
      .where(
        and(
          eq(analysisJobs.userId, userId),
          eq(analysisJobs.periodStart, period.startDate),
          eq(analysisJobs.periodEnd, period.endDate),
        ),
      )
      .orderBy(desc(analysisJobs.createdAt), desc(analysisJobs.id))
      .limit(1)

    return job
  }
}

export class ExportRepository {
  constructor(private readonly db: Database) {}

  async buildForUser(userId: string): Promise<FinanceExportData> {
    const [
      accountRows,
      transactionRows,
      splitRows,
      classificationRuleRows,
      liabilityRows,
      budgetRows,
      snapshotRows,
      recommendationRows,
      connectionRows,
    ] = await Promise.all([
      this.db
        .select()
        .from(accounts)
        .where(eq(accounts.userId, userId))
        .orderBy(asc(accounts.name), asc(accounts.id)),
      this.db
        .select()
        .from(transactions)
        .where(eq(transactions.userId, userId))
        .orderBy(asc(transactions.postedDate), asc(transactions.id)),
      this.db
        .select()
        .from(transactionSplits)
        .where(eq(transactionSplits.userId, userId))
        .orderBy(
          asc(transactionSplits.transactionId),
          asc(transactionSplits.id),
        ),
      this.db
        .select()
        .from(classificationRules)
        .where(eq(classificationRules.userId, userId))
        .orderBy(
          asc(classificationRules.priority),
          asc(classificationRules.id),
        ),
      this.db
        .select()
        .from(liabilities)
        .where(eq(liabilities.userId, userId))
        .orderBy(asc(liabilities.id)),
      this.db
        .select({
          id: budgets.id,
          periodStart: budgets.periodStart,
          periodEnd: budgets.periodEnd,
          currency: budgets.currency,
          rolloverEnabled: budgets.rolloverEnabled,
          category: budgetLines.category,
          plannedMinor: budgetLines.plannedMinor,
          createdAt: budgetLines.createdAt,
          updatedAt: budgetLines.updatedAt,
        })
        .from(budgetLines)
        .innerJoin(budgets, eq(budgetLines.budgetId, budgets.id))
        .where(eq(budgetLines.userId, userId))
        .orderBy(
          asc(budgets.periodStart),
          asc(budgets.periodEnd),
          asc(budgetLines.category),
        ),
      this.db
        .select()
        .from(analysisSnapshots)
        .where(eq(analysisSnapshots.userId, userId))
        .orderBy(asc(analysisSnapshots.periodStart), asc(analysisSnapshots.id)),
      this.db
        .select()
        .from(recommendations)
        .where(eq(recommendations.userId, userId))
        .orderBy(
          asc(recommendations.periodStart),
          asc(recommendationOrderSql()),
          asc(recommendations.rank),
          asc(recommendations.candidateId),
        ),
      this.db
        .select({
          id: connections.id,
          institutionName: institutions.name,
          status: connections.status,
          consentExpiresAt: connections.consentExpiresAt,
          lastSuccessfulSyncAt: connections.lastSuccessfulSyncAt,
          errorCode: connections.errorCode,
          reconnectRequiredAt: connections.reconnectRequiredAt,
          createdAt: connections.createdAt,
          updatedAt: connections.updatedAt,
        })
        .from(connections)
        .leftJoin(institutions, eq(connections.institutionId, institutions.id))
        .where(eq(connections.userId, userId))
        .orderBy(asc(connections.createdAt), asc(connections.id)),
    ])

    return {
      accounts: accountRows.map((row) => ({
        id: row.id,
        connectionId: row.connectionId,
        name: row.name,
        kind: row.kind,
        accountClass: row.accountClass,
        subtype: row.subtype,
        currency: row.currency,
        balanceSource: row.balanceSource,
        dataQuality: row.dataQuality,
        active: row.active,
        manual: row.manual,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      accountBalances: accountRows.map((row) => ({
        accountId: row.id,
        currentBalanceMinor: row.currentBalanceMinor,
        availableBalanceMinor: row.availableBalanceMinor,
        creditLimitMinor: row.creditLimitMinor,
        currency: row.currency,
        balanceAsOf: row.balanceAsOf,
      })),
      transactions: transactionRows.map((row) => ({
        id: row.id,
        accountId: row.accountId,
        authorizedDate: row.authorizedDate,
        postedDate: row.postedDate,
        normalizedAmountMinor: row.normalizedAmountMinor,
        currency: row.currency,
        merchantName: row.merchantName,
        originalDescription: row.originalDescription,
        state: row.state,
        removed: row.removed,
        economicType: row.economicType,
        appCategory: row.appCategory,
        classificationConfidenceBps: row.classificationConfidenceBps,
        userReviewed: row.userReviewed,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      transactionSplits: splitRows.map((row) => ({
        id: row.id,
        transactionId: row.transactionId,
        amountMinor: row.amountMinor,
        economicType: row.economicType,
        category: row.category,
        linkedLiabilityId: row.linkedLiabilityId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      classificationRules: classificationRuleRows.map(
        (row): ExportClassificationRuleRow => ({
          id: row.id,
          matchConditionsJson: jsonString(row.matchConditions),
          economicType: row.economicType,
          category: row.category,
          priority: row.priority,
          active: row.active,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        }),
      ),
      manualLoans: liabilityRows.map(
        (row): ExportManualLoanRow => ({
          id: row.id,
          accountId: row.accountId,
          kind: row.kind,
          principalBalanceMinor: row.principalBalanceMinor,
          aprBps: row.aprBps,
          minimumPaymentMinor: row.minimumPaymentMinor,
          nextDueDate: row.nextDueDate,
          originalPrincipalMinor: row.originalPrincipalMinor,
          termMonths: row.termMonths,
          maturityDate: row.maturityDate,
          source: row.source,
          sourceUpdatedAt: row.sourceUpdatedAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        }),
      ),
      budgets: budgetRows.map(
        (row): ExportBudgetRow => ({
          id: row.id,
          periodStart: row.periodStart,
          periodEnd: row.periodEnd,
          currency: row.currency,
          rolloverEnabled: row.rolloverEnabled,
          category: row.category,
          plannedMinor: row.plannedMinor,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        }),
      ),
      analysisSnapshots: snapshotRows.map(
        (row): ExportAnalysisSnapshotRow => ({
          id: row.id,
          periodStart: row.periodStart,
          periodEnd: row.periodEnd,
          status: row.status,
          inputHash: row.inputHash,
          formulaVersion: row.formulaVersion,
          promptVersion: null,
          modelProvider: null,
          modelName: null,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        }),
      ),
      recommendations: recommendationRows.map(
        (row): ExportRecommendationRow => ({
          id: row.id,
          candidateId: row.candidateId,
          periodStart: row.periodStart,
          periodEnd: row.periodEnd,
          formulaVersion: row.formulaVersion,
          policyVersion: row.policyVersion,
          type: row.type,
          status: row.status,
          priority: row.priority,
          rank: row.rank,
          title: row.title,
          rationale: row.rationale,
          evidenceIdsJson: jsonString(row.evidenceIds),
          assumptionsJson: jsonString(row.assumptions),
          estimatedMonthlyImpactMinor: row.estimatedMonthlyImpactMinor,
          currency: row.currency,
          confidenceBps: row.confidenceBps,
          modelProvider: stringMetadataField(row.modelMetadata, 'provider'),
          modelName: stringMetadataField(row.modelMetadata, 'model'),
          promptVersion: stringMetadataField(
            row.modelMetadata,
            'promptVersion',
          ),
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        }),
      ),
      connections: connectionRows.map(
        (row): ExportConnectionRow => ({
          id: row.id,
          institutionName: row.institutionName,
          status: row.status,
          consentExpiresAt: row.consentExpiresAt?.toISOString() ?? null,
          lastSuccessfulSyncAt: row.lastSuccessfulSyncAt?.toISOString() ?? null,
          errorCode: row.errorCode,
          reconnectRequiredAt: row.reconnectRequiredAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        }),
      ),
    }
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

  async upsertCandidateBatch(input: RecommendationBatchInput) {
    const evidenceById = new Map(
      input.evidence.map((entry) => [entry.id, entry]),
    )

    return this.db.transaction(async (tx) => {
      const rows: (typeof recommendations.$inferSelect)[] = []

      for (const candidate of input.candidates) {
        validateRecommendationCandidate(candidate, input.evidence)

        const candidateEvidence = candidate.evidenceIds.map((evidenceId) => {
          const evidence = evidenceById.get(evidenceId)
          if (evidence === undefined) {
            throw new Error(`Recommendation evidence not found: ${evidenceId}`)
          }
          return serializeRecommendationEvidence(evidence)
        })
        const rank = recommendationPriorityOrder(candidate.priority)

        const [row] = await tx
          .insert(recommendations)
          .values({
            id: randomUUID(),
            userId: input.userId,
            candidateId: candidate.id,
            periodStart: input.period.startDate,
            periodEnd: input.period.endDate,
            inputHash: input.inputHash,
            formulaVersion: input.formulaVersion,
            policyVersion: input.policyVersion,
            type: candidate.type,
            status: candidate.status,
            priority: candidate.priority,
            rank,
            title: candidate.title,
            rationale: candidate.rationale,
            evidenceIds: candidate.evidenceIds,
            evidence: candidateEvidence,
            assumptions: candidate.assumptions,
            estimatedMonthlyImpactMinor: candidate.estimatedMonthlyImpactMinor,
            currency: candidate.currency,
            confidenceBps: candidate.confidenceBps,
            narrative: null,
            modelMetadata: null,
          })
          .onConflictDoUpdate({
            target: [
              recommendations.userId,
              recommendations.periodStart,
              recommendations.periodEnd,
              recommendations.inputHash,
              recommendations.formulaVersion,
              recommendations.policyVersion,
              recommendations.candidateId,
            ],
            set: {
              type: candidate.type,
              priority: candidate.priority,
              rank,
              title: candidate.title,
              rationale: candidate.rationale,
              evidenceIds: candidate.evidenceIds,
              evidence: candidateEvidence,
              assumptions: candidate.assumptions,
              estimatedMonthlyImpactMinor:
                candidate.estimatedMonthlyImpactMinor,
              currency: candidate.currency,
              confidenceBps: candidate.confidenceBps,
              updatedAt: new Date(),
            },
          })
          .returning()

        if (row !== undefined) rows.push(row)
      }

      await tx
        .update(recommendations)
        .set({
          status: 'expired',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(recommendations.userId, input.userId),
            eq(recommendations.periodStart, input.period.startDate),
            eq(recommendations.periodEnd, input.period.endDate),
            eq(recommendations.formulaVersion, input.formulaVersion),
            eq(recommendations.policyVersion, input.policyVersion),
            inArray(recommendations.status, ['candidate', 'active']),
            sql`${recommendations.inputHash} <> ${input.inputHash}`,
          ),
        )

      return rows.map(recommendationRowToReadModel)
    })
  }

  async listForInput(input: {
    userId: string
    period: DatePeriod
    inputHash: string
    formulaVersion: string
    policyVersion: string
  }): Promise<RecommendationReadModel[]> {
    const rows = await this.db
      .select()
      .from(recommendations)
      .where(
        and(
          eq(recommendations.userId, input.userId),
          eq(recommendations.periodStart, input.period.startDate),
          eq(recommendations.periodEnd, input.period.endDate),
          eq(recommendations.inputHash, input.inputHash),
          eq(recommendations.formulaVersion, input.formulaVersion),
          eq(recommendations.policyVersion, input.policyVersion),
        ),
      )
      .orderBy(
        asc(recommendationOrderSql()),
        asc(recommendations.rank),
        asc(recommendations.candidateId),
      )

    return rows.map(recommendationRowToReadModel)
  }

  async applyGroundedRecommendations(input: RecommendationGroundedBatchInput) {
    return this.db.transaction(async (tx) => {
      for (const recommendation of input.recommendations) {
        const [row] = await tx
          .update(recommendations)
          .set({
            status: 'active',
            rank: recommendation.rank,
            priority: recommendation.priority,
            title: recommendation.title,
            rationale: recommendation.rationale,
            evidenceIds: recommendation.evidenceIds,
            assumptions: recommendation.assumptions,
            confidenceBps: recommendation.confidenceBps,
            modelMetadata: input.metadata as unknown as JsonObject,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(recommendations.userId, input.userId),
              eq(recommendations.periodStart, input.period.startDate),
              eq(recommendations.periodEnd, input.period.endDate),
              eq(recommendations.inputHash, input.inputHash),
              eq(recommendations.formulaVersion, input.formulaVersion),
              eq(recommendations.policyVersion, input.policyVersion),
              eq(recommendations.candidateId, recommendation.candidateId),
            ),
          )
          .returning()

        if (row === undefined) {
          throw new Error(
            `Recommendation candidate not found: ${recommendation.candidateId}`,
          )
        }
      }

      const rows = await tx
        .select()
        .from(recommendations)
        .where(
          and(
            eq(recommendations.userId, input.userId),
            eq(recommendations.periodStart, input.period.startDate),
            eq(recommendations.periodEnd, input.period.endDate),
            eq(recommendations.inputHash, input.inputHash),
            eq(recommendations.formulaVersion, input.formulaVersion),
            eq(recommendations.policyVersion, input.policyVersion),
          ),
        )
        .orderBy(
          asc(recommendationOrderSql()),
          asc(recommendations.rank),
          asc(recommendations.candidateId),
        )

      return rows.map(recommendationRowToReadModel)
    })
  }

  async listCurrentForUserPeriod(
    userId: string,
    period: DatePeriod,
  ): Promise<RecommendationReadModel[]> {
    const rows = await this.db
      .select()
      .from(recommendations)
      .where(
        and(
          eq(recommendations.userId, userId),
          eq(recommendations.periodStart, period.startDate),
          eq(recommendations.periodEnd, period.endDate),
          inArray(recommendations.status, ['candidate', 'active']),
        ),
      )
      .orderBy(
        desc(recommendations.createdAt),
        asc(recommendationOrderSql()),
        asc(recommendations.rank),
        asc(recommendations.candidateId),
      )

    return rows.map(recommendationRowToReadModel)
  }

  async listActiveForUser(userId: string) {
    const rows = await this.db
      .select()
      .from(recommendations)
      .where(
        and(
          eq(recommendations.userId, userId),
          eq(recommendations.status, 'active'),
        ),
      )
      .orderBy(
        asc(recommendationOrderSql()),
        asc(recommendations.rank),
        asc(recommendations.candidateId),
      )

    return rows.map(recommendationRowToReadModel)
  }

  async updateStatus(
    userId: string,
    recommendationRowId: string,
    status: RecommendationLifecycleStatus,
  ) {
    const [row] = await this.db
      .update(recommendations)
      .set({
        status,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(recommendations.id, recommendationRowId),
          eq(recommendations.userId, userId),
        ),
      )
      .returning()

    if (row === undefined) {
      throw new Error('Recommendation not found')
    }

    return recommendationRowToReadModel(row)
  }
}

function recommendationRowToReadModel(
  row: typeof recommendations.$inferSelect,
): RecommendationReadModel {
  const evidence = (
    row.evidence as unknown as SerializedRecommendationEvidence[]
  ).map(deserializeRecommendationEvidence)
  const candidate: RecommendationCandidate = {
    id: row.candidateId as RecommendationCandidate['id'],
    type: row.type as RecommendationCandidate['type'],
    title: row.title,
    rationale: row.rationale,
    priority: row.priority as RecommendationPriority,
    status: row.status,
    evidenceIds: row.evidenceIds as RecommendationCandidate['evidenceIds'],
    assumptions: row.assumptions as RecommendationCandidate['assumptions'],
    currency: row.currency,
    confidenceBps: row.confidenceBps,
  }
  if (row.estimatedMonthlyImpactMinor !== null) {
    candidate.estimatedMonthlyImpactMinor = row.estimatedMonthlyImpactMinor
  }
  validateRecommendationCandidate(candidate, evidence)

  const readModel: RecommendationReadModel = {
    ...candidate,
    rowId: row.id,
    userId: row.userId,
    period: {
      startDate: row.periodStart,
      endDate: row.periodEnd,
    },
    inputHash: row.inputHash,
    formulaVersion: row.formulaVersion,
    policyVersion: row.policyVersion,
    evidence,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
  if (row.rank !== null) readModel.rank = row.rank
  if (row.narrative !== null) readModel.narrative = row.narrative
  if (row.modelMetadata !== null) {
    readModel.modelMetadata = row.modelMetadata as JsonObject
  }
  return readModel
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
      .onConflictDoNothing({ target: syncJobs.idempotencyKey })
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

  async getLogContext(id: string) {
    const [job] = await this.db
      .select({
        id: syncJobs.id,
        userId: syncJobs.userId,
        connectionId: syncJobs.connectionId,
        operation: syncJobs.operation,
        trigger: syncJobs.trigger,
        status: syncJobs.status,
      })
      .from(syncJobs)
      .where(eq(syncJobs.id, id))
      .limit(1)
    return job
  }

  async listRecentForUser(userId: string, limit = 50) {
    return this.db
      .select()
      .from(syncJobs)
      .where(eq(syncJobs.userId, userId))
      .orderBy(desc(syncJobs.createdAt))
      .limit(limit)
  }

  async findWebhookCoalescingCandidate(input: {
    userId: string
    connectionId: string
    noOpCooldownSince: Date
  }) {
    const [candidate] = await this.db
      .select()
      .from(syncJobs)
      .where(
        and(
          eq(syncJobs.userId, input.userId),
          eq(syncJobs.connectionId, input.connectionId),
          eq(syncJobs.operation, 'plaid.transactions.sync'),
          or(
            inArray(syncJobs.status, ['queued', 'running']),
            and(
              eq(syncJobs.trigger, 'webhook'),
              eq(syncJobs.status, 'succeeded'),
              gte(syncJobs.completedAt, input.noOpCooldownSince),
              sql`coalesce((${syncJobs.result}->>'added')::integer, 0) = 0`,
              sql`coalesce((${syncJobs.result}->>'modified')::integer, 0) = 0`,
              sql`coalesce((${syncJobs.result}->>'removed')::integer, 0) = 0`,
            ),
          ),
        ),
      )
      .orderBy(desc(syncJobs.createdAt))
      .limit(1)

    return candidate
  }

  async createQueuedWebhookSyncJob(input: {
    id: string
    userId: string
    connectionId: string
    idempotencyKey: string
    noOpCooldownSince: Date
  }): Promise<
    | { status: 'created'; job: typeof syncJobs.$inferSelect }
    | {
        status: 'coalesced'
        reason: 'sync_already_active' | 'recent_noop_sync'
        job: typeof syncJobs.$inferSelect
      }
    | { status: 'duplicate_webhook' }
  > {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`plaid-sync:${input.connectionId}`}))`,
      )

      const [candidate] = await tx
        .select()
        .from(syncJobs)
        .where(
          and(
            eq(syncJobs.userId, input.userId),
            eq(syncJobs.connectionId, input.connectionId),
            eq(syncJobs.operation, 'plaid.transactions.sync'),
            or(
              inArray(syncJobs.status, ['queued', 'running']),
              and(
                eq(syncJobs.status, 'succeeded'),
                gte(syncJobs.completedAt, input.noOpCooldownSince),
                sql`coalesce((${syncJobs.result}->>'added')::integer, 0) = 0`,
                sql`coalesce((${syncJobs.result}->>'modified')::integer, 0) = 0`,
                sql`coalesce((${syncJobs.result}->>'removed')::integer, 0) = 0`,
              ),
            ),
          ),
        )
        .orderBy(desc(syncJobs.createdAt))
        .limit(1)

      if (candidate !== undefined) {
        return {
          status: 'coalesced',
          reason:
            candidate.status === 'queued' || candidate.status === 'running'
              ? 'sync_already_active'
              : 'recent_noop_sync',
          job: candidate,
        }
      }

      const [created] = await tx
        .insert(syncJobs)
        .values({
          id: input.id,
          userId: input.userId,
          connectionId: input.connectionId,
          operation: 'plaid.transactions.sync',
          trigger: 'webhook',
          idempotencyKey: input.idempotencyKey,
          status: 'queued',
        })
        .onConflictDoNothing({ target: syncJobs.idempotencyKey })
        .returning()

      return created === undefined
        ? { status: 'duplicate_webhook' }
        : { status: 'created', job: created }
    })
  }

  async createQueuedManualSyncJob(input: {
    id: string
    userId: string
    connectionId: string
    idempotencyKey: string
    noOpCooldownSince: Date
  }): Promise<
    | { status: 'created'; job: typeof syncJobs.$inferSelect }
    | {
        status: 'coalesced'
        reason: 'sync_already_active' | 'recent_noop_sync'
        job: typeof syncJobs.$inferSelect
      }
  > {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`plaid-sync:${input.connectionId}`}))`,
      )

      const [candidate] = await tx
        .select()
        .from(syncJobs)
        .where(
          and(
            eq(syncJobs.userId, input.userId),
            eq(syncJobs.connectionId, input.connectionId),
            eq(syncJobs.operation, 'plaid.transactions.sync'),
            or(
              inArray(syncJobs.status, ['queued', 'running']),
              and(
                eq(syncJobs.status, 'succeeded'),
                gte(syncJobs.completedAt, input.noOpCooldownSince),
                sql`coalesce((${syncJobs.result}->>'added')::integer, 0) = 0`,
                sql`coalesce((${syncJobs.result}->>'modified')::integer, 0) = 0`,
                sql`coalesce((${syncJobs.result}->>'removed')::integer, 0) = 0`,
              ),
            ),
          ),
        )
        .orderBy(desc(syncJobs.createdAt))
        .limit(1)

      if (candidate !== undefined) {
        return {
          status: 'coalesced',
          reason:
            candidate.status === 'queued' || candidate.status === 'running'
              ? 'sync_already_active'
              : 'recent_noop_sync',
          job: candidate,
        }
      }

      const [created] = await tx
        .insert(syncJobs)
        .values({
          id: input.id,
          userId: input.userId,
          connectionId: input.connectionId,
          operation: 'plaid.transactions.sync',
          trigger: 'manual',
          idempotencyKey: input.idempotencyKey,
          status: 'queued',
        })
        .onConflictDoNothing({ target: syncJobs.idempotencyKey })
        .returning()

      if (created === undefined) {
        throw new Error('Manual sync job idempotency key already exists')
      }

      return { status: 'created', job: created }
    })
  }
}

export class DeletionRequestRepository {
  constructor(private readonly db: Database) {}

  async createUserRequest(input: {
    id: string
    userId: string
    idempotencyKey: string
    requestedBy?: string
    auditMetadata?: JsonObject
  }) {
    return this.createRequest({
      ...input,
      scope: 'user',
      connectionId: null,
    })
  }

  async createConnectionRequest(input: {
    id: string
    userId: string
    connectionId: string
    idempotencyKey: string
    requestedBy?: string
    auditMetadata?: JsonObject
  }) {
    const [connection] = await this.db
      .select({ id: connections.id })
      .from(connections)
      .where(
        and(
          eq(connections.id, input.connectionId),
          eq(connections.userId, input.userId),
        ),
      )
      .limit(1)

    if (connection === undefined) {
      throw new Error('Connection does not belong to user')
    }

    return this.createRequest({
      ...input,
      scope: 'connection',
    })
  }

  async markRunning(id: string) {
    const [updated] = await this.db
      .update(deletionRequests)
      .set({
        status: 'running',
        startedAt: new Date(),
        attemptCount: sql`${deletionRequests.attemptCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(deletionRequests.id, id))
      .returning()

    return updated
  }

  async markSucceeded(id: string, auditMetadata: JsonObject = {}) {
    const [updated] = await this.db
      .update(deletionRequests)
      .set({
        status: 'succeeded',
        completedAt: new Date(),
        lastErrorCode: null,
        auditMetadata,
        updatedAt: new Date(),
      })
      .where(eq(deletionRequests.id, id))
      .returning()

    return updated
  }

  async markFailed(
    id: string,
    errorCode: string,
    auditMetadata: JsonObject = {},
  ) {
    const [updated] = await this.db
      .update(deletionRequests)
      .set({
        status: 'failed',
        completedAt: new Date(),
        lastErrorCode: errorCode,
        auditMetadata,
        updatedAt: new Date(),
      })
      .where(eq(deletionRequests.id, id))
      .returning()

    return updated
  }

  async getByIdForUser(userId: string, id: string) {
    const [request] = await this.db
      .select()
      .from(deletionRequests)
      .where(
        and(eq(deletionRequests.id, id), eq(deletionRequests.userId, userId)),
      )
      .limit(1)

    return request
  }

  async listRecentForUser(userId: string, limit = 20) {
    return this.db
      .select()
      .from(deletionRequests)
      .where(eq(deletionRequests.userId, userId))
      .orderBy(desc(deletionRequests.createdAt))
      .limit(limit)
  }

  private async createRequest(input: {
    id: string
    userId: string
    connectionId: string | null
    scope: 'user' | 'connection'
    idempotencyKey: string
    requestedBy?: string
    auditMetadata?: JsonObject
  }) {
    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(deletionRequests)
        .values({
          id: input.id,
          userId: input.userId,
          connectionId: input.connectionId,
          scope: input.scope,
          status: 'queued',
          idempotencyKey: input.idempotencyKey,
          requestedBy: input.requestedBy ?? 'owner',
          auditMetadata: input.auditMetadata ?? {},
        })
        .onConflictDoNothing({
          target: deletionRequests.idempotencyKey,
        })
        .returning()

      if (created !== undefined) {
        return created
      }

      const [existing] = await tx
        .select()
        .from(deletionRequests)
        .where(eq(deletionRequests.idempotencyKey, input.idempotencyKey))
        .limit(1)

      if (existing === undefined) {
        throw new Error('Deletion request idempotency lookup failed')
      }

      if (
        existing.userId !== input.userId ||
        existing.connectionId !== input.connectionId ||
        existing.scope !== input.scope
      ) {
        throw new Error('Deletion request idempotency key conflict')
      }

      return existing
    })
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
    analysisInputs: new AnalysisInputRepository(db),
    analysisSnapshots: new AnalysisSnapshotRepository(db),
    analysisJobs: new AnalysisJobRepository(db),
    metrics: new MetricRepository(db),
    recommendations: new RecommendationRepository(db),
    exports: new ExportRepository(db),
    taskExecutions: new TaskExecutionRepository(db),
    syncJobs: new SyncJobRepository(db),
    deletionRequests: new DeletionRequestRepository(db),
  }
}
