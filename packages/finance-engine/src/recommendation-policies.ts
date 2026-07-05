import type {
  AnalysisCoverageNote,
  AnalysisRiskIndicator,
  DeterministicFinancialSummary,
} from './analysis.js'
import type { CurrencyCode, DatePeriod } from './domain.js'
import {
  createRecommendationCandidateId,
  createRecommendationEvidenceId,
  validateRecommendationCandidate,
  type RecommendationCandidate,
  type RecommendationCandidateType,
  type RecommendationEvidenceId,
  type RecommendationEvidenceReference,
  type RecommendationPriority,
} from './recommendations.js'

export type RecommendationPolicyEngineOptions = {
  emergencyFundTargetMonthsHundredths?: number
  highInterestAprBps?: number
  highCreditUtilizationBps?: number
  maxCategoryRecommendations?: number
}

export type RecommendationPolicyResult = {
  evidence: RecommendationEvidenceReference[]
  candidates: RecommendationCandidate[]
}

export const recommendationPolicyVersion = 'recommendation-policies/v1' as const

const defaultPolicyOptions = {
  emergencyFundTargetMonthsHundredths: 300,
  highInterestAprBps: 1_500,
  highCreditUtilizationBps: 3_000,
  maxCategoryRecommendations: 3,
} satisfies Required<RecommendationPolicyEngineOptions>

const currentPeriodSlug = 'current-period'

function policyOptions(
  options: RecommendationPolicyEngineOptions = {},
): Required<RecommendationPolicyEngineOptions> {
  return {
    ...defaultPolicyOptions,
    ...options,
    maxCategoryRecommendations: Math.max(
      0,
      Math.trunc(
        options.maxCategoryRecommendations ??
          defaultPolicyOptions.maxCategoryRecommendations,
      ),
    ),
  }
}

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 100)

  return slug.length > 0 ? slug : currentPeriodSlug
}

function amountSeverity(
  amountMinor: bigint,
  highThresholdMinor: bigint,
): 'info' | 'warning' | 'critical' {
  return amountMinor >= highThresholdMinor ? 'critical' : 'warning'
}

function riskSeverity(
  severity: AnalysisRiskIndicator['severity'],
): 'info' | 'warning' | 'critical' {
  return severity
}

function coverageSeverity(
  severity: AnalysisCoverageNote['severity'],
): 'info' | 'warning' {
  return severity
}

function confidenceFor(
  summary: DeterministicFinancialSummary,
  baseConfidenceBps: number,
) {
  const dataQualityPenalty =
    summary.coverage.coverageNotes.some(
      (note) => note.severity === 'warning',
    ) || summary.riskIndicators.some((risk) => risk.code === 'unreviewed-data')
      ? 1_000
      : 0

  return Math.max(5_000, baseConfidenceBps - dataQualityPenalty)
}

function sortedRiskIndicators(summary: DeterministicFinancialSummary) {
  return [...summary.riskIndicators].sort((left, right) =>
    left.code.localeCompare(right.code),
  )
}

function sortedCoverageNotes(summary: DeterministicFinancialSummary) {
  return [...summary.coverage.coverageNotes].sort((left, right) =>
    left.code.localeCompare(right.code),
  )
}

class EvidenceBuilder {
  readonly #references = new Map<
    RecommendationEvidenceId,
    RecommendationEvidenceReference
  >()

  add(reference: RecommendationEvidenceReference): RecommendationEvidenceId {
    if (!this.#references.has(reference.id)) {
      this.#references.set(reference.id, reference)
    }
    return reference.id
  }

  metric(
    slug: string,
    label: string,
    input: {
      period: DatePeriod
      currency?: CurrencyCode
      amountMinor?: bigint
      percentageBps?: number
      severity?: 'info' | 'warning' | 'critical'
    },
  ) {
    const reference: RecommendationEvidenceReference = {
      id: createRecommendationEvidenceId('metric', slug),
      kind: 'metric',
      label,
      period: input.period,
    }
    if (input.currency !== undefined) reference.currency = input.currency
    if (input.amountMinor !== undefined) {
      reference.amountMinor = input.amountMinor
    }
    if (input.percentageBps !== undefined) {
      reference.percentageBps = input.percentageBps
    }
    if (input.severity !== undefined) reference.severity = input.severity
    return this.add(reference)
  }

  risk(risk: AnalysisRiskIndicator) {
    return this.add({
      id: createRecommendationEvidenceId('risk_indicator', slugify(risk.code)),
      kind: 'risk_indicator',
      label: risk.message,
      severity: riskSeverity(risk.severity),
    })
  }

