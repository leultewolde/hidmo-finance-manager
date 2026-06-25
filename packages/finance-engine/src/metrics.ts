import type {
  Account,
  BudgetLine,
  DatePeriod,
  Debt,
  Transaction,
  TransactionSplit,
} from './domain.js'
import { getAccountClass, isLiquidAccount } from './domain.js'
import { formulaDefinitions } from './formulas.js'
import {
  absoluteMinor,
  assertSameCurrency,
  divideRounded,
  ratioBps,
} from './money.js'
import {
  validateAccount,
  validateDebt,
  validatePeriod,
  validateSplits,
  validateTransaction,
} from './validation.js'

export type MetricResult<T> = {
  formulaVersion: string
  value: T
}

function isInPeriod(date: string, period: DatePeriod): boolean {
  return date >= period.startDate && date <= period.endDate
}

function postedTransactionsInPeriod(
  transactions: readonly Transaction[],
  period: DatePeriod,
): Transaction[] {
  validatePeriod(period)
  return transactions.filter((transaction) => {
    validateTransaction(transaction)
    return (
      transaction.state === 'posted' &&
      isInPeriod(transaction.postedDate, period)
    )
  })
}

function economicEntries(
  transactions: readonly Transaction[],
  splits: readonly TransactionSplit[],
): Array<{
  amountMinor: bigint
  economicType: Transaction['economicType']
  category: string
}> {
  const transactionsById = new Map(
    transactions.map((transaction) => [transaction.id, transaction]),
  )
  const splitsByTransaction = new Map<string, TransactionSplit[]>()

  for (const split of splits) {
    if (!transactionsById.has(split.transactionId)) {
      continue
    }
    const transactionSplits = splitsByTransaction.get(split.transactionId) ?? []
    transactionSplits.push(split)
    splitsByTransaction.set(split.transactionId, transactionSplits)
  }

  return transactions.flatMap((transaction) => {
    const transactionSplits = splitsByTransaction.get(transaction.id)
    if (transactionSplits === undefined) {
      return [
        {
          amountMinor: transaction.amountMinor,
          economicType: transaction.economicType,
          category: transaction.category,
        },
      ]
    }

    validateSplits(transaction, transactionSplits)
    return transactionSplits.map((split) => ({
      amountMinor: split.amountMinor,
      economicType: split.economicType,
      category: split.category,
    }))
  })
}

export function calculateBalanceSheet(
  accounts: readonly Account[],
): MetricResult<{
  currency: Account['currency']
  totalAssetsMinor: bigint
  totalLiabilitiesMinor: bigint
  netWorthMinor: bigint
  liquidCashMinor: bigint
}> {
  const currency = assertSameCurrency(accounts)
  let totalAssetsMinor = 0n
  let totalLiabilitiesMinor = 0n
  let liquidCashMinor = 0n

  for (const account of accounts) {
    validateAccount(account)
    if (getAccountClass(account.kind) === 'asset') {
      totalAssetsMinor += account.balanceMinor
      if (isLiquidAccount(account.kind)) {
        liquidCashMinor += account.balanceMinor
      }
    } else {
      totalLiabilitiesMinor += account.balanceMinor
    }
  }

  return {
    formulaVersion: formulaDefinitions.netWorth.version,
    value: {
      currency,
      totalAssetsMinor,
      totalLiabilitiesMinor,
      netWorthMinor: totalAssetsMinor - totalLiabilitiesMinor,
      liquidCashMinor,
    },
  }
}

export function calculateNetWorth(
  accounts: readonly Account[],
): MetricResult<bigint> {
  return {
    formulaVersion: formulaDefinitions.netWorth.version,
    value: calculateBalanceSheet(accounts).value.netWorthMinor,
  }
}

export function calculateLiquidCash(
  accounts: readonly Account[],
): MetricResult<bigint> {
  return {
    formulaVersion: formulaDefinitions.liquidCash.version,
    value: calculateBalanceSheet(accounts).value.liquidCashMinor,
  }
}

export function calculateSavingsRate(
  freeCashFlowMinor: bigint,
  incomeMinor: bigint,
): MetricResult<number | null> {
  return {
    formulaVersion: formulaDefinitions.savingsRate.version,
    value: ratioBps(freeCashFlowMinor, incomeMinor),
  }
}

export function calculateCashFlow(
  transactions: readonly Transaction[],
  period: DatePeriod,
  splits: readonly TransactionSplit[] = [],
): MetricResult<{
  currency: Transaction['currency']
  incomeMinor: bigint
  expenseOutflowsMinor: bigint
  refundsMinor: bigint
  netExpensesMinor: bigint
  freeCashFlowMinor: bigint
  savingsRateBps: number | null
}> {
  const included = postedTransactionsInPeriod(transactions, period)
  const currency = assertSameCurrency(included)
  let incomeMinor = 0n
  let expenseOutflowsMinor = 0n
  let refundsMinor = 0n

  for (const entry of economicEntries(included, splits)) {
    if (entry.economicType === 'income') {
      incomeMinor += entry.amountMinor
    } else if (entry.economicType === 'expense') {
      expenseOutflowsMinor += absoluteMinor(entry.amountMinor)
    } else if (entry.economicType === 'refund') {
      refundsMinor += entry.amountMinor
    }
  }

  const netExpensesMinor = expenseOutflowsMinor - refundsMinor
  const freeCashFlowMinor = incomeMinor - netExpensesMinor

  return {
    formulaVersion: formulaDefinitions.cashFlow.version,
    value: {
      currency,
      incomeMinor,
      expenseOutflowsMinor,
      refundsMinor,
      netExpensesMinor,
      freeCashFlowMinor,
      savingsRateBps: calculateSavingsRate(freeCashFlowMinor, incomeMinor)
        .value,
    },
  }
}

