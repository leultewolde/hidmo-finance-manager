import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  type AnyPgColumn,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
}

export const currencyEnum = pgEnum('currency_code', ['USD', 'EUR'])
export const accountKindEnum = pgEnum('account_kind', [
  'checking',
  'savings',
  'cash',
  'brokerage',
  'retirement',
  'property',
  'credit_card',
  'personal_loan',
  'auto_loan',
  'student_loan',
  'mortgage',
  'line_of_credit',
])
export const accountClassEnum = pgEnum('account_class', ['asset', 'liability'])
export const balanceSourceEnum = pgEnum('balance_source', [
  'connected',
  'manual',
])
export const dataQualityEnum = pgEnum('data_quality', [
  'verified',
  'estimated',
  'stale',
])
export const connectionStatusEnum = pgEnum('connection_status', [
  'active',
  'attention_required',
  'revoked',
])
export const economicTypeEnum = pgEnum('economic_type', [
  'income',
  'expense',
  'transfer',
  'debt_payment',
  'refund',
  'adjustment',
  'unknown',
])
export const transactionStateEnum = pgEnum('transaction_state', [
  'pending',
  'posted',
])
export const transferStatusEnum = pgEnum('transfer_status', [
  'candidate',
  'accepted',
  'rejected',
])
export const liabilitySourceEnum = pgEnum('liability_source', [
  'provider',
  'manual',
  'mixed',
])
export const streamKindEnum = pgEnum('stream_kind', ['income', 'expense'])
export const recommendationStatusEnum = pgEnum('recommendation_status', [
  'active',
  'accepted',
  'dismissed',
  'expired',
])
export const taskStatusEnum = pgEnum('task_status', [
  'started',
  'completed',
  'failed',
])
export const syncJobStatusEnum = pgEnum('sync_job_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
])

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    firebaseUid: text('firebase_uid').notNull(),
    email: text('email').notNull(),
    timezone: text('timezone').notNull().default('America/New_York'),
    baseCurrency: currencyEnum('base_currency').notNull().default('USD'),
    ownerSlot: boolean('owner_slot').notNull().default(true),
    consentedAt: timestamp('consented_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('users_firebase_uid_unique').on(table.firebaseUid),
    uniqueIndex('users_owner_slot_unique').on(table.ownerSlot),
    check('users_owner_slot_true', sql`${table.ownerSlot} = true`),
  ],
)

export const institutions = pgTable(
  'institutions',
  {
    id: uuid('id').primaryKey(),
    plaidInstitutionId: text('plaid_institution_id'),
    name: text('name').notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('institutions_plaid_id_unique')
      .on(table.plaidInstitutionId)
      .where(sql`${table.plaidInstitutionId} is not null`),
  ],
)

