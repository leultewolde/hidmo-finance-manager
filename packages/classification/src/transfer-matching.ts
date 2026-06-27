export interface MatchableTransaction {
  id: string
  accountId: string
  accountClass: 'asset' | 'liability'
  postedDate: string
  amountMinor: bigint
  description: string
  category: string
  removed: boolean
}

export interface TransferCandidate {
  transactionOutId: string
  transactionInId: string
  scoreBps: number
  method: 'internal_transfer' | 'credit_card_payment'
  autoAccept: boolean
}

function daysApart(left: string, right: string) {
  return Math.abs(
    (new Date(`${left}T00:00:00Z`).getTime() -
      new Date(`${right}T00:00:00Z`).getTime()) /
      86_400_000,
  )
}

function transferLanguage(value: string) {
  return /(transfer|payment|autopay|credit card|online payment)/i.test(value)
}

export function findTransferCandidates(
  transactions: readonly MatchableTransaction[],
): TransferCandidate[] {
  const active = transactions.filter((transaction) => !transaction.removed)
  const results: TransferCandidate[] = []
  const used = new Set<string>()

  for (const outflow of active.filter(
    (transaction) => transaction.amountMinor < 0n,
  )) {
    const candidates = active
      .filter(
        (inflow) =>
          inflow.amountMinor > 0n &&
          inflow.accountId !== outflow.accountId &&
          !used.has(inflow.id) &&
          inflow.amountMinor === -outflow.amountMinor &&
          daysApart(inflow.postedDate, outflow.postedDate) <= 3,
      )
      .map((inflow) => {
        const method =
          outflow.accountClass === 'asset' &&
          inflow.accountClass === 'liability'
            ? ('credit_card_payment' as const)
            : ('internal_transfer' as const)
        const languageEvidence =
          transferLanguage(outflow.description) ||
          transferLanguage(inflow.description) ||
          transferLanguage(outflow.category) ||
          transferLanguage(inflow.category)
        const dayDifference = daysApart(inflow.postedDate, outflow.postedDate)
        const scoreBps =
          7_500 +
          (dayDifference === 0 ? 1_000 : dayDifference === 1 ? 500 : 0) +
          (languageEvidence ? 1_000 : 0)

        return {
          transactionOutId: outflow.id,
          transactionInId: inflow.id,
          scoreBps: Math.min(scoreBps, 10_000),
          method,
          autoAccept: scoreBps >= 9_000,
        }
      })
      .sort((left, right) => right.scoreBps - left.scoreBps)

    const best = candidates[0]
    if (best !== undefined) {
      results.push(best)
      used.add(outflow.id)
      used.add(best.transactionInId)
    }
  }

  return results
}
