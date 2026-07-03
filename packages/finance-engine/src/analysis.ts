import type {
  Account,
  BudgetLine,
  CurrencyCode,
  DatePeriod,
  Debt,
  EconomicType,
  Transaction,
  TransactionSplit,
} from './domain.js'
import { formulaDefinitions } from './formulas.js'
import { absoluteMinor, assertSameCurrency } from './money.js'
import {
  calculateBalanceSheet,
  calculateBudgetVariance,
  calculateCashFlow,
  calculateCreditUtilization,
  calculateEmergencyFundCoverage,
  calculateWeightedApr,
  type MetricResult,
} from './metrics.js'
import {
  validatePeriod,
  validateSplits,
  validateTransaction,
} from './validation.js'

export type AnalysisPeriod = DatePeriod & {
  label?: string
}

export type AnalysisInput = {
  period: AnalysisPeriod
  accounts: readonly Account[]
  debts: readonly Debt[]
  transactions: readonly Transaction[]
  splits?: readonly TransactionSplit[]
  budgetLines?: readonly BudgetLine[]
  essentialCategoryPrefixes?: readonly string[]
  reviewedTransactionsOnly?: boolean
  generatedAt?: string
}

export type AnalysisCoverageNoteSeverity = 'info' | 'warning'

export type AnalysisCoverageNote = {
  code:
    | 'reviewed-transactions-only'
    | 'unreviewed-transactions-excluded'
    | 'pending-transactions-excluded'
    | 'unknown-transactions-present'
    | 'estimated-balances-present'
    | 'manual-balances-present'
    | 'investment-balances-included'
    | 'budget-lines-missing'
  severity: AnalysisCoverageNoteSeverity
  message: string
}

export type AnalysisRiskIndicator = {
  code:
    | 'negative-free-cash-flow'
    | 'low-emergency-fund'
    | 'high-credit-utilization'
    | 'high-interest-debt'
    | 'unreviewed-data'
  severity: 'info' | 'warning' | 'critical'
  message: string
}

export type SpendingCategorySummary = {
  category: string
  outflowMinor: bigint
  refundMinor: bigint
  netExpenseMinor: bigint
  transactionCount: number
}

export type IncomeSummary = {
  incomeMinor: bigint
  transactionCount: number
  sourceCount: number
}

export type DebtSummary = {
  totalDebtMinor: bigint
  minimumPaymentsMinor: bigint
  weightedAprBps: number | null
  highInterestDebtMinor: bigint
  creditUtilizationBps: number | null
  accountsWithoutCreditLimit: number
}

export type BudgetBaseline = {
  essentialExpensesMinor: bigint
  discretionaryExpensesMinor: bigint
  debtMinimumsMinor: bigint
  savingsCapacityAfterMinimumDebtMinor: bigint
  budgetVariance: Array<{
    category: string
    plannedMinor: bigint
    actualMinor: bigint
    varianceMinor: bigint
    remainingMinor: bigint
  }>
}

export type DeterministicFinancialSummary = {
  period: AnalysisPeriod
  currency: CurrencyCode
  balanceSheet: {
    totalAssetsMinor: bigint
    totalLiabilitiesMinor: bigint
    netWorthMinor: bigint
    liquidCashMinor: bigint
  }
  cashFlow: {
    incomeMinor: bigint
    expenseOutflowsMinor: bigint
    refundsMinor: bigint
    netExpensesMinor: bigint
    freeCashFlowMinor: bigint
    savingsRateBps: number | null
  }
  income: IncomeSummary
  spendingByCategory: SpendingCategorySummary[]
  debt: DebtSummary
  emergencyFundCoverageMonthsHundredths: number | null
  budgetBaseline: BudgetBaseline
  coverage: {
    accountsIncluded: number
    debtsIncluded: number
    transactionsAvailable: number
    transactionsIncluded: number
    splitsIncluded: number
    coverageNotes: AnalysisCoverageNote[]
  }
  riskIndicators: AnalysisRiskIndicator[]
}

export type FinancialAnalysisNarrative = {
  currentStanding: string
  budgetSummary: string
  recommendedActions: Array<{
    priority: 'high' | 'medium' | 'low'
    title: string
    rationale: string
  }>
  caveats: string[]
  disclaimer: string
}

