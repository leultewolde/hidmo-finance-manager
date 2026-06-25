import type { CurrencyCode, Debt } from './domain.js'
import { formulaDefinitions } from './formulas.js'
import { assertSameCurrency, divideRounded } from './money.js'
import { assertIsoDate, validateDebt } from './validation.js'

export type PayoffStrategy = 'minimum' | 'avalanche' | 'snowball'

export type DebtPayoffOptions = {
  strategy: PayoffStrategy
  extraPaymentMinor?: bigint
  startDate: string
  maximumMonths?: number
}

export type DebtPayoffResult = {
  formulaVersion: string
  strategy: PayoffStrategy
  currency: CurrencyCode
  months: number
  payoffDate: string
  totalInterestMinor: bigint
  totalPaidMinor: bigint
  schedule: Array<{
    month: number
    date: string
    interestMinor: bigint
    paymentMinor: bigint
    endingBalanceMinor: bigint
  }>
}

type MutableDebt = Debt & {
  accruedInterestMinor: bigint
}

function addMonths(date: string, months: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`)
  const targetMonthStart = new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + months, 1),
  )
  const lastDayOfTargetMonth = new Date(
    Date.UTC(
      targetMonthStart.getUTCFullYear(),
      targetMonthStart.getUTCMonth() + 1,
      0,
    ),
  ).getUTCDate()
  targetMonthStart.setUTCDate(
    Math.min(parsed.getUTCDate(), lastDayOfTargetMonth),
  )
  return targetMonthStart.toISOString().slice(0, 10)
}

function monthlyInterest(balanceMinor: bigint, aprBps: number): bigint {
  return divideRounded(balanceMinor * BigInt(aprBps), 120_000n)
}

function selectExtraPaymentTarget(
  debts: readonly MutableDebt[],
  strategy: PayoffStrategy,
): MutableDebt | undefined {
  const active = debts.filter(
    (debt) => debt.balanceMinor + debt.accruedInterestMinor > 0n,
  )

  if (strategy === 'minimum' || active.length === 0) {
    return undefined
  }

  return [...active].sort((left, right) => {
    if (strategy === 'avalanche') {
      if (left.aprBps !== right.aprBps) {
        return right.aprBps - left.aprBps
      }
    } else {
      const leftTotal = left.balanceMinor + left.accruedInterestMinor
      const rightTotal = right.balanceMinor + right.accruedInterestMinor
      if (leftTotal !== rightTotal) {
        return leftTotal < rightTotal ? -1 : 1
      }
    }

    return left.id.localeCompare(right.id)
  })[0]
}

function applyPayment(debt: MutableDebt, availableMinor: bigint): bigint {
  const owed = debt.balanceMinor + debt.accruedInterestMinor
  const payment = availableMinor > owed ? owed : availableMinor
  const interestPaid =
    payment > debt.accruedInterestMinor ? debt.accruedInterestMinor : payment
  debt.accruedInterestMinor -= interestPaid
  debt.balanceMinor -= payment - interestPaid
  return payment
}

export function simulateDebtPayoff(
  debts: readonly Debt[],
  options: DebtPayoffOptions,
): DebtPayoffResult {
  if (debts.length === 0) {
    throw new Error('At least one debt is required')
  }
  assertIsoDate(options.startDate, 'options.startDate')
  const currency = assertSameCurrency(debts)
  const extraPaymentMinor = options.extraPaymentMinor ?? 0n
  const maximumMonths = options.maximumMonths ?? 1_200

  if (extraPaymentMinor < 0n) {
    throw new Error('Extra payment must not be negative')
  }
  if (!Number.isInteger(maximumMonths) || maximumMonths <= 0) {
    throw new Error('maximumMonths must be a positive integer')
  }

  const working: MutableDebt[] = debts.map((debt) => {
    validateDebt(debt)
    return { ...debt, accruedInterestMinor: 0n }
  })
  const openingBalanceMinor = working.reduce(
    (total, debt) => total + debt.balanceMinor,
    0n,
  )
  if (openingBalanceMinor === 0n) {
    return {
      formulaVersion: formulaDefinitions.debtPayoff.version,
      strategy: options.strategy,
      currency,
      months: 0,
      payoffDate: options.startDate,
      totalInterestMinor: 0n,
      totalPaidMinor: 0n,
      schedule: [],
    }
  }

  let totalInterestMinor = 0n
  let totalPaidMinor = 0n
  const plannedMonthlyPaymentMinor = working.reduce(
    (total, debt) =>
      total + (debt.balanceMinor > 0n ? debt.minimumPaymentMinor : 0n),
    extraPaymentMinor,
  )
  const schedule: DebtPayoffResult['schedule'] = []

  for (let month = 1; month <= maximumMonths; month += 1) {
    let monthInterestMinor = 0n
    let monthPaymentMinor = 0n

    for (const debt of working) {
      if (debt.balanceMinor === 0n) {
        continue
      }
      const interest = monthlyInterest(debt.balanceMinor, debt.aprBps)
      debt.accruedInterestMinor += interest
      totalInterestMinor += interest
      monthInterestMinor += interest
    }

    for (const debt of working) {
      const owed = debt.balanceMinor + debt.accruedInterestMinor
      if (owed === 0n) {
        continue
      }
      const required =
        debt.minimumPaymentMinor > owed ? owed : debt.minimumPaymentMinor
      monthPaymentMinor += applyPayment(debt, required)
    }

    let remainingExtra =
      options.strategy === 'minimum'
        ? 0n
        : plannedMonthlyPaymentMinor - monthPaymentMinor
    while (remainingExtra > 0n) {
      const target = selectExtraPaymentTarget(working, options.strategy)
      if (target === undefined) {
        break
      }
      const applied = applyPayment(target, remainingExtra)
      remainingExtra -= applied
      monthPaymentMinor += applied
      if (applied === 0n) {
        break
      }
    }

    totalPaidMinor += monthPaymentMinor
    const endingBalanceMinor = working.reduce(
      (total, debt) => total + debt.balanceMinor + debt.accruedInterestMinor,
      0n,
    )
    schedule.push({
      month,
      date: addMonths(options.startDate, month),
      interestMinor: monthInterestMinor,
      paymentMinor: monthPaymentMinor,
      endingBalanceMinor,
    })

    if (endingBalanceMinor === 0n) {
      return {
        formulaVersion: formulaDefinitions.debtPayoff.version,
        strategy: options.strategy,
        currency,
        months: month,
        payoffDate: addMonths(options.startDate, month),
        totalInterestMinor,
        totalPaidMinor,
        schedule,
      }
    }
  }

  throw new Error(
    `Debts were not paid off within ${maximumMonths.toString()} months`,
  )
}
