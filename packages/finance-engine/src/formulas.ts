export type FormulaDefinition = {
  version: string
  description: string
}

export const formulaDefinitions = {
  netWorth: {
    version: 'net-worth/v1',
    description: 'Total asset balances minus total liability balances.',
  },
  liquidCash: {
    version: 'liquid-cash/v1',
    description:
      'Checking, savings, and cash balances; excludes brokerage and retirement balances.',
  },
  cashFlow: {
    version: 'cash-flow/v1',
    description:
      'Posted income minus posted expense outflows net of refunds; transfers and debt principal payments are excluded.',
  },
  savingsRate: {
    version: 'savings-rate/v1',
    description:
      'Free cash flow divided by income, represented in basis points; unavailable when income is zero.',
  },
  creditUtilization: {
    version: 'credit-utilization/v1',
    description:
      'Total connected credit-card balances divided by total known credit limits.',
  },
  budgetVariance: {
    version: 'budget-variance/v1',
    description:
      'Net category expense actual minus planned amount; a positive value is over budget.',
  },
  weightedApr: {
    version: 'weighted-apr/v1',
    description: 'Debt-balance-weighted APR in basis points.',
  },
  emergencyFundCoverage: {
    version: 'emergency-coverage/v1',
    description:
      'Liquid cash divided by essential monthly expenses, represented in hundredths of a month.',
  },
  debtPayoff: {
    version: 'debt-payoff/v1',
    description:
      'Monthly simple-interest simulation with minimum payments first and optional avalanche or snowball extra-payment allocation.',
  },
} as const satisfies Record<string, FormulaDefinition>