export type AnalysisSnapshotStatus = 'draft' | 'complete' | 'failed'
export type AnalysisJobStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export type AnalysisSnapshot = {
  id: string
  userId: string
  period: AnalysisPeriod
  inputHash: string
  formulaVersion: string
  status: AnalysisSnapshotStatus
  deterministicSummary: DeterministicFinancialSummary
  narrative?: FinancialAnalysisNarrative
  createdAt: string
  completedAt?: string
}

export type AnalysisJob = {
  id: string
  userId: string
  snapshotId?: string
  period: AnalysisPeriod
  inputHash: string
  status: AnalysisJobStatus
  lastErrorCode?: string
  createdAt: string
  startedAt?: string
  completedAt?: string
}

const defaultEssentialCategoryPrefixes = [
  'housing',
  'utilities',
  'food:groceries',
  'insurance',
  'medical',
  'transportation',
  'childcare',
] as const

const highInterestDebtAprBps = 1_500
const highCreditUtilizationBps = 3_000
const lowEmergencyFundCoverageMonthsHundredths = 300

function isInPeriod(date: string, period: DatePeriod): boolean {
  return date >= period.startDate && date <= period.endDate
}

function categoryMatchesPrefix(category: string, prefixes: readonly string[]) {
  return prefixes.some(
    (prefix) => category === prefix || category.startsWith(`${prefix}:`),
  )
}

function includedTransactions(input: AnalysisInput): Transaction[] {
  validatePeriod(input.period)
  return input.transactions.filter((transaction) => {
    validateTransaction(transaction)
    if (transaction.state !== 'posted') return false
    if (!isInPeriod(transaction.postedDate, input.period)) return false
    if (input.reviewedTransactionsOnly !== false && !transaction.reviewed) {
      return false
    }
    return true
  })
}

function economicEntries(
  transactions: readonly Transaction[],
  splits: readonly TransactionSplit[],
): Array<{
  transactionId: string
  amountMinor: bigint
  economicType: EconomicType
  category: string
}> {
  const transactionsById = new Map(
    transactions.map((transaction) => [transaction.id, transaction]),
  )
  const splitsByTransaction = new Map<string, TransactionSplit[]>()

  for (const split of splits) {
    if (!transactionsById.has(split.transactionId)) continue
    const transactionSplits = splitsByTransaction.get(split.transactionId) ?? []
    transactionSplits.push(split)
    splitsByTransaction.set(split.transactionId, transactionSplits)
  }

  return transactions.flatMap((transaction) => {
    const transactionSplits = splitsByTransaction.get(transaction.id)
    if (transactionSplits === undefined) {
      return [
        {
          transactionId: transaction.id,
          amountMinor: transaction.amountMinor,
          economicType: transaction.economicType,
          category: transaction.category,
        },
      ]
    }

    validateSplits(transaction, transactionSplits)
    return transactionSplits.map((split) => ({
      transactionId: transaction.id,
      amountMinor: split.amountMinor,
      economicType: split.economicType,
      category: split.category,
    }))
  })
}

function summarizeSpendingByCategory(
  transactions: readonly Transaction[],
  splits: readonly TransactionSplit[],
): SpendingCategorySummary[] {
  const summaries = new Map<string, SpendingCategorySummary>()

  for (const entry of economicEntries(transactions, splits)) {
    if (entry.economicType !== 'expense' && entry.economicType !== 'refund') {
      continue
    }

    const current = summaries.get(entry.category) ?? {
      category: entry.category,
      outflowMinor: 0n,
      refundMinor: 0n,
      netExpenseMinor: 0n,
      transactionCount: 0,
    }

    if (entry.economicType === 'expense') {
      current.outflowMinor += absoluteMinor(entry.amountMinor)
      current.netExpenseMinor += absoluteMinor(entry.amountMinor)
    } else {
      current.refundMinor += entry.amountMinor
      current.netExpenseMinor -= entry.amountMinor
    }
    current.transactionCount += 1
    summaries.set(entry.category, current)
  }

  return [...summaries.values()].sort((left, right) => {
    if (left.netExpenseMinor === right.netExpenseMinor) {
      return left.category.localeCompare(right.category)
    }
    return left.netExpenseMinor > right.netExpenseMinor ? -1 : 1
  })
}

