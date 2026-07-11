import { createHash } from 'node:crypto'

export const financeExportSchemaVersion = 1

export type FinanceExportDatasetName =
  | 'accounts'
  | 'account_balances'
  | 'transactions'
  | 'transaction_splits'
  | 'classification_rules'
  | 'manual_loans'
  | 'budgets'
  | 'analysis_snapshots'
  | 'recommendations'
  | 'connections'

export type CsvScalar = string | number | boolean | bigint | Date | null

export type CsvRow = Record<string, CsvScalar | undefined>

export type CsvColumn = {
  key: string
  header: string
}

export type CsvDataset<Row extends CsvRow = CsvRow> = {
  name: FinanceExportDatasetName
  fileName: `${FinanceExportDatasetName}.csv`
  columns: readonly CsvColumn[]
  rows: readonly Row[]
}

export type GeneratedExportFile = {
  path: string
  contentType: 'application/json' | 'text/csv'
  content: string
}

export type ExportManifestDataset = {
  name: FinanceExportDatasetName
  fileName: `${FinanceExportDatasetName}.csv`
  rowCount: number
  byteLength: number
  sha256: string
}

export type FinanceExportManifest = {
  schemaVersion: typeof financeExportSchemaVersion
  generatedAt: string
  appVersion: string
  datasets: readonly ExportManifestDataset[]
}

export type FinanceExportBundle = {
  manifest: FinanceExportManifest
  files: readonly GeneratedExportFile[]
}

export type ExportAccountRow = {
  id: string
  connectionId: string | null
  name: string
  kind: string
  accountClass: string
  subtype: string | null
  currency: string
  balanceSource: string
  dataQuality: string
  active: boolean
  manual: boolean
  createdAt: string
  updatedAt: string
}

export type ExportAccountBalanceRow = {
  accountId: string
  currentBalanceMinor: bigint
  availableBalanceMinor: bigint | null
  creditLimitMinor: bigint | null
  currency: string
  balanceAsOf: string
}

export type ExportTransactionRow = {
  id: string
  accountId: string
  authorizedDate: string | null
  postedDate: string
  normalizedAmountMinor: bigint
  currency: string
  merchantName: string | null
  originalDescription: string | null
  state: string
  removed: boolean
  economicType: string
  appCategory: string
  classificationConfidenceBps: number | null
  userReviewed: boolean
  createdAt: string
  updatedAt: string
}

export type ExportTransactionSplitRow = {
  id: string
  transactionId: string
  amountMinor: bigint
  economicType: string
  category: string
  linkedLiabilityId: string | null
  createdAt: string
  updatedAt: string
}

export type ExportClassificationRuleRow = {
  id: string
  matchConditionsJson: string
  economicType: string
  category: string
  priority: number
  active: boolean
  createdAt: string
  updatedAt: string
}

export type ExportManualLoanRow = {
  id: string
  accountId: string
  kind: string
  principalBalanceMinor: bigint
  aprBps: number | null
  minimumPaymentMinor: bigint | null
  nextDueDate: string | null
  originalPrincipalMinor: bigint | null
  termMonths: number | null
  maturityDate: string | null
  source: string
  sourceUpdatedAt: string | null
  createdAt: string
  updatedAt: string
}

export type ExportBudgetRow = {
  id: string
  periodStart: string
  periodEnd: string
  currency: string
  rolloverEnabled: boolean
  category: string
  plannedMinor: bigint
  createdAt: string
  updatedAt: string
}

export type ExportAnalysisSnapshotRow = {
  id: string
  periodStart: string
  periodEnd: string
  status: string
  inputHash: string
  formulaVersion: string
  promptVersion: string | null
  modelProvider: string | null
  modelName: string | null
  createdAt: string
  updatedAt: string
}

export type ExportRecommendationRow = {
  id: string
  candidateId: string
  periodStart: string
  periodEnd: string
  formulaVersion: string
  policyVersion: string
  type: string
  status: string
  priority: string
  rank: number | null
  title: string
  rationale: string
  evidenceIdsJson: string
  assumptionsJson: string
  estimatedMonthlyImpactMinor: bigint | null
  currency: string
  confidenceBps: number
  modelProvider: string | null
  modelName: string | null
  promptVersion: string | null
  createdAt: string
  updatedAt: string
}