  coverage(note: AnalysisCoverageNote) {
    return this.add({
      id: createRecommendationEvidenceId('coverage_note', slugify(note.code)),
      kind: 'coverage_note',
      label: note.message,
      severity: coverageSeverity(note.severity),
    })
  }

  categorySpending(
    category: string,
    input: {
      period: DatePeriod
      currency: CurrencyCode
      amountMinor: bigint
    },
  ) {
    return this.add({
      id: createRecommendationEvidenceId(
        'category_spending',
        slugify(category),
      ),
      kind: 'category_spending',
      label: `Net spending in ${category}`,
      period: input.period,
      currency: input.currency,
      amountMinor: input.amountMinor,
    })
  }

  budgetVariance(
    category: string,
    input: {
      period: DatePeriod
      currency: CurrencyCode
      amountMinor: bigint
      severity: 'info' | 'warning' | 'critical'
    },
  ) {
    return this.add({
      id: createRecommendationEvidenceId('budget_variance', slugify(category)),
      kind: 'budget_variance',
      label: `Budget overspend in ${category}`,
      period: input.period,
      currency: input.currency,
      amountMinor: input.amountMinor,
      severity: input.severity,
    })
  }

  dataQuality(summary: DeterministicFinancialSummary) {
    const reference: RecommendationEvidenceReference = {
      id: createRecommendationEvidenceId('data_quality', currentPeriodSlug),
      kind: 'data_quality',
      label: 'Analysis data quality checks',
      period: summary.period,
      severity: summary.coverage.coverageNotes.some(
        (note) => note.severity === 'warning',
      )
        ? 'warning'
        : 'info',
    }
    if (summary.coverage.transactionsAvailable > 0) {
      reference.percentageBps = Math.round(
        (summary.coverage.transactionsIncluded * 10_000) /
          summary.coverage.transactionsAvailable,
      )
    }
    return this.add(reference)
  }