function summarizeIncome(transactions: readonly Transaction[]): IncomeSummary {
  const incomeTransactions = transactions.filter(
    (transaction) => transaction.economicType === 'income',
  )
  return {
    incomeMinor: incomeTransactions.reduce(
      (total, transaction) => total + transaction.amountMinor,
      0n,
    ),
    transactionCount: incomeTransactions.length,
    sourceCount: new Set(
      incomeTransactions.map((transaction) => transaction.category),
    ).size,
  }
}

function coverageNotes(input: {
  source: AnalysisInput
  included: readonly Transaction[]
}): AnalysisCoverageNote[] {
  const notes: AnalysisCoverageNote[] = []
  const postedInPeriod = input.source.transactions.filter(
    (transaction) =>
      transaction.state === 'posted' &&
      isInPeriod(transaction.postedDate, input.source.period),
  )
  const pendingInPeriod = input.source.transactions.filter(
    (transaction) =>
      transaction.state === 'pending' &&
      isInPeriod(transaction.postedDate, input.source.period),
  )

  if (input.source.reviewedTransactionsOnly !== false) {
    notes.push({
      code: 'reviewed-transactions-only',
      severity: 'info',
      message:
        'The summary uses reviewed posted transactions by default so uncertain classifications do not drive recommendations.',
    })
  }
  if (
    input.source.reviewedTransactionsOnly !== false &&
    postedInPeriod.some((transaction) => !transaction.reviewed)
  ) {
    notes.push({
      code: 'unreviewed-transactions-excluded',
      severity: 'warning',
      message:
        'Some posted transactions in the period are unreviewed and may be excluded from summary totals.',
    })
  }
  if (pendingInPeriod.length > 0) {
    notes.push({
      code: 'pending-transactions-excluded',
      severity: 'info',
      message:
        'Pending transactions are excluded until they post and can be synchronized reliably.',
    })
  }
  if (
    input.included.some((transaction) => transaction.economicType === 'unknown')
  ) {
    notes.push({
      code: 'unknown-transactions-present',
      severity: 'warning',
      message:
        'Some included transactions still have unknown economic type and may not affect income or expense totals.',
    })
  }
  if (
    input.source.accounts.some((account) => account.dataQuality === 'estimated')
  ) {
    notes.push({
      code: 'estimated-balances-present',
      severity: 'warning',
      message:
        'Some account balances are estimated, so net worth and emergency coverage may move after verification.',
    })
  }
  if (
    input.source.accounts.some((account) => account.balanceSource === 'manual')
  ) {
    notes.push({
      code: 'manual-balances-present',
      severity: 'info',
      message:
        'Manual balances are included and should be kept current for reliable recommendations.',
    })
  }
  if (
    input.source.accounts.some(
      (account) =>
        account.kind === 'brokerage' || account.kind === 'retirement',
    )
  ) {
    notes.push({
      code: 'investment-balances-included',
      severity: 'info',
      message:
        'Investment account balances are included in net worth; investment transactions are outside the current analysis scope.',
    })
  }
  if ((input.source.budgetLines ?? []).length === 0) {
    notes.push({
      code: 'budget-lines-missing',
      severity: 'info',
      message:
        'No explicit budget lines were provided, so the budget baseline is based on observed spending.',
    })
  }

  return notes
}

function summarizeRisks(input: {
  freeCashFlowMinor: bigint
  emergencyCoverage: number | null
  creditUtilizationBps: number | null
  highInterestDebtMinor: bigint
  hasUnreviewedTransactions: boolean
}): AnalysisRiskIndicator[] {
  const risks: AnalysisRiskIndicator[] = []

  if (input.freeCashFlowMinor < 0n) {
    risks.push({
      code: 'negative-free-cash-flow',
      severity: 'critical',
      message: 'Expenses exceeded income during the analysis period.',
    })
  }
  if (
    input.emergencyCoverage !== null &&
    input.emergencyCoverage < lowEmergencyFundCoverageMonthsHundredths
  ) {
    risks.push({
      code: 'low-emergency-fund',
      severity: 'warning',
      message:
        'Liquid cash covers less than three months of essential expenses.',
    })
  }
  if (
    input.creditUtilizationBps !== null &&
    input.creditUtilizationBps >= highCreditUtilizationBps
  ) {
    risks.push({
      code: 'high-credit-utilization',
      severity: 'warning',
      message:
        'Credit-card utilization is high enough to pressure flexibility.',
    })
  }
  if (input.highInterestDebtMinor > 0n) {
    risks.push({
      code: 'high-interest-debt',
      severity: 'warning',
      message: 'High-interest debt is present and should be prioritized.',
    })
  }
  if (input.hasUnreviewedTransactions) {
    risks.push({
      code: 'unreviewed-data',
      severity: 'info',
      message: 'Unreviewed transactions may change the final recommendation.',
    })
  }

  return risks
}

