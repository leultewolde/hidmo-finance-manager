# Financial Formula Reference

All monetary amounts are integer minor units. For USD, `12_599` represents
`$125.99`. Calculations never use JavaScript floating-point values for money.

The MVP is single-currency. Any calculation receiving mixed currencies fails
explicitly instead of converting or silently combining values.

## Sign and balance conventions

- Account balances are non-negative magnitudes.
- Asset accounts increase net worth.
- Liability accounts decrease net worth.
- Transaction amounts are signed economic movements:
  - positive: inflow;
  - negative: outflow.
- Transfers and debt-principal payments are excluded from income and expense.
- Refunds are positive and reduce expense in their category.
- Pending transactions do not enter posted cash-flow or budget actuals.

## Formula versions

### `net-worth/v1`

```text
total assets - total liabilities
```

Brokerage and retirement balances are assets.

### `liquid-cash/v1`

```text
checking + savings + cash
```

Brokerage, retirement, property, and credit capacity are excluded.

### `cash-flow/v1`

```text
net expenses = posted expense outflows - posted refunds
free cash flow = posted income - net expenses
```

Transfers, debt-principal payments, pending transactions, adjustments, and
unknown transactions are excluded. When a debt payment is split, only interest
and fee splits classified as expenses enter expense totals.

### `savings-rate/v1`

```text
free cash flow / income
```

The result uses basis points: `5_230` means `52.30%`. It is unavailable when
income is zero.

### `credit-utilization/v1`

```text
total credit-card balances / total known credit limits
```

The result uses basis points. Accounts missing a limit are counted as incomplete
and do not add a denominator.

### `budget-variance/v1`

```text
variance = net category actual - planned amount
remaining = planned amount - net category actual
```

A positive variance is over budget. Refunds reduce the category actual.

### `weighted-apr/v1`

```text
sum(debt balance × APR basis points) / total debt balance
```

The result is an integer number of APR basis points and is unavailable when
total debt is zero.

### `emergency-coverage/v1`

```text
liquid cash / essential monthly expenses
```

The result uses hundredths of a month: `500` means `5.00 months`. It is
unavailable when essential monthly expenses are zero.

### `debt-payoff/v1`

The simulation runs monthly:

1. add rounded monthly simple interest to each active debt;
2. pay every active debt's minimum payment, bounded by the amount owed;
3. for avalanche or snowball, allocate the remaining fixed monthly payment
   budget to the selected target;
4. roll freed minimum payments into subsequent target payments;
5. stop when every balance and accrued interest amount reaches zero.

Monthly interest:

```text
round(balance × APR basis points / 120,000)
```

Avalanche targets the highest APR, then stable debt ID. Snowball targets the
lowest amount owed, then stable debt ID. Balances are never allowed below zero.