export type ExportConnectionRow = {
  id: string
  institutionName: string | null
  status: string
  consentExpiresAt: string | null
  lastSuccessfulSyncAt: string | null
  errorCode: string | null
  reconnectRequiredAt: string | null
  createdAt: string
  updatedAt: string
}

export type FinanceExportData = {
  accounts: readonly ExportAccountRow[]
  accountBalances: readonly ExportAccountBalanceRow[]
  transactions: readonly ExportTransactionRow[]
  transactionSplits: readonly ExportTransactionSplitRow[]
  classificationRules: readonly ExportClassificationRuleRow[]
  manualLoans: readonly ExportManualLoanRow[]
  budgets: readonly ExportBudgetRow[]
  analysisSnapshots: readonly ExportAnalysisSnapshotRow[]
  recommendations: readonly ExportRecommendationRow[]
  connections: readonly ExportConnectionRow[]
}

export type FinanceExportDataset =
  | CsvDataset<ExportAccountRow>
  | CsvDataset<ExportAccountBalanceRow>
  | CsvDataset<ExportTransactionRow>
  | CsvDataset<ExportTransactionSplitRow>
  | CsvDataset<ExportClassificationRuleRow>
  | CsvDataset<ExportManualLoanRow>
  | CsvDataset<ExportBudgetRow>
  | CsvDataset<ExportAnalysisSnapshotRow>
  | CsvDataset<ExportRecommendationRow>
  | CsvDataset<ExportConnectionRow>

export type FinanceExportInput = {
  generatedAt: Date
  appVersion: string
  data: FinanceExportData
}

const blockedKeyPatterns = [
  /access.*token/i,
  /public.*token/i,
  /link.*token/i,
  /encrypted.*token/i,
  /wrapped.*key/i,
  /data.*key/i,
  /kms.*key/i,
  /nonce/i,
  /encryption.*tag/i,
  /plaid.*item/i,
  /provider.*account.*id/i,
  /provider.*transaction.*id/i,
  /pending.*provider.*transaction.*id/i,
  /persistent.*provider.*account.*id/i,
  /^mask$/i,
  /account.*mask/i,
] as const

function assertSafeColumnName(key: string) {
  if (blockedKeyPatterns.some((pattern) => pattern.test(key))) {
    throw new Error(`Unsafe export column is not allowed: ${key}`)
  }
}

function assertSafeDataset<Row extends CsvRow>(dataset: CsvDataset<Row>) {
  for (const column of dataset.columns) {
    assertSafeColumnName(column.key)
    assertSafeColumnName(column.header)
  }

  for (const row of dataset.rows) {
    for (const key of Object.keys(row)) {
      assertSafeColumnName(key)
    }
  }
}

function csvValue(value: CsvScalar | undefined): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

