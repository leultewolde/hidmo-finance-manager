import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import type { Account, Transaction, TransactionSplit } from './domain.js'
import {
  applyPrincipalPayment,
  assertTransactionSplits,
  calculateBalanceSheet,
  calculateCashFlow,
} from './metrics.js'

const june = { startDate: '2026-06-01', endDate: '2026-06-30' }

describe('financial invariants', () => {
  it('is independent of account and transaction input ordering', () => {
    fc.assert(
      fc.property(
        fc.array(fc.bigInt({ min: 0n, max: 10_000_000n }), {
          minLength: 1,
          maxLength: 20,
        }),
        (balances) => {
          const accounts: Account[] = balances.map((balanceMinor, index) => ({
            id: `account-${index.toString()}`,
            name: `Account ${index.toString()}`,
            kind: index % 2 === 0 ? 'checking' : 'credit_card',
            balanceMinor,
            currency: 'USD',
            balanceAsOf: '2026-06-30',
            balanceSource: 'connected',
            dataQuality: 'verified',
          }))

          expect(calculateBalanceSheet(accounts)).toEqual(
            calculateBalanceSheet([...accounts].reverse()),
          )
        },
      ),
    )
  })

  it('keeps matched transfers economically neutral', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 10_000_000n }), (amountMinor) => {
        const transactions: Transaction[] = [
          {
            id: 'transfer-out',
            accountId: 'checking',
            postedDate: '2026-06-10',
            amountMinor: -amountMinor,
            currency: 'USD',
            direction: 'outflow',
            economicType: 'transfer',
            category: 'transfer',
            state: 'posted',
            reviewed: true,
          },
          {
            id: 'transfer-in',
            accountId: 'savings',
            postedDate: '2026-06-10',
            amountMinor,
            currency: 'USD',
            direction: 'inflow',
            economicType: 'transfer',
            category: 'transfer',
            state: 'posted',
            reviewed: true,
          },
        ]

        const result = calculateCashFlow(transactions, june)
        expect(result.value).toMatchObject({
          incomeMinor: 0n,
          netExpensesMinor: 0n,
          freeCashFlowMinor: 0n,
        })
        expect(calculateCashFlow([...transactions].reverse(), june)).toEqual(
          result,
        )
      }),
    )
  })

  it('preserves split totals exactly', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 1_000_000n }),
        fc.bigInt({ min: 1n, max: 1_000_000n }),
        fc.bigInt({ min: 1n, max: 1_000_000n }),
        (principal, interest, fee) => {
          const total = principal + interest + fee
          const transaction: Transaction = {
            id: 'payment',
            accountId: 'checking',
            postedDate: '2026-06-15',
            amountMinor: -total,
            currency: 'USD',
            direction: 'outflow',
            economicType: 'debt_payment',
            category: 'debt',
            state: 'posted',
            reviewed: true,
          }
          const splits: TransactionSplit[] = [
            {
              id: 'principal',
              transactionId: transaction.id,
              amountMinor: -principal,
              economicType: 'debt_payment',
              category: 'debt:principal',
            },
            {
              id: 'interest',
              transactionId: transaction.id,
              amountMinor: -interest,
              economicType: 'expense',
              category: 'debt:interest',
            },
            {
              id: 'fee',
              transactionId: transaction.id,
              amountMinor: -fee,
              economicType: 'expense',
              category: 'debt:fee',
            },
          ]

          expect(() =>
            assertTransactionSplits(transaction, splits),
          ).not.toThrow()
        },
      ),
    )
  })

  it('preserves net worth for any affordable principal payment', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10_000_000n }),
        fc.bigInt({ min: 0n, max: 10_000_000n }),
        fc.bigInt({ min: 0n, max: 10_000_000n }),
        (cash, debt, requestedPayment) => {
          const affordable = requestedPayment > cash ? cash : requestedPayment
          const result = applyPrincipalPayment(cash, debt, affordable)

          expect(result.netWorthAfterMinor).toBe(result.netWorthBeforeMinor)
          expect(result.cashBalanceMinor).toBeGreaterThanOrEqual(0n)
          expect(result.debtBalanceMinor).toBeGreaterThanOrEqual(0n)
        },
      ),
    )
  })
})
