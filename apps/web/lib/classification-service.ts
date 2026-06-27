import {
  classifyTransaction,
  findTransferCandidates,
  type ClassificationRule,
} from '@hidmo/classification'

import type { ReturnTypeRepositories } from './repository-types'

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
  repositories: ReturnTypeRepositories,
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
      .map((transaction) => ({
        id: transaction.id,
        accountId: transaction.accountId,
        accountClass: transaction.accountClass,
        postedDate: transaction.postedDate,
        amountMinor: transaction.amountMinor,
        description:
          transaction.merchantName ??
          transaction.description ??
          transaction.category,
        category: transaction.providerCategory ?? transaction.category,
        removed: transaction.removed,
      })),
  )
  await repositories.transfers.refreshCandidates(userId, candidates)

  return {
    classified: decisions.length,
    transferCandidates: candidates.length,
  }
}
