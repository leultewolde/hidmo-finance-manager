import { describe, expect, it } from 'vitest'

import {
  buildFinanceExport,
  buildFinanceExportDatasets,
  writeCsv,
  type FinanceExportData,
} from './index.js'

const generatedAt = new Date('2026-07-11T16:00:00.000Z')

const emptyData: FinanceExportData = {
  accounts: [],
  accountBalances: [],
  transactions: [],
  transactionSplits: [],
  classificationRules: [],
  manualLoans: [],
  budgets: [],
  analysisSnapshots: [],
  recommendations: [],
  connections: [],
}

describe('finance export writer', () => {
  it('builds every expected CSV dataset and a checksum manifest', () => {
    const bundle = buildFinanceExport({
      generatedAt,
      appVersion: 'test-version',
      data: {
        ...emptyData,
        accounts: [
          {
            id: 'account-1',
            connectionId: 'connection-1',
            name: 'Checking',
            kind: 'checking',
            accountClass: 'asset',
            subtype: 'depository',
            currency: 'USD',
            balanceSource: 'connected',
            dataQuality: 'verified',
            active: true,
            manual: false,
            createdAt: '2026-07-01T00:00:00.000Z',
            updatedAt: '2026-07-02T00:00:00.000Z',
          },
        ],
        accountBalances: [
          {
            accountId: 'account-1',
            currentBalanceMinor: 123_456n,
            availableBalanceMinor: 120_000n,
            creditLimitMinor: null,
            currency: 'USD',
            balanceAsOf: '2026-07-11',
          },
        ],
      },
    })

    expect(bundle.files.map((file) => file.path)).toEqual([
      'manifest.json',
      'accounts.csv',
      'account_balances.csv',
      'transactions.csv',
      'transaction_splits.csv',
      'classification_rules.csv',
      'manual_loans.csv',
      'budgets.csv',
      'analysis_snapshots.csv',
      'recommendations.csv',
      'connections.csv',
    ])
    expect(bundle.manifest).toMatchObject({
      schemaVersion: 1,
      generatedAt: '2026-07-11T16:00:00.000Z',
      appVersion: 'test-version',
    })
    expect(bundle.manifest.datasets).toHaveLength(10)
    expect(bundle.manifest.datasets[0]).toMatchObject({
      name: 'accounts',
      fileName: 'accounts.csv',
      rowCount: 1,
      byteLength: expect.any(Number) as number,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
  })

  it('escapes commas, quotes, and new lines in CSV cells', () => {
    const [transactions] = buildFinanceExportDatasets({
      ...emptyData,
      transactions: [
        {
          id: 'transaction-1',
          accountId: 'account-1',
          authorizedDate: null,
          postedDate: '2026-07-11',
          normalizedAmountMinor: -1234n,
          currency: 'USD',
          merchantName: 'Store, "Main"',
          originalDescription: 'Line 1\nLine 2',
          state: 'posted',
          removed: false,
          economicType: 'expense',
          appCategory: 'Groceries',
          classificationConfidenceBps: 9000,
          userReviewed: true,
          createdAt: '2026-07-11T00:00:00.000Z',
          updatedAt: '2026-07-11T00:00:00.000Z',
        },
      ],
    }).filter((dataset) => dataset.name === 'transactions')

    expect(transactions).toBeDefined()
    const csv = writeCsv(transactions!)

    expect(csv).toContain('"Store, ""Main"""')
    expect(csv).toContain('"Line 1\nLine 2"')
    expect(csv).toContain('-1234')
    expect(csv).toContain('true')
  })

  it('does not expose Plaid tokens, provider IDs, or account masks in exported column names', () => {
    const bundle = buildFinanceExport({
      generatedAt,
      appVersion: 'test-version',
      data: emptyData,
    })
    const allContent = bundle.files.map((file) => file.content).join('\n')

    expect(allContent).not.toMatch(/access_token/i)
    expect(allContent).not.toMatch(/plaid_item/i)
    expect(allContent).not.toMatch(/provider_account/i)
    expect(allContent).not.toMatch(/provider_transaction/i)
    expect(allContent).not.toMatch(/\bmask\b/i)
  })

  it('rejects unsafe custom dataset columns before writing', () => {
    expect(() =>
      writeCsv({
        name: 'connections',
        fileName: 'connections.csv',
        columns: [{ key: 'plaidItemId', header: 'plaid_item_id' }],
        rows: [{ plaidItemId: 'item-secret' }],
      }),
    ).toThrow('Unsafe export column is not allowed')
  })
})
