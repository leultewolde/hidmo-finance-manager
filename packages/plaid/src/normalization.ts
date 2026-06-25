import type {
  AccountClass,
  AccountKind,
  CurrencyCode,
} from '@hidmo/finance-engine'

import type { PlaidAccount } from './adapter.js'

export interface NormalizedPlaidAccount {
  providerAccountId: string
  persistentProviderAccountId?: string
  name: string
  mask?: string
  kind: AccountKind
  accountClass: AccountClass
  subtype?: string
  currentBalanceMinor: bigint
  availableBalanceMinor?: bigint
  creditLimitMinor?: bigint
  currency: CurrencyCode
  balanceAsOf: string
}

function toMinorUnits(value: number): bigint {
  if (!Number.isFinite(value)) {
    throw new Error('Plaid balance must be finite')
  }
  return BigInt(Math.round(Math.abs(value) * 100))
}

function mapKind(type: string, subtype?: string): AccountKind {
  if (type === 'depository') {
    if (subtype === 'checking') return 'checking'
    if (subtype === 'savings') return 'savings'
    return 'cash'
  }
  if (type === 'credit') return 'credit_card'
  if (type === 'investment') {
    return subtype?.includes('401') ||
      subtype?.includes('ira') ||
      subtype === 'retirement'
      ? 'retirement'
      : 'brokerage'
  }
  if (type === 'loan') {
    if (subtype === 'auto') return 'auto_loan'
    if (subtype === 'student') return 'student_loan'
    if (subtype === 'mortgage') return 'mortgage'
    if (subtype === 'line of credit') return 'line_of_credit'
    return 'personal_loan'
  }
  throw new Error(`Unsupported Plaid account type: ${type}`)
}

export function normalizePlaidAccount(
  account: PlaidAccount,
  now = new Date(),
): NormalizedPlaidAccount {
  if (account.currency !== 'USD' && account.currency !== 'EUR') {
    throw new Error(`Unsupported account currency: ${account.currency}`)
  }

  const kind = mapKind(account.type, account.subtype)
  const accountClass: AccountClass =
    kind === 'credit_card' ||
    kind === 'personal_loan' ||
    kind === 'auto_loan' ||
    kind === 'student_loan' ||
    kind === 'mortgage' ||
    kind === 'line_of_credit'
      ? 'liability'
      : 'asset'

  return {
    providerAccountId: account.providerAccountId,
    ...(account.persistentProviderAccountId === undefined
      ? {}
      : { persistentProviderAccountId: account.persistentProviderAccountId }),
    name: account.name,
    ...(account.mask === undefined ? {} : { mask: account.mask }),
    kind,
    accountClass,
    ...(account.subtype === undefined ? {} : { subtype: account.subtype }),
    currentBalanceMinor: toMinorUnits(account.currentBalance),
    ...(account.availableBalance === undefined
      ? {}
      : { availableBalanceMinor: toMinorUnits(account.availableBalance) }),
    ...(account.creditLimit === undefined
      ? {}
      : { creditLimitMinor: toMinorUnits(account.creditLimit) }),
    currency: account.currency,
    balanceAsOf: (account.balanceAsOf === undefined
      ? now
      : new Date(account.balanceAsOf)
    )
      .toISOString()
      .slice(0, 10),
  }
}
