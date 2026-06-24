# Product Design

## 1. Product definition

Finance Manager is a read-only financial planning and decision-support product.
It aggregates accounts, transactions, recurring cash flows, and debts, then
turns them into a current financial snapshot, a budget, forecasts, and
prioritized recommendations.

The initial product does not move money, trade securities, refinance debt, file
taxes, or provide legally regulated investment advice.

## 2. Target user

The product has one allowlisted US owner who:

- uses multiple banks and credit cards;
- wants a single view of cash, debt, income, and spending;
- does not maintain a detailed budget today;
- wants specific actions rather than generic financial education.

Public registration, households, shared accounts, multiple currencies, and
business accounting are outside the current product scope.

## 3. Core concepts

### Account classification

Accounts are classified independently from their transactions:

- **Asset:** checking, savings, cash, brokerage, retirement, property entered
  manually.
- **Liability:** credit card, mortgage, student loan, auto loan, personal loan,
  line of credit.

Net worth is:

`total assets - total liabilities`

### Transaction classification

Every transaction has three separate dimensions:

1. **Direction:** inflow or outflow.
2. **Economic type:** income, expense, transfer, debt payment, refund,
   adjustment, or unknown.
3. **Category:** housing, groceries, dining, transportation, and so on.

These dimensions must not be collapsed into one label. A credit-card payment,
for example, is an outflow from checking and an inflow to the credit account,
but is normally a transfer rather than new spending.

### Debt payment treatment

A debt payment may contain:

- principal reduction, which changes net worth but is not an expense;
- interest, which is an expense;
- fees, which are expenses;
- an internal transfer between connected accounts.

When exact splits are unavailable, the product marks the split as estimated and
lets the user correct it.

## 4. Primary experience

### Onboarding

1. Create an account and enable multi-factor authentication.
2. Connect one or more institutions with Plaid Link.
3. Add unsupported assets or debts manually.
4. Confirm detected income sources and recurring obligations.
5. Review uncertain transfers and transaction classifications.
6. Select goals: emergency fund, debt payoff, spending control, major purchase,
   or retirement saving.

### Overview

The default dashboard shows:

- net worth and its 30/90-day trend;
- cash available and upcoming obligations;
- month-to-date income, spending, and savings;
- current debt and weighted interest rate;
- budget status by category;
- a 30-day cash forecast;
- the top three recommended actions;
- data freshness and accounts needing attention.

### Transactions

Users can search, filter, split, recategorize, hide, annotate, and mark
transactions as transfers, income, expenses, refunds, or debt payments.
A correction can optionally create a rule for future transactions.

### Budget

The first budget is proposed from:

- median reliable monthly income;
- six months of recurring obligations;
- median essential and discretionary spending;
- minimum debt payments;
- goal contributions;
- a buffer for irregular expenses.

The user can accept the proposal, edit category limits, and choose whether
unused amounts roll over.

### Debt plan

For each debt, show balance, APR, minimum payment, due date, projected payoff,
and total projected interest. Compare:

- minimum payments only;
- avalanche: highest APR first;
- snowball: lowest balance first;
- a user-defined hybrid plan.

Recommendations must preserve minimum payments and a configurable cash buffer.

Debt records may come from connected credit-card or loan accounts or be entered
manually. Connected loan data remains editable because provider coverage and
field completeness vary. The MVP supports personal, auto, and student loans at
the common balance/APR/payment level; specialized workflows such as escrow,
deferment, refinancing, and lender-specific amortization are deferred.

### Forecast and recommendations

The forecast presents base, conservative, and optimistic scenarios. Each
recommendation includes:

- the observed fact;
- the proposed action;
- estimated monthly and annual impact;
- assumptions and confidence;
- tradeoffs;
- a direct path to update the budget or goal.

Examples include reducing a category limit, canceling a likely unused
subscription, building an emergency buffer before accelerating debt, or
redirecting a finished payment toward the next goal.

## 5. Financial metrics

The finance engine owns these calculations:

- net worth;
- liquid cash;
- monthly income and expenses;
- free cash flow;
- savings rate;
- emergency-fund coverage in months;
- credit utilization;
- debt-to-income ratio when gross income is known;
- recurring obligation ratio;
- budget variance;
- projected low-cash date;
- payoff time and projected interest.

Every metric stores the formula version, input period, calculation timestamp,
and data-quality status.

## 6. Classification order

Classification follows a predictable precedence:

1. explicit user override;
2. user-created merchant or description rule;
3. matched transfer pair between owned accounts;
4. known debt-payment pattern;
5. recurring-stream and merchant history;
6. Plaid personal-finance category;
7. model-assisted suggestion;
8. unknown, sent to the review queue.

Model suggestions below the configured confidence threshold are never applied
silently.

## 7. MVP scope

### Included

- single-user Google authentication restricted to an allowlisted account;
- Plaid connection and reconnection;
- checking, savings, credit-card, supported loan, brokerage, and retirement
  accounts;
- transaction synchronization;
- manual loan accounts and transactions;
- income, expense, transfer, refund, and debt-payment classification;
- recurring income and expense detection;
- net-worth and cash-flow dashboard;
- monthly category budget;
- simple cash forecast;
- debt plans for connected credit cards, connected supported loans, and
  manually entered loans;
- investment account balances included in net worth;
- user corrections and classification rules;
- AI-generated weekly summary and prioritized recommendations;
- CSV export and full account deletion.

### Deferred

- investment holdings, performance analysis, and portfolio advice;
- specialized mortgage, auto-loan, and student-loan optimization;
- bill payment or money movement;
- credit-score integrations;
- tax optimization;
- couples and household collaboration;
- native mobile applications;
- open-ended financial chat;
- autonomous financial actions.

## 8. Success criteria

For an MVP user with at least 90 days of data:

- account setup completes without exposing Plaid credentials to the client;
- transaction sync is incremental, repeatable, and idempotent;
- transfers do not inflate spending or income;
- at least 95% of transaction value is classified or explicitly reviewed;
- dashboard totals reconcile to stored normalized transactions;
- every recommendation links to the facts and assumptions that produced it;
- deleting the user removes tokens and financial records from active systems.
