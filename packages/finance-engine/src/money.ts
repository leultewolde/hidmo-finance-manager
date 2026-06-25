import type { CurrencyCode } from './domain.js'

export type Money = {
  amountMinor: bigint
  currency: CurrencyCode
}

export function money(
  amountMinor: bigint,
  currency: CurrencyCode = 'USD',
): Money {
  return { amountMinor, currency }
}

export function assertSameCurrency(
  values: readonly { currency: CurrencyCode }[],
): CurrencyCode {
  const currency = values[0]?.currency ?? 'USD'

  for (const value of values) {
    if (value.currency !== currency) {
      throw new Error(
        `Currency mismatch: expected ${currency}, received ${value.currency}`,
      )
    }
  }

  return currency
}

export function addMoney(values: readonly Money[]): Money {
  const currency = assertSameCurrency(values)
  return money(
    values.reduce((total, value) => total + value.amountMinor, 0n),
    currency,
  )
}

export function subtractMoney(left: Money, right: Money): Money {
  assertSameCurrency([left, right])
  return money(left.amountMinor - right.amountMinor, left.currency)
}

export function absoluteMinor(amountMinor: bigint): bigint {
  return amountMinor < 0n ? -amountMinor : amountMinor
}

export function divideRounded(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new Error('Denominator must be positive')
  }

  const negative = numerator < 0n
  const magnitude = negative ? -numerator : numerator
  const quotient = magnitude / denominator
  const remainder = magnitude % denominator
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient

  return negative ? -rounded : rounded
}

export function ratioBps(
  numerator: bigint,
  denominator: bigint,
): number | null {
  if (denominator === 0n) {
    return null
  }
  if (denominator < 0n) {
    throw new Error('Ratio denominator must not be negative')
  }

  return Number(divideRounded(numerator * 10_000n, denominator))
}

export function assertNonNegativeMinor(
  amountMinor: bigint,
  fieldName: string,
): void {
  if (amountMinor < 0n) {
    throw new Error(`${fieldName} must not be negative`)
  }
}