export function calculateCreditUtilization(
  accounts: readonly Account[],
): MetricResult<{
  currency: Account['currency']
  balanceMinor: bigint
  balanceWithKnownLimitMinor: bigint
  knownLimitMinor: bigint
  utilizationBps: number | null
  accountsWithoutLimit: number
}> {
  const creditCards = accounts.filter(
    (account) => account.kind === 'credit_card',
  )
  const currency = assertSameCurrency(creditCards)
  let balanceMinor = 0n
  let balanceWithKnownLimitMinor = 0n
  let knownLimitMinor = 0n
  let accountsWithoutLimit = 0

  for (const account of creditCards) {
    validateAccount(account)
    balanceMinor += account.balanceMinor
    if (account.creditLimitMinor === undefined) {
      accountsWithoutLimit += 1
    } else {
      balanceWithKnownLimitMinor += account.balanceMinor
      knownLimitMinor += account.creditLimitMinor
    }
  }

  return {
    formulaVersion: formulaDefinitions.creditUtilization.version,
    value: {
      currency,
      balanceMinor,
      balanceWithKnownLimitMinor,
      knownLimitMinor,
      utilizationBps: ratioBps(balanceWithKnownLimitMinor, knownLimitMinor),
      accountsWithoutLimit,
    },
  }
}

export function calculateBudgetVariance(
  budgetLines: readonly BudgetLine[],
  transactions: readonly Transaction[],
  period: DatePeriod,
  splits: readonly TransactionSplit[] = [],
): MetricResult<
  Array<{
    category: string
    plannedMinor: bigint
    actualMinor: bigint
    varianceMinor: bigint
    remainingMinor: bigint
  }>
> {
  const included = postedTransactionsInPeriod(transactions, period)
  assertSameCurrency(included)
  const netActualByCategory = new Map<string, bigint>()

  for (const entry of economicEntries(included, splits)) {
    const current = netActualByCategory.get(entry.category) ?? 0n
    if (entry.economicType === 'expense') {
      netActualByCategory.set(
        entry.category,
        current + absoluteMinor(entry.amountMinor),
      )
    } else if (entry.economicType === 'refund') {
      netActualByCategory.set(entry.category, current - entry.amountMinor)
    }
  }

  return {
    formulaVersion: formulaDefinitions.budgetVariance.version,
    value: budgetLines.map((line) => {
      if (line.plannedMinor < 0n) {
        throw new Error('Budget planned amount must not be negative')
      }
      const actualMinor = netActualByCategory.get(line.category) ?? 0n
      return {
        category: line.category,
        plannedMinor: line.plannedMinor,
        actualMinor,
        varianceMinor: actualMinor - line.plannedMinor,
        remainingMinor: line.plannedMinor - actualMinor,
      }
    }),
  }
}

export function calculateWeightedApr(
  debts: readonly Debt[],
): MetricResult<number | null> {
  assertSameCurrency(debts)
  let totalBalanceMinor = 0n
  let weightedApr = 0n

  for (const debt of debts) {
    validateDebt(debt)
    totalBalanceMinor += debt.balanceMinor
    weightedApr += debt.balanceMinor * BigInt(debt.aprBps)
  }

  return {
    formulaVersion: formulaDefinitions.weightedApr.version,
    value:
      totalBalanceMinor === 0n
        ? null
        : Number(divideRounded(weightedApr, totalBalanceMinor)),
  }
}

export function calculateEmergencyFundCoverage(
  liquidCashMinor: bigint,
  essentialMonthlyExpensesMinor: bigint,
): MetricResult<number | null> {
  if (liquidCashMinor < 0n || essentialMonthlyExpensesMinor < 0n) {
    throw new Error('Emergency-fund inputs must not be negative')
  }

  return {
    formulaVersion: formulaDefinitions.emergencyFundCoverage.version,
    value:
      essentialMonthlyExpensesMinor === 0n
        ? null
        : Number(
            divideRounded(
              liquidCashMinor * 100n,
              essentialMonthlyExpensesMinor,
            ),
          ),
  }
}

export function applyPrincipalPayment(
  cashBalanceMinor: bigint,
  debtBalanceMinor: bigint,
  principalPaymentMinor: bigint,
): {
  cashBalanceMinor: bigint
  debtBalanceMinor: bigint
  netWorthBeforeMinor: bigint
  netWorthAfterMinor: bigint
} {
  if (
    cashBalanceMinor < 0n ||
    debtBalanceMinor < 0n ||
    principalPaymentMinor < 0n
  ) {
    throw new Error('Principal-payment inputs must not be negative')
  }

  const applied =
    principalPaymentMinor > debtBalanceMinor
      ? debtBalanceMinor
      : principalPaymentMinor
  if (applied > cashBalanceMinor) {
    throw new Error('Principal payment exceeds available cash')
  }

  const netWorthBeforeMinor = cashBalanceMinor - debtBalanceMinor
  const nextCash = cashBalanceMinor - applied
  const nextDebt = debtBalanceMinor - applied

  return {
    cashBalanceMinor: nextCash,
    debtBalanceMinor: nextDebt,
    netWorthBeforeMinor,
    netWorthAfterMinor: nextCash - nextDebt,
  }
}

export function assertTransactionSplits(
  transaction: Transaction,
  splits: readonly TransactionSplit[],
): void {
  validateSplits(transaction, splits)
}
