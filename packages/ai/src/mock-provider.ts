import type { FinancialAnalysisNarrative } from '@hidmo/finance-engine'

import { buildFinancialAnalysisNarrativePrompt } from './prompts.js'
import { validateFinancialAnalysisNarrative } from './schema.js'
import type {
  AnalysisNarrativeRequest,
  AnalysisNarrativeResult,
  FinancialAnalysisAiProvider,
} from './types.js'

const disclaimer =
  'This is planning assistance based on your app data, not financial, legal, tax, or investment advice.'

function dollars(minor: bigint, currency: string): string {
  const sign = minor < 0n ? '-' : ''
  const absolute = minor < 0n ? -minor : minor
  const whole = absolute / 100n
  const cents = absolute % 100n
  return `${sign}${currency} ${whole.toString()}.${cents.toString().padStart(2, '0')}`
}

function hasRisk(request: AnalysisNarrativeRequest, code: string): boolean {
  return request.summary.riskIndicators.some((risk) => risk.code === code)
}

function buildActions(
  request: AnalysisNarrativeRequest,
): FinancialAnalysisNarrative['recommendedActions'] {
  const summary = request.summary
  const actions: FinancialAnalysisNarrative['recommendedActions'] = []

  if (hasRisk(request, 'negative-free-cash-flow')) {
    actions.push({
      priority: 'high',
      title: 'Close the monthly cash-flow gap',
      rationale:
        'Expenses exceeded income in this period, so the first priority is reducing flexible spending or increasing income before adding new savings goals.',
    })
  }

  if (summary.debt.highInterestDebtMinor > 0n) {
    actions.push({
      priority: 'high',
      title: 'Prioritize high-interest debt',
      rationale:
        'High-interest debt is present. After minimum payments and essential expenses, direct available surplus toward the highest APR balance first.',
    })
  }

  if (hasRisk(request, 'low-emergency-fund')) {
    actions.push({
      priority: 'medium',
      title: 'Build emergency cash coverage',
      rationale:
        'Liquid cash appears below the three-month coverage target, so route part of monthly surplus into emergency savings before discretionary upgrades.',
    })
  }

  if (summary.budgetBaseline.savingsCapacityAfterMinimumDebtMinor > 0n) {
    actions.push({
      priority: actions.length === 0 ? 'high' : 'medium',
      title: 'Assign available monthly surplus',
      rationale: `The deterministic summary shows ${dollars(
        summary.budgetBaseline.savingsCapacityAfterMinimumDebtMinor,
        summary.currency,
      )} after minimum debt payments. Give those dollars a job across emergency savings, debt payoff, or future planned expenses.`,
    })
  }

  if (actions.length === 0) {
    actions.push({
      priority: 'medium',
      title: 'Review unbudgeted categories',
      rationale:
        'No urgent risk indicator was detected, so the next practical step is tightening budget categories and confirming the data coverage notes.',
    })
  }

  return actions.slice(0, 5)
}

export function createMockFinancialAnalysisProvider(
  configuration: {
    model?: string
  } = {},
): FinancialAnalysisAiProvider {
  const model = configuration.model ?? 'mock-financial-analysis-v1'

  return {
    async generateNarrative(
      request: AnalysisNarrativeRequest,
    ): Promise<AnalysisNarrativeResult> {
      const prompt = buildFinancialAnalysisNarrativePrompt(request)
      const summary = request.summary
      const freeCashFlow = summary.cashFlow.freeCashFlowMinor
      const currentStanding =
        freeCashFlow >= 0n
          ? `You had positive free cash flow of ${dollars(
              freeCashFlow,
              summary.currency,
            )} for ${summary.period.label ?? `${summary.period.startDate} through ${summary.period.endDate}`}.`
          : `You had negative free cash flow of ${dollars(
              freeCashFlow,
              summary.currency,
            )} for ${summary.period.label ?? `${summary.period.startDate} through ${summary.period.endDate}`}.`

      const narrative = validateFinancialAnalysisNarrative({
        currentStanding,
        budgetSummary: `Income was ${dollars(
          summary.cashFlow.incomeMinor,
          summary.currency,
        )}; net expenses were ${dollars(
          summary.cashFlow.netExpensesMinor,
          summary.currency,
        )}; minimum debt payments total ${dollars(
          summary.debt.minimumPaymentsMinor,
          summary.currency,
        )}.`,
        recommendedActions: buildActions(request),
        caveats: summary.coverage.coverageNotes
          .slice(0, 5)
          .map((note) => note.message),
        disclaimer,
      })

      return {
        narrative,
        metadata: {
          provider: 'mock',
          model,
          promptVersion: prompt.promptVersion,
          outputSchemaVersion: prompt.outputSchemaVersion,
          inputBytes: prompt.payloadBytes,
          outputBytes: Buffer.byteLength(JSON.stringify(narrative), 'utf8'),
        },
      }
    },
  }
}