export const connections = pgTable(
  'connections',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    institutionId: uuid('institution_id').references(() => institutions.id, {
      onDelete: 'set null',
    }),
    plaidItemId: text('plaid_item_id'),
    status: connectionStatusEnum('status').notNull().default('active'),
    encryptedAccessToken: text('encrypted_access_token'),
    wrappedDataKey: text('wrapped_data_key'),
    encryptionNonce: text('encryption_nonce'),
    encryptionTag: text('encryption_tag'),
    encryptionAlgorithm: text('encryption_algorithm'),
    kmsKeyName: text('kms_key_name'),
    transactionCursor: text('transaction_cursor'),
    consentExpiresAt: timestamp('consent_expires_at', { withTimezone: true }),
    lastSuccessfulSyncAt: timestamp('last_successful_sync_at', {
      withTimezone: true,
    }),
    errorCode: text('error_code'),
    reconnectRequiredAt: timestamp('reconnect_required_at', {
      withTimezone: true,
    }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('connections_plaid_item_unique')
      .on(table.plaidItemId)
      .where(sql`${table.plaidItemId} is not null`),
    index('connections_user_idx').on(table.userId),
    uniqueIndex('connections_user_id_unique').on(table.userId, table.id),
    check(
      'connections_token_envelope_complete',
      sql`(
        ${table.encryptedAccessToken} is null
        and ${table.wrappedDataKey} is null
        and ${table.encryptionNonce} is null
        and ${table.encryptionTag} is null
        and ${table.encryptionAlgorithm} is null
        and ${table.kmsKeyName} is null
      ) or (
        ${table.encryptedAccessToken} is not null
        and ${table.wrappedDataKey} is not null
        and ${table.encryptionNonce} is not null
        and ${table.encryptionTag} is not null
        and ${table.encryptionAlgorithm} is not null
        and ${table.kmsKeyName} is not null
      )`,
    ),
  ],
)

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id').references(() => connections.id, {
      onDelete: 'cascade',
    }),
    providerAccountId: text('provider_account_id'),
    persistentProviderAccountId: text('persistent_provider_account_id'),
    name: text('name').notNull(),
    mask: text('mask'),
    kind: accountKindEnum('kind').notNull(),
    accountClass: accountClassEnum('account_class').notNull(),
    subtype: text('subtype'),
    currentBalanceMinor: bigint('current_balance_minor', {
      mode: 'bigint',
    }).notNull(),
    availableBalanceMinor: bigint('available_balance_minor', {
      mode: 'bigint',
    }),
    creditLimitMinor: bigint('credit_limit_minor', { mode: 'bigint' }),
    currency: currencyEnum('currency').notNull(),
    balanceSource: balanceSourceEnum('balance_source').notNull(),
    dataQuality: dataQualityEnum('data_quality').notNull(),
    balanceAsOf: date('balance_as_of').notNull(),
    active: boolean('active').notNull().default(true),
    manual: boolean('manual').notNull().default(false),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('accounts_connection_provider_unique')
      .on(table.connectionId, table.providerAccountId)
      .where(
        sql`${table.connectionId} is not null and ${table.providerAccountId} is not null`,
      ),
    index('accounts_user_idx').on(table.userId),
    uniqueIndex('accounts_user_id_unique').on(table.userId, table.id),
    foreignKey({
      name: 'accounts_connection_owner_fk',
      columns: [table.userId, table.connectionId],
      foreignColumns: [connections.userId, connections.id],
    }).onDelete('cascade'),
    check(
      'accounts_current_balance_nonnegative',
      sql`${table.currentBalanceMinor} >= 0`,
    ),
    check(
      'accounts_available_balance_nonnegative',
      sql`${table.availableBalanceMinor} is null or ${table.availableBalanceMinor} >= 0`,
    ),
    check(
      'accounts_credit_limit_nonnegative',
      sql`${table.creditLimitMinor} is null or ${table.creditLimitMinor} >= 0`,
    ),
    check(
      'accounts_manual_connection_shape',
      sql`(${table.manual} and ${table.connectionId} is null) or (not ${table.manual} and ${table.connectionId} is not null)`,
    ),
  ],
)

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    providerTransactionId: text('provider_transaction_id'),
    pendingProviderTransactionId: text('pending_provider_transaction_id'),
    authorizedDate: date('authorized_date'),
    postedDate: date('posted_date').notNull(),
    rawProviderAmountMinor: bigint('raw_provider_amount_minor', {
      mode: 'bigint',
    }),
    normalizedAmountMinor: bigint('normalized_amount_minor', {
      mode: 'bigint',
    }).notNull(),
    currency: currencyEnum('currency').notNull(),
    merchantName: text('merchant_name'),
    originalDescription: text('original_description'),
    state: transactionStateEnum('state').notNull(),
    removed: boolean('removed').notNull().default(false),
    providerCategory: text('provider_category'),
    providerCategoryConfidenceBps: integer('provider_category_confidence_bps'),
    economicType: economicTypeEnum('economic_type').notNull(),
    appCategory: text('app_category').notNull(),
    classificationConfidenceBps: integer('classification_confidence_bps'),
    userReviewed: boolean('user_reviewed').notNull().default(false),
    deduplicationFingerprint: text('deduplication_fingerprint').notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('transactions_account_provider_unique')
      .on(table.accountId, table.providerTransactionId)
      .where(sql`${table.providerTransactionId} is not null`),
    uniqueIndex('transactions_user_fingerprint_unique').on(
      table.userId,
      table.deduplicationFingerprint,
    ),
    index('transactions_user_posted_idx').on(table.userId, table.postedDate),
    uniqueIndex('transactions_user_id_unique').on(table.userId, table.id),
    foreignKey({
      name: 'transactions_account_owner_fk',
      columns: [table.userId, table.accountId],
      foreignColumns: [accounts.userId, accounts.id],
    }).onDelete('cascade'),
    check(
      'transactions_provider_confidence_range',
      sql`${table.providerCategoryConfidenceBps} is null or (${table.providerCategoryConfidenceBps} between 0 and 10000)`,
    ),
    check(
      'transactions_classification_confidence_range',
      sql`${table.classificationConfidenceBps} is null or (${table.classificationConfidenceBps} between 0 and 10000)`,
    ),
  ],
)