  toArray() {
    return [...this.#references.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    )
  }
}

function riskEvidenceId(
  evidence: EvidenceBuilder,
  summary: DeterministicFinancialSummary,
  code: AnalysisRiskIndicator['code'],
) {
  const risk = sortedRiskIndicators(summary).find(
    (entry) => entry.code === code,
  )
  return risk === undefined ? [] : [evidence.risk(risk)]
}

function createCandidate(input: {
  type: RecommendationCandidateType
  title: string
  rationale: string
  priority: RecommendationPriority
  evidenceIds: RecommendationEvidenceId[]
  assumptions: string[]
  estimatedMonthlyImpactMinor?: bigint | undefined
  currency: CurrencyCode
  confidenceBps: number
  slug?: string
}): RecommendationCandidate {
  const candidate: RecommendationCandidate = {
    id: createRecommendationCandidateId(
      input.type,
      input.slug ?? currentPeriodSlug,
    ),
    type: input.type,
    title: input.title,
    rationale: input.rationale,
    priority: input.priority,
    status: 'candidate',
    evidenceIds: [...new Set(input.evidenceIds)].sort(),
    assumptions: input.assumptions,
    currency: input.currency,
    confidenceBps: input.confidenceBps,
  }
  if (input.estimatedMonthlyImpactMinor !== undefined) {
    candidate.estimatedMonthlyImpactMinor = input.estimatedMonthlyImpactMinor
  }
  return candidate
}

function positiveOrUndefined(amountMinor: bigint) {
  return amountMinor > 0n ? amountMinor : undefined
}

function buildCashFlowCandidate(
  summary: DeterministicFinancialSummary,
  evidence: EvidenceBuilder,
) {
  if (summary.cashFlow.freeCashFlowMinor >= 0n) return undefined

  const freeCashFlowEvidenceId = evidence.metric(
    'free-cash-flow',
    'Free cash flow',
    {
      period: summary.period,
      currency: summary.currency,
      amountMinor: summary.cashFlow.freeCashFlowMinor,
      severity: 'critical',
    },
  )

  return createCandidate({
    type: 'negative_free_cash_flow',
    title: 'Close the monthly cash-flow gap',
    rationale:
      'Expenses and debt minimums are currently outrunning income for the analysis period.',
    priority: 'high',
    evidenceIds: [
      freeCashFlowEvidenceId,
      ...riskEvidenceId(evidence, summary, 'negative-free-cash-flow'),
    ],
    assumptions: [
      'Uses posted transactions included in the deterministic analysis period.',
      'Treats the current-period gap as the minimum monthly improvement target.',
    ],
    estimatedMonthlyImpactMinor: -summary.cashFlow.freeCashFlowMinor,
    currency: summary.currency,
    confidenceBps: confidenceFor(summary, 9_000),
  })
}

function buildEmergencyFundCandidate(
  summary: DeterministicFinancialSummary,
  evidence: EvidenceBuilder,
  options: Required<RecommendationPolicyEngineOptions>,
) {
  const coverage = summary.emergencyFundCoverageMonthsHundredths
  if (
    coverage === null ||
    coverage >= options.emergencyFundTargetMonthsHundredths
  ) {
    return undefined
  }

  const coverageEvidenceId = evidence.metric(
    'emergency-fund-coverage',
    'Emergency fund coverage',
    {
      period: summary.period,
      percentageBps: coverage,
      severity: coverage < 100 ? 'critical' : 'warning',
    },
  )

  return createCandidate({
    type: 'low_emergency_fund',
    title: 'Build emergency cash before adding flexible spending',
    rationale:
      'Liquid cash does not yet cover the target number of months of essential expenses.',
    priority: coverage < 100 ? 'high' : 'medium',
    evidenceIds: [
      coverageEvidenceId,
      ...riskEvidenceId(evidence, summary, 'low-emergency-fund'),
    ],
    assumptions: [
      'Emergency coverage uses liquid cash divided by essential monthly expenses.',
      `Target coverage is ${(options.emergencyFundTargetMonthsHundredths / 100).toFixed(2)} months.`,
    ],
    estimatedMonthlyImpactMinor: positiveOrUndefined(
      summary.budgetBaseline.savingsCapacityAfterMinimumDebtMinor,
    ),
    currency: summary.currency,
    confidenceBps: confidenceFor(summary, 8_500),
  })
}

function buildHighInterestDebtCandidate(
  summary: DeterministicFinancialSummary,
  evidence: EvidenceBuilder,
  options: Required<RecommendationPolicyEngineOptions>,
) {
  if (summary.debt.highInterestDebtMinor <= 0n) return undefined

  const highInterestDebtEvidenceId = evidence.metric(
    'high-interest-debt',
    'High-interest debt balance',
    {
      period: summary.period,
      currency: summary.currency,
      amountMinor: summary.debt.highInterestDebtMinor,
      severity: 'warning',
    },
  )
  const weightedAprEvidenceId =
    summary.debt.weightedAprBps === null
      ? undefined
      : evidence.metric('weighted-apr', 'Weighted debt APR', {
          period: summary.period,
          percentageBps: summary.debt.weightedAprBps,
          severity:
            summary.debt.weightedAprBps >= options.highInterestAprBps
              ? 'warning'
              : 'info',
        })

  return createCandidate({
    type: 'high_interest_debt',
    title: 'Prioritize extra payments toward high-interest debt',
    rationale:
      'High-interest balances are present, so extra repayment should come before lower-impact optimizations.',
    priority: 'high',
    evidenceIds: [
      highInterestDebtEvidenceId,
      ...(weightedAprEvidenceId === undefined ? [] : [weightedAprEvidenceId]),
      ...riskEvidenceId(evidence, summary, 'high-interest-debt'),
    ],
    assumptions: [
      `High-interest debt uses APRs at or above ${(options.highInterestAprBps / 100).toFixed(2)}%.`,
      'Extra payment capacity is taken from savings capacity after minimum debt payments when available.',
    ],
    estimatedMonthlyImpactMinor: positiveOrUndefined(
      summary.budgetBaseline.savingsCapacityAfterMinimumDebtMinor,
    ),
    currency: summary.currency,
    confidenceBps: confidenceFor(summary, 8_500),
  })
}

function buildCreditUtilizationCandidate(
  summary: DeterministicFinancialSummary,
  evidence: EvidenceBuilder,
  options: Required<RecommendationPolicyEngineOptions>,
) {
  const utilization = summary.debt.creditUtilizationBps
  if (utilization === null || utilization <= options.highCreditUtilizationBps) {
    return undefined
  }

  const utilizationEvidenceId = evidence.metric(
    'credit-utilization',
    'Credit utilization',
    {
      period: summary.period,
      percentageBps: utilization,
      severity: utilization >= 5_000 ? 'critical' : 'warning',
    },
  )

  return createCandidate({
    type: 'high_credit_utilization',
    title: 'Lower revolving credit utilization',
    rationale:
      'Credit utilization is above the policy threshold and can reduce financial flexibility.',
    priority: utilization >= 5_000 ? 'high' : 'medium',
    evidenceIds: [
      utilizationEvidenceId,
      ...riskEvidenceId(evidence, summary, 'high-credit-utilization'),
    ],
    assumptions: [
      `High utilization starts above ${(options.highCreditUtilizationBps / 100).toFixed(2)}%.`,
      'Accounts without credit limits are excluded from the utilization percentage.',
    ],
    currency: summary.currency,
    confidenceBps: confidenceFor(summary, 8_000),
  })
}

function buildCategoryOverspendCandidates(
  summary: DeterministicFinancialSummary,
  evidence: EvidenceBuilder,
  options: Required<RecommendationPolicyEngineOptions>,
) {
  const spendingByCategory = new Map(
    summary.spendingByCategory.map((entry) => [entry.category, entry]),
  )

  return [...summary.budgetBaseline.budgetVariance]
    .filter((variance) => variance.varianceMinor > 0n)
    .sort((left, right) => {
      const varianceComparison =
        right.varianceMinor > left.varianceMinor
          ? 1
          : right.varianceMinor < left.varianceMinor
            ? -1
            : 0
      return varianceComparison === 0
        ? left.category.localeCompare(right.category)
        : varianceComparison
    })
    .slice(0, options.maxCategoryRecommendations)
    .map((variance) => {
      const spending = spendingByCategory.get(variance.category)
      const isLargeVariance =
        variance.plannedMinor === 0n ||
        variance.varianceMinor * 10_000n >= variance.plannedMinor * 2_500n
      const budgetEvidenceId = evidence.budgetVariance(variance.category, {
        period: summary.period,
        currency: summary.currency,
        amountMinor: variance.varianceMinor,
        severity: amountSeverity(
          variance.varianceMinor,
          variance.plannedMinor / 4n,
        ),
      })
      const spendingEvidenceId =
        spending === undefined
          ? undefined
          : evidence.categorySpending(variance.category, {
              period: summary.period,
              currency: summary.currency,
              amountMinor: spending.netExpenseMinor,
            })

      return createCandidate({
        type: 'category_overspend',
        slug: slugify(variance.category),
        title: `Reduce overspending in ${variance.category}`,
        rationale:
          'Actual spending is above the planned budget line for this category.',
        priority: isLargeVariance ? 'medium' : 'low',
        evidenceIds: [
          budgetEvidenceId,
          ...(spendingEvidenceId === undefined ? [] : [spendingEvidenceId]),
        ],
        assumptions: [
          'Budget variance is actual spending minus planned spending for the period.',
          'A positive variance means the category exceeded its planned amount.',
        ],
        estimatedMonthlyImpactMinor: variance.varianceMinor,
        currency: summary.currency,
        confidenceBps: confidenceFor(summary, 7_500),
      })
    })
}

function buildDataQualityCandidate(
  summary: DeterministicFinancialSummary,
  evidence: EvidenceBuilder,
) {
  const warningNotes = sortedCoverageNotes(summary).filter(
    (note) => note.severity === 'warning',
  )
  const unreviewedRisk = sortedRiskIndicators(summary).find(
    (risk) => risk.code === 'unreviewed-data',
  )

  if (warningNotes.length === 0 && unreviewedRisk === undefined) {
    return undefined
  }

  return createCandidate({
    type: 'data_quality_gap',
    title: 'Review transaction data before relying on recommendations',
    rationale:
      'Some included data is incomplete or unreviewed, which can change budget and recommendation results.',
    priority: warningNotes.length > 0 ? 'medium' : 'low',
    evidenceIds: [
      evidence.dataQuality(summary),
      ...warningNotes.map((note) => evidence.coverage(note)),
      ...(unreviewedRisk === undefined ? [] : [evidence.risk(unreviewedRisk)]),
    ],
    assumptions: [
      'Recommendations should be refreshed after data quality gaps are resolved.',
      'This candidate does not estimate financial impact.',
    ],
    currency: summary.currency,
    confidenceBps: 9_000,
  })
}

export function buildRecommendationCandidates(
  summary: DeterministicFinancialSummary,
  inputOptions: RecommendationPolicyEngineOptions = {},
): RecommendationPolicyResult {
  const options = policyOptions(inputOptions)
  const evidence = new EvidenceBuilder()
  const candidates = [
    buildCashFlowCandidate(summary, evidence),
    buildEmergencyFundCandidate(summary, evidence, options),
    buildHighInterestDebtCandidate(summary, evidence, options),
    buildCreditUtilizationCandidate(summary, evidence, options),
    ...buildCategoryOverspendCandidates(summary, evidence, options),
    buildDataQualityCandidate(summary, evidence),
  ].filter((candidate): candidate is RecommendationCandidate =>
    Boolean(candidate),
  )

  const evidenceReferences = evidence.toArray()
  const validatedCandidates = candidates.map((candidate) =>
    validateRecommendationCandidate(candidate, evidenceReferences),
  )

  return {
    evidence: evidenceReferences,
    candidates: validatedCandidates,
  }
}