function escapeCsvCell(value: CsvScalar | undefined): string {
  const text = csvValue(value)
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`
  }
  return text
}

export function writeCsv(dataset: FinanceExportDataset): string
export function writeCsv<Row extends CsvRow>(dataset: CsvDataset<Row>): string
export function writeCsv<Row extends CsvRow>(dataset: CsvDataset<Row>): string {
  assertSafeDataset(dataset)

  const header = dataset.columns.map((column) => column.header).join(',')
  const rows = dataset.rows.map((row) =>
    dataset.columns.map((column) => escapeCsvCell(row[column.key])).join(','),
  )
  return `${[header, ...rows].join('\n')}\n`
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

function fileByteLength(content: string): number {
  return Buffer.byteLength(content, 'utf8')
}

function dataset<Row extends CsvRow>(
  name: FinanceExportDatasetName,
  columns: readonly CsvColumn[],
  rows: readonly Row[],
): CsvDataset<Row> {
  return {
    name,
    fileName: `${name}.csv`,
    columns,
    rows,
  }
}

export function buildFinanceExportDatasets(
  data: FinanceExportData,
): readonly FinanceExportDataset[] {
  return [
    dataset<ExportAccountRow>(
      'accounts',
      [
        { key: 'id', header: 'id' },
        { key: 'connectionId', header: 'connection_id' },
        { key: 'name', header: 'name' },
        { key: 'kind', header: 'kind' },
        { key: 'accountClass', header: 'account_class' },
        { key: 'subtype', header: 'subtype' },
        { key: 'currency', header: 'currency' },
        { key: 'balanceSource', header: 'balance_source' },
        { key: 'dataQuality', header: 'data_quality' },
        { key: 'active', header: 'active' },
        { key: 'manual', header: 'manual' },
        { key: 'createdAt', header: 'created_at' },
        { key: 'updatedAt', header: 'updated_at' },
      ],
      data.accounts,
    ),
    dataset<ExportAccountBalanceRow>(
      'account_balances',
      [
        { key: 'accountId', header: 'account_id' },
        { key: 'currentBalanceMinor', header: 'current_balance_minor' },
        { key: 'availableBalanceMinor', header: 'available_balance_minor' },
        { key: 'creditLimitMinor', header: 'credit_limit_minor' },
        { key: 'currency', header: 'currency' },
        { key: 'balanceAsOf', header: 'balance_as_of' },
      ],
      data.accountBalances,
    ),
    dataset<ExportTransactionRow>(
      'transactions',
      [
        { key: 'id', header: 'id' },
        { key: 'accountId', header: 'account_id' },
        { key: 'authorizedDate', header: 'authorized_date' },
        { key: 'postedDate', header: 'posted_date' },
        { key: 'normalizedAmountMinor', header: 'normalized_amount_minor' },
        { key: 'currency', header: 'currency' },
        { key: 'merchantName', header: 'merchant_name' },
        { key: 'originalDescription', header: 'original_description' },
        { key: 'state', header: 'state' },
        { key: 'removed', header: 'removed' },
        { key: 'economicType', header: 'economic_type' },
        { key: 'appCategory', header: 'app_category' },
        {
          key: 'classificationConfidenceBps',
          header: 'classification_confidence_bps',
        },
        { key: 'userReviewed', header: 'user_reviewed' },
        { key: 'createdAt', header: 'created_at' },
        { key: 'updatedAt', header: 'updated_at' },
      ],
      data.transactions,
    ),
    dataset<ExportTransactionSplitRow>(
      'transaction_splits',
      [
        { key: 'id', header: 'id' },
        { key: 'transactionId', header: 'transaction_id' },
        { key: 'amountMinor', header: 'amount_minor' },
        { key: 'economicType', header: 'economic_type' },
        { key: 'category', header: 'category' },
        { key: 'linkedLiabilityId', header: 'linked_liability_id' },
        { key: 'createdAt', header: 'created_at' },
        { key: 'updatedAt', header: 'updated_at' },
      ],
      data.transactionSplits,
    ),
    dataset<ExportClassificationRuleRow>(
      'classification_rules',
      [
        { key: 'id', header: 'id' },
        { key: 'matchConditionsJson', header: 'match_conditions_json' },
        { key: 'economicType', header: 'economic_type' },
        { key: 'category', header: 'category' },
        { key: 'priority', header: 'priority' },
        { key: 'active', header: 'active' },
        { key: 'createdAt', header: 'created_at' },
        { key: 'updatedAt', header: 'updated_at' },
      ],
      data.classificationRules,
    ),
    dataset<ExportManualLoanRow>(
      'manual_loans',
      [
        { key: 'id', header: 'id' },
        { key: 'accountId', header: 'account_id' },
        { key: 'kind', header: 'kind' },
        { key: 'principalBalanceMinor', header: 'principal_balance_minor' },
        { key: 'aprBps', header: 'apr_bps' },
        { key: 'minimumPaymentMinor', header: 'minimum_payment_minor' },
        { key: 'nextDueDate', header: 'next_due_date' },
        { key: 'originalPrincipalMinor', header: 'original_principal_minor' },
        { key: 'termMonths', header: 'term_months' },
        { key: 'maturityDate', header: 'maturity_date' },
        { key: 'source', header: 'source' },
        { key: 'sourceUpdatedAt', header: 'source_updated_at' },
        { key: 'createdAt', header: 'created_at' },
        { key: 'updatedAt', header: 'updated_at' },
      ],
      data.manualLoans,
    ),
    dataset<ExportBudgetRow>(
      'budgets',
      [
        { key: 'id', header: 'id' },
        { key: 'periodStart', header: 'period_start' },
        { key: 'periodEnd', header: 'period_end' },
        { key: 'currency', header: 'currency' },
        { key: 'rolloverEnabled', header: 'rollover_enabled' },
        { key: 'category', header: 'category' },
        { key: 'plannedMinor', header: 'planned_minor' },
        { key: 'createdAt', header: 'created_at' },
        { key: 'updatedAt', header: 'updated_at' },
      ],
      data.budgets,
    ),
    dataset<ExportAnalysisSnapshotRow>(
      'analysis_snapshots',
      [
        { key: 'id', header: 'id' },
        { key: 'periodStart', header: 'period_start' },
        { key: 'periodEnd', header: 'period_end' },
        { key: 'status', header: 'status' },
        { key: 'inputHash', header: 'input_hash' },
        { key: 'formulaVersion', header: 'formula_version' },
        { key: 'promptVersion', header: 'prompt_version' },
        { key: 'modelProvider', header: 'model_provider' },
        { key: 'modelName', header: 'model_name' },
        { key: 'createdAt', header: 'created_at' },
        { key: 'updatedAt', header: 'updated_at' },
      ],
      data.analysisSnapshots,
    ),
    dataset<ExportRecommendationRow>(
      'recommendations',
      [
        { key: 'id', header: 'id' },
        { key: 'candidateId', header: 'candidate_id' },
        { key: 'periodStart', header: 'period_start' },
        { key: 'periodEnd', header: 'period_end' },
        { key: 'formulaVersion', header: 'formula_version' },
        { key: 'policyVersion', header: 'policy_version' },
        { key: 'type', header: 'type' },
        { key: 'status', header: 'status' },
        { key: 'priority', header: 'priority' },
        { key: 'rank', header: 'rank' },
        { key: 'title', header: 'title' },
        { key: 'rationale', header: 'rationale' },
        { key: 'evidenceIdsJson', header: 'evidence_ids_json' },
        { key: 'assumptionsJson', header: 'assumptions_json' },
        {
          key: 'estimatedMonthlyImpactMinor',
          header: 'estimated_monthly_impact_minor',
        },
        { key: 'currency', header: 'currency' },
        { key: 'confidenceBps', header: 'confidence_bps' },
        { key: 'modelProvider', header: 'model_provider' },
        { key: 'modelName', header: 'model_name' },
        { key: 'promptVersion', header: 'prompt_version' },
        { key: 'createdAt', header: 'created_at' },
        { key: 'updatedAt', header: 'updated_at' },
      ],
      data.recommendations,
    ),
    dataset<ExportConnectionRow>(
      'connections',
      [
        { key: 'id', header: 'id' },
        { key: 'institutionName', header: 'institution_name' },
        { key: 'status', header: 'status' },
        { key: 'consentExpiresAt', header: 'consent_expires_at' },
        { key: 'lastSuccessfulSyncAt', header: 'last_successful_sync_at' },
        { key: 'errorCode', header: 'error_code' },
        { key: 'reconnectRequiredAt', header: 'reconnect_required_at' },
        { key: 'createdAt', header: 'created_at' },
        { key: 'updatedAt', header: 'updated_at' },
      ],
      data.connections,
    ),
  ]
}

export function buildFinanceExport(
  input: FinanceExportInput,
): FinanceExportBundle {
  const csvFiles = buildFinanceExportDatasets(input.data).map(
    (exportDataset) => {
      const content = writeCsv(exportDataset)
      return {
        path: exportDataset.fileName,
        contentType: 'text/csv' as const,
        content,
        dataset: exportDataset,
      }
    },
  )

  const manifest: FinanceExportManifest = {
    schemaVersion: financeExportSchemaVersion,
    generatedAt: input.generatedAt.toISOString(),
    appVersion: input.appVersion,
    datasets: csvFiles.map((file) => ({
      name: file.dataset.name,
      fileName: file.dataset.fileName,
      rowCount: file.dataset.rows.length,
      byteLength: fileByteLength(file.content),
      sha256: sha256(file.content),
    })),
  }

  const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`

  return {
    manifest,
    files: [
      {
        path: 'manifest.json',
        contentType: 'application/json',
        content: manifestContent,
      },
      ...csvFiles.map(({ path, contentType, content }) => ({
        path,
        contentType,
        content,
      })),
    ],
  }
}
