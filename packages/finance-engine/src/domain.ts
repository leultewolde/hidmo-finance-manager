export type CurrencyCode = 'USD' | 'EUR'

export type AccountKind =
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

export type AccountClass = 'asset' | 'liability'
export type BalanceSource = 'connected' | 'manual'
export type DataQuality = 'verified' | 'estimated' | 'stale'

export type Account = {
  id: string
  name: string
  kind: AccountKind
  balanceMinor: bigint
  currency: CurrencyCode
  creditLimitMinor?: bigint
  balanceAsOf: string
  balanceSource: BalanceSource
  dataQuality: DataQuality
}

export type TransactionDirection = 'inflow' | 'outflow'

export type EconomicType =
  | 'income'
  | 'expense'
  | 'transfer'
  | 'debt_payment'
  | 'refund'
  | 'adjustment'
  | 'unknown'

export type TransactionState = 'pending' | 'posted'

export type Transaction = {
  id: string
  accountId: string
  postedDate: string
  amountMinor: bigint
  currency: CurrencyCode
  direction: TransactionDirection
  economicType: EconomicType
  category: string
  state: TransactionState
  reviewed: boolean
}

export type TransactionSplit = {
  id: string
  transactionId: string
  amountMinor: bigint
  economicType: EconomicType
  category: string
}

export type BudgetLine = {
  category: string
  plannedMinor: bigint
}

export type Debt = {
  id: string
  name: string
  kind: Extract<
    AccountKind,
    | 'credit_card'
    | 'personal_loan'
    | 'auto_loan'
    | 'student_loan'
    | 'mortgage'
    | 'line_of_credit'
  >
  balanceMinor: bigint
  aprBps: number
  minimumPaymentMinor: bigint
  currency: CurrencyCode
}

export type DatePeriod = {
  startDate: string
  endDate: string
}

const accountKindMetadata: Record<
  AccountKind,
  { accountClass: AccountClass; liquid: boolean }
> = {
  checking: { accountClass: 'asset', liquid: true },
  savings: { accountClass: 'asset', liquid: true },
  cash: { accountClass: 'asset', liquid: true },
  brokerage: { accountClass: 'asset', liquid: false },
  retirement: { accountClass: 'asset', liquid: false },
  property: { accountClass: 'asset', liquid: false },
  credit_card: { accountClass: 'liability', liquid: false },
  personal_loan: { accountClass: 'liability', liquid: false },
  auto_loan: { accountClass: 'liability', liquid: false },
  student_loan: { accountClass: 'liability', liquid: false },
  mortgage: { accountClass: 'liability', liquid: false },
  line_of_credit: { accountClass: 'liability', liquid: false },
}

export function getAccountClass(kind: AccountKind): AccountClass {
  return accountKindMetadata[kind].accountClass
}

export function isLiquidAccount(kind: AccountKind): boolean {
  return accountKindMetadata[kind].liquid
}

export function isLiabilityAccount(kind: AccountKind): boolean {
  return getAccountClass(kind) === 'liability'
}