export const transactionSplits = pgTable(
  'transaction_splits',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    economicType: economicTypeEnum('economic_type').notNull(),
    category: text('category').notNull(),
    linkedLiabilityId: uuid('linked_liability_id').references(
      (): AnyPgColumn => liabilities.id,
      { onDelete: 'set null' },
    ),
    ...timestamps,
  },
  (table) => [
    index('transaction_splits_transaction_idx').on(table.transactionId),
    foreignKey({
      name: 'transaction_splits_transaction_owner_fk',
      columns: [table.userId, table.transactionId],
      foreignColumns: [transactions.userId, transactions.id],
    }).onDelete('cascade'),
  ],
)

export const transferMatches = pgTable(
  'transfer_matches',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    transactionOutId: uuid('transaction_out_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    transactionInId: uuid('transaction_in_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    scoreBps: integer('score_bps').notNull(),
    status: transferStatusEnum('status').notNull(),
    method: text('method').notNull(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('transfer_matches_out_accepted_unique')
      .on(table.transactionOutId)
      .where(sql`${table.status} = 'accepted'`),
    uniqueIndex('transfer_matches_in_accepted_unique')
      .on(table.transactionInId)
      .where(sql`${table.status} = 'accepted'`),
    check(
      'transfer_matches_distinct_transactions',
      sql`${table.transactionOutId} <> ${table.transactionInId}`,
    ),
    check(
      'transfer_matches_score_range',
      sql`${table.scoreBps} between 0 and 10000`,
    ),
    foreignKey({
      name: 'transfer_matches_out_owner_fk',
      columns: [table.userId, table.transactionOutId],
      foreignColumns: [transactions.userId, transactions.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'transfer_matches_in_owner_fk',
      columns: [table.userId, table.transactionInId],
      foreignColumns: [transactions.userId, transactions.id],
    }).onDelete('cascade'),
  ],
)

export const liabilities = pgTable(
  'liabilities',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    kind: accountKindEnum('kind').notNull(),
    principalBalanceMinor: bigint('principal_balance_minor', {
      mode: 'bigint',
    }).notNull(),
    aprBps: integer('apr_bps'),
    minimumPaymentMinor: bigint('minimum_payment_minor', { mode: 'bigint' }),
    nextDueDate: date('next_due_date'),
    originalPrincipalMinor: bigint('original_principal_minor', {
      mode: 'bigint',
    }),
    termMonths: integer('term_months'),
    maturityDate: date('maturity_date'),
    source: liabilitySourceEnum('source').notNull(),
    fieldProvenance: jsonb('field_provenance').notNull().default({}),
    sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('liabilities_account_unique').on(table.accountId),
    check(
      'liabilities_principal_nonnegative',
      sql`${table.principalBalanceMinor} >= 0`,
    ),
    check(
      'liabilities_apr_nonnegative',
      sql`${table.aprBps} is null or ${table.aprBps} >= 0`,
    ),
    check(
      'liabilities_minimum_nonnegative',
      sql`${table.minimumPaymentMinor} is null or ${table.minimumPaymentMinor} >= 0`,
    ),
    foreignKey({
      name: 'liabilities_account_owner_fk',
      columns: [table.userId, table.accountId],
      foreignColumns: [accounts.userId, accounts.id],
    }).onDelete('cascade'),
  ],
)

export const budgets = pgTable(
  'budgets',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    currency: currencyEnum('currency').notNull(),
    rolloverEnabled: boolean('rollover_enabled').notNull().default(false),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('budgets_user_period_unique').on(
      table.userId,
      table.periodStart,
      table.periodEnd,
    ),
    check(
      'budgets_period_order',
      sql`${table.periodStart} <= ${table.periodEnd}`,
    ),
    uniqueIndex('budgets_user_id_unique').on(table.userId, table.id),
  ],
)

export const budgetLines = pgTable(
  'budget_lines',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    budgetId: uuid('budget_id')
      .notNull()
      .references(() => budgets.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    plannedMinor: bigint('planned_minor', { mode: 'bigint' }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('budget_lines_budget_category_unique').on(
      table.budgetId,
      table.category,
    ),
    check('budget_lines_planned_nonnegative', sql`${table.plannedMinor} >= 0`),
    foreignKey({
      name: 'budget_lines_budget_owner_fk',
      columns: [table.userId, table.budgetId],
      foreignColumns: [budgets.userId, budgets.id],
    }).onDelete('cascade'),
  ],
)

export const recurringStreams = pgTable(
  'recurring_streams',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: streamKindEnum('kind').notNull(),
    merchantName: text('merchant_name'),
    descriptionPattern: text('description_pattern'),
    cadence: text('cadence').notNull(),
    averageAmountMinor: bigint('average_amount_minor', {
      mode: 'bigint',
    }).notNull(),
    currency: currencyEnum('currency').notNull(),
    nextExpectedDate: date('next_expected_date'),
    active: boolean('active').notNull().default(true),
    confidenceBps: integer('confidence_bps').notNull(),
    ...timestamps,
  },
  (table) => [
    check(
      'recurring_streams_confidence_range',
      sql`${table.confidenceBps} between 0 and 10000`,
    ),
  ],
)