export function buildFinancialAnalysisSummary(
  input: AnalysisInput,
): MetricResult<DeterministicFinancialSummary> {
  const splits = input.splits ?? []
  const budgetLines = input.budgetLines ?? []
  const essentialCategoryPrefixes =
    input.essentialCategoryPrefixes ?? defaultEssentialCategoryPrefixes
  const transactions = includedTransactions(input)
  const currency = assertSameCurrency([
    ...input.accounts,
    ...input.debts,
    ...transactions,
  ])

  const balanceSheet = calculateBalanceSheet(input.accounts).value
  const cashFlow = calculateCashFlow(transactions, input.period, splits).value
  const spendingByCategory = summarizeSpendingByCategory(transactions, splits)
  const income = summarizeIncome(transactions)
  const creditUtilization = calculateCreditUtilization(input.accounts).value
  const weightedAprBps = calculateWeightedApr(input.debts).value
  const minimumPaymentsMinor = input.debts.reduce(
    (total, debt) => total + debt.minimumPaymentMinor,
    0n,
  )
  const highInterestDebtMinor = input.debts
    .filter((debt) => debt.aprBps >= highInterestDebtAprBps)
    .reduce((total, debt) => total + debt.balanceMinor, 0n)
  const essentialExpensesMinor = spendingByCategory
    .filter((summary) =>
      categoryMatchesPrefix(summary.category, essentialCategoryPrefixes),
    )
    .reduce((total, summary) => total + summary.netExpenseMinor, 0n)
  const emergencyFundCoverage = calculateEmergencyFundCoverage(
    balanceSheet.liquidCashMinor,
    essentialExpensesMinor,
  ).value
  const budgetVariance =
    budgetLines.length === 0
      ? []
      : calculateBudgetVariance(budgetLines, transactions, input.period, splits)
          .value
  const unreviewedTransactionsPresent = input.transactions.some(
    (transaction) =>
      transaction.state === 'posted' &&
      isInPeriod(transaction.postedDate, input.period) &&
      !transaction.reviewed,
  )

  const summary: DeterministicFinancialSummary = {
    period: input.period,
    currency,
    balanceSheet,
    cashFlow,
    income,
    spendingByCategory,
    debt: {
      totalDebtMinor: input.debts.reduce(
        (total, debt) => total + debt.balanceMinor,
        0n,
      ),
      minimumPaymentsMinor,
      weightedAprBps,
      highInterestDebtMinor,
      creditUtilizationBps: creditUtilization.utilizationBps,
      accountsWithoutCreditLimit: creditUtilization.accountsWithoutLimit,
    },
    emergencyFundCoverageMonthsHundredths: emergencyFundCoverage,
    budgetBaseline: {
      essentialExpensesMinor,
      discretionaryExpensesMinor:
        cashFlow.netExpensesMinor - essentialExpensesMinor,
      debtMinimumsMinor: minimumPaymentsMinor,
      savingsCapacityAfterMinimumDebtMinor:
        cashFlow.freeCashFlowMinor - minimumPaymentsMinor,
      budgetVariance,
    },
    coverage: {
      accountsIncluded: input.accounts.length,
      debtsIncluded: input.debts.length,
      transactionsAvailable: input.transactions.length,
      transactionsIncluded: transactions.length,
      splitsIncluded: splits.length,
      coverageNotes: coverageNotes({
        source: input,
        included: transactions,
      }),
    },
    riskIndicators: summarizeRisks({
      freeCashFlowMinor: cashFlow.freeCashFlowMinor,
      emergencyCoverage: emergencyFundCoverage,
      creditUtilizationBps: creditUtilization.utilizationBps,
      highInterestDebtMinor,
      hasUnreviewedTransactions: unreviewedTransactionsPresent,
    }),
  }

  return {
    formulaVersion: formulaDefinitions.financialAnalysisSummary.version,
    value: summary,
  }
}
