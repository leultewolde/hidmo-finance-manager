import {
  classifyTransaction,
  findTransferCandidates,
  type ClassificationRule,
  type MatchableTransaction,
  type TransferCandidate,
} from '@hidmo/classification'

type EconomicType = ClassificationRule['economicType']

interface RuleRow {
  id: string
  priority: number
  matchConditions: unknown
  economicType: EconomicType
  category: string
}

interface ClassificationTransactionRow {
  id: string
  accountId: string
  accountClass: 'asset' | 'liability' | 'investment'
  postedDate: string
  amountMinor: bigint
  merchantName: string | null
  description: string | null
  providerCategory: string | null
  economicType: EconomicType
  category: string
  reviewed: boolean
  removed: boolean
}

interface ClassificationDecision {
  transactionId: string
  economicType: EconomicType
  category: string
  confidenceBps: number
  source: 'rule' | 'user' | 'provider' | 'fallback'
  ruleId?: string
}

interface ClassificationRepositories {
  classificationRules: {
    listActive(userId: string): Promise<RuleRow[]>
  }
  transactions: {
    listForClassification(
      userId: string,
    ): Promise<ClassificationTransactionRow[]>
    applyClassificationSuggestions(
      userId: string,
      decisions: ClassificationDecision[],
    ): Promise<void>
  }
  transfers: {
    listAccepted(
      userId: string,
    ): Promise<{ transactionOutId: string; transactionInId: string }[]>
    reapplyAccepted(userId: string): Promise<void>
    refreshCandidates(
      userId: string,
      candidates: TransferCandidate[],
    ): Promise<void>
  }
}

function parseConditions(
  value: unknown,
): Omit<ClassificationRule, 'id' | 'priority' | 'economicType' | 'category'> {
  if (typeof value !== 'object' || value === null) return {}
  const conditions = value as Record<string, unknown>

  return {
    ...(typeof conditions.merchantContains === 'string'
      ? { merchantContains: conditions.merchantContains }
      : {}),
    ...(typeof conditions.descriptionContains === 'string'
      ? { descriptionContains: conditions.descriptionContains }
      : {}),
    ...(typeof conditions.accountId === 'string'
      ? { accountId: conditions.accountId }
      : {}),
    ...(conditions.direction === 'inflow' || conditions.direction === 'outflow'
      ? { direction: conditions.direction }
      : {}),
  }
}

export async function refreshClassifications(
  userId: string,
  repositories: ClassificationRepositories,
) {
  const [transactionRows, ruleRows, acceptedMatches] = await Promise.all([
    repositories.transactions.listForClassification(userId),
    repositories.classificationRules.listActive(userId),
    repositories.transfers.listAccepted(userId),
  ])
  const acceptedTransactionIds = new Set(
    acceptedMatches.flatMap((match) => [
      match.transactionOutId,
      match.transactionInId,
    ]),
  )
  const rules: ClassificationRule[] = ruleRows.map((rule) => ({
    id: rule.id,
    priority: rule.priority,
    ...parseConditions(rule.matchConditions),
    economicType: rule.economicType,
    category: rule.category,
  }))

  const decisions = transactionRows
    .filter(
      (transaction) =>
        !transaction.removed && !acceptedTransactionIds.has(transaction.id),
    )
    .map((transaction) => ({
      transactionId: transaction.id,
      ...classifyTransaction(
        {
          accountId: transaction.accountId,
          amountMinor: transaction.amountMinor,
          ...(transaction.merchantName === null
            ? {}
            : { merchantName: transaction.merchantName }),
          ...(transaction.description === null
            ? {}
            : { description: transaction.description }),
          ...(transaction.providerCategory === null
            ? {}
            : { providerCategory: transaction.providerCategory }),
          existingEconomicType: transaction.economicType,
          existingCategory: transaction.category,
          userReviewed: transaction.reviewed,
        },
        rules,
      ),
    }))
  await repositories.transactions.applyClassificationSuggestions(
    userId,
    decisions,
  )
  await repositories.transfers.reapplyAccepted(userId)

  const candidates = findTransferCandidates(
    transactionRows
      .filter((transaction) => !acceptedTransactionIds.has(transaction.id))
      .map(
        (transaction) =>
          ({
            id: transaction.id,
            accountId: transaction.accountId,
            accountClass:
              transaction.accountClass === 'liability' ? 'liability' : 'asset',
            postedDate: transaction.postedDate,
            amountMinor: transaction.amountMinor,
            description:
              transaction.merchantName ??
              transaction.description ??
              transaction.category,
            category: transaction.providerCategory ?? transaction.category,
            removed: transaction.removed,
          }) satisfies MatchableTransaction,
      ),
  )
  await repositories.transfers.refreshCandidates(userId, candidates)

  return {
    classified: decisions.length,
    transferCandidates: candidates.length,
  }
}