export const goals = pgTable(
  'goals',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    name: text('name').notNull(),
    targetAmountMinor: bigint('target_amount_minor', { mode: 'bigint' }),
    currency: currencyEnum('currency').notNull(),
    targetDate: date('target_date'),
    priority: integer('priority').notNull(),
    contributionRule: jsonb('contribution_rule').notNull().default({}),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (table) => [
    check(
      'goals_target_nonnegative',
      sql`${table.targetAmountMinor} is null or ${table.targetAmountMinor} >= 0`,
    ),
  ],
)

export const classificationRules = pgTable(
  'classification_rules',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    matchConditions: jsonb('match_conditions').notNull(),
    economicType: economicTypeEnum('economic_type').notNull(),
    category: text('category').notNull(),
    priority: integer('priority').notNull(),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (table) => [
    index('classification_rules_user_priority_idx').on(
      table.userId,
      table.priority,
    ),
  ],
)

export const metricSnapshots = pgTable(
  'metric_snapshots',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    metricKey: text('metric_key').notNull(),
    periodStart: date('period_start'),
    periodEnd: date('period_end'),
    value: jsonb('value').notNull(),
    formulaVersion: text('formula_version').notNull(),
    inputCompletenessBps: integer('input_completeness_bps').notNull(),
    calculatedAt: timestamp('calculated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestamps,
  },
  (table) => [
    index('metric_snapshots_user_metric_idx').on(
      table.userId,
      table.metricKey,
      table.calculatedAt,
    ),
    check(
      'metric_snapshots_completeness_range',
      sql`${table.inputCompletenessBps} between 0 and 10000`,
    ),
  ],
)

export const recommendations = pgTable(
  'recommendations',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    status: recommendationStatusEnum('status').notNull().default('active'),
    priority: integer('priority').notNull(),
    evidence: jsonb('evidence').notNull(),
    assumptions: jsonb('assumptions').notNull(),
    estimatedMonthlyImpactMinor: bigint('estimated_monthly_impact_minor', {
      mode: 'bigint',
    }),
    currency: currencyEnum('currency').notNull(),
    confidenceBps: integer('confidence_bps').notNull(),
    narrative: text('narrative'),
    modelMetadata: jsonb('model_metadata'),
    ...timestamps,
  },
  (table) => [
    check(
      'recommendations_confidence_range',
      sql`${table.confidenceBps} between 0 and 10000`,
    ),
  ],
)

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('audit_events_user_created_idx').on(table.userId, table.createdAt),
  ],
)

export const taskExecutions = pgTable(
  'task_executions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    idempotencyKey: text('idempotency_key').notNull(),
    operation: text('operation').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    status: taskStatusEnum('status').notNull(),
    attemptCount: integer('attempt_count').notNull().default(1),
    lastErrorCode: text('last_error_code'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('task_executions_idempotency_unique').on(table.idempotencyKey),
    check('task_executions_attempt_positive', sql`${table.attemptCount} > 0`),
  ],
)

export const syncJobs = pgTable(
  'sync_jobs',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => connections.id, { onDelete: 'cascade' }),
    operation: text('operation').notNull(),
    trigger: text('trigger').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    cloudTaskName: text('cloud_task_name'),
    status: syncJobStatusEnum('status').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    lastErrorCode: text('last_error_code'),
    result: jsonb('result').notNull().default({}),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('sync_jobs_idempotency_unique').on(table.idempotencyKey),
    index('sync_jobs_user_created_idx').on(table.userId, table.createdAt),
    index('sync_jobs_connection_created_idx').on(
      table.connectionId,
      table.createdAt,
    ),
    foreignKey({
      name: 'sync_jobs_connection_owner_fk',
      columns: [table.userId, table.connectionId],
      foreignColumns: [connections.userId, connections.id],
    }).onDelete('cascade'),
  ],
)

export type UserRow = typeof users.$inferSelect
export type AccountRow = typeof accounts.$inferSelect
export type TransactionRow = typeof transactions.$inferSelect
export type LiabilityRow = typeof liabilities.$inferSelect
export type SyncJobRow = typeof syncJobs.$inferSelect
