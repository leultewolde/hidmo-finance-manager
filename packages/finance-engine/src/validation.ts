import type {
  Account,
  DatePeriod,
  Debt,
  Transaction,
  TransactionSplit,
} from './domain.js'
import { assertNonNegativeMinor } from './money.js'

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/

export function assertIsoDate(value: string, fieldName: string): void {
  if (!isoDatePattern.test(value)) {
    throw new Error(`${fieldName} must use YYYY-MM-DD`)
  }

  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (
    Number.isNaN(parsed.valueOf()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`${fieldName} must be a valid calendar date`)
  }
}

export function validatePeriod(period: DatePeriod): void {
  assertIsoDate(period.startDate, 'period.startDate')
  assertIsoDate(period.endDate, 'period.endDate')
  if (period.startDate > period.endDate) {
    throw new Error('period.startDate must not be after period.endDate')
  }
}

export function validateAccount(account: Account): void {
  assertNonNegativeMinor(account.balanceMinor, 'account.balanceMinor')
  assertIsoDate(account.balanceAsOf, 'account.balanceAsOf')
  if (account.creditLimitMinor !== undefined) {
    assertNonNegativeMinor(account.creditLimitMinor, 'account.creditLimitMinor')
  }
}

export function validateTransaction(transaction: Transaction): void {
  assertIsoDate(transaction.postedDate, 'transaction.postedDate')

  if (transaction.amountMinor > 0n && transaction.direction !== 'inflow') {
    throw new Error('Positive transaction amounts must have inflow direction')
  }
  if (transaction.amountMinor < 0n && transaction.direction !== 'outflow') {
    throw new Error('Negative transaction amounts must have outflow direction')
  }

  if (transaction.economicType === 'income' && transaction.amountMinor <= 0n) {
    throw new Error('Income must have a positive amount')
  }
  if (transaction.economicType === 'expense' && transaction.amountMinor >= 0n) {
    throw new Error('Expense must have a negative amount')
  }
  if (transaction.economicType === 'refund' && transaction.amountMinor <= 0n) {
    throw new Error('Refund must have a positive amount')
  }
}

export function validateSplits(
  transaction: Transaction,
  splits: readonly TransactionSplit[],
): void {
  if (splits.length === 0) {
    throw new Error('A split transaction must have at least one split')
  }

  const total = splits.reduce((sum, split) => {
    if (split.transactionId !== transaction.id) {
      throw new Error('Every split must reference its transaction')
    }
    if (split.economicType === 'income' && split.amountMinor <= 0n) {
      throw new Error('Income split must have a positive amount')
    }
    if (split.economicType === 'expense' && split.amountMinor >= 0n) {
      throw new Error('Expense split must have a negative amount')
    }
    if (split.economicType === 'refund' && split.amountMinor <= 0n) {
      throw new Error('Refund split must have a positive amount')
    }
    return sum + split.amountMinor
  }, 0n)

  if (total !== transaction.amountMinor) {
    throw new Error(
      `Transaction splits must sum to ${transaction.amountMinor.toString()}`,
    )
  }
}

export function validateDebt(debt: Debt): void {
  assertNonNegativeMinor(debt.balanceMinor, 'debt.balanceMinor')
  assertNonNegativeMinor(debt.minimumPaymentMinor, 'debt.minimumPaymentMinor')
  if (!Number.isInteger(debt.aprBps) || debt.aprBps < 0) {
    throw new Error('debt.aprBps must be a non-negative integer')
  }
}
