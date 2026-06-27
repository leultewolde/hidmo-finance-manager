import type { EconomicType } from '@hidmo/finance-engine'

export interface ClassificationRule {
  id: string
  priority: number
  merchantContains?: string
  descriptionContains?: string
  accountId?: string
  direction?: 'inflow' | 'outflow'
  economicType: EconomicType
  category: string
}

export interface ClassificationInput {
  accountId: string
  amountMinor: bigint
  merchantName?: string
  description?: string
  providerCategory?: string
  existingEconomicType: EconomicType
  existingCategory: string
  userReviewed: boolean
}

export interface ClassificationDecision {
  economicType: EconomicType
  category: string
  confidenceBps: number
  source: 'user' | 'rule' | 'provider' | 'fallback'
  ruleId?: string
}

const providerCategoryMap: Record<
  string,
  { economicType: EconomicType; category: string }
> = {
  INCOME: { economicType: 'income', category: 'Income' },
  TRANSFER_IN: { economicType: 'transfer', category: 'Transfer' },
  TRANSFER_OUT: { economicType: 'transfer', category: 'Transfer' },
  LOAN_PAYMENTS: { economicType: 'debt_payment', category: 'Debt payment' },
  BANK_FEES: { economicType: 'expense', category: 'Bank fees' },
  FOOD_AND_DRINK: { economicType: 'expense', category: 'Food and dining' },
  GENERAL_MERCHANDISE: { economicType: 'expense', category: 'Shopping' },
  MEDICAL: { economicType: 'expense', category: 'Healthcare' },
  RENT_AND_UTILITIES: { economicType: 'expense', category: 'Housing' },
  TRANSPORTATION: { economicType: 'expense', category: 'Transportation' },
  ENTERTAINMENT: { economicType: 'expense', category: 'Entertainment' },
  PERSONAL_CARE: { economicType: 'expense', category: 'Personal care' },
  GOVERNMENT_AND_NON_PROFIT: {
    economicType: 'expense',
    category: 'Taxes and giving',
  },
}

function matchesRule(rule: ClassificationRule, input: ClassificationInput) {
  const merchant = input.merchantName?.toLowerCase() ?? ''
  const description = input.description?.toLowerCase() ?? ''
  const direction = input.amountMinor >= 0n ? 'inflow' : 'outflow'

  return (
    (rule.merchantContains === undefined ||
      merchant.includes(rule.merchantContains.toLowerCase())) &&
    (rule.descriptionContains === undefined ||
      description.includes(rule.descriptionContains.toLowerCase())) &&
    (rule.accountId === undefined || rule.accountId === input.accountId) &&
    (rule.direction === undefined || rule.direction === direction)
  )
}

export function classifyTransaction(
  input: ClassificationInput,
  rules: readonly ClassificationRule[],
): ClassificationDecision {
  if (input.userReviewed) {
    return {
      economicType: input.existingEconomicType,
      category: input.existingCategory,
      confidenceBps: 10_000,
      source: 'user',
    }
  }

  const matchingRule = [...rules]
    .sort((left, right) => left.priority - right.priority)
    .find((rule) => matchesRule(rule, input))
  if (matchingRule !== undefined) {
    return {
      economicType: matchingRule.economicType,
      category: matchingRule.category,
      confidenceBps: 9_000,
      source: 'rule',
      ruleId: matchingRule.id,
    }
  }

  const provider =
    input.providerCategory === undefined
      ? undefined
      : providerCategoryMap[input.providerCategory]
  if (provider !== undefined) {
    return {
      ...provider,
      confidenceBps: 7_000,
      source: 'provider',
    }
  }

  return {
    economicType: input.amountMinor >= 0n ? 'income' : 'expense',
    category: 'Uncategorized',
    confidenceBps: 2_000,
    source: 'fallback',
  }
}
