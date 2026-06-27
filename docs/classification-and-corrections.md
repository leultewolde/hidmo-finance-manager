# Classification, transfers, and corrections

Milestone 7 turns synchronized provider suggestions into reviewable financial
truth. All decisions are deterministic and owner-scoped.

## Precedence

Classification uses this order:

1. transaction splits;
2. reviewed owner correction;
3. owner classification rule;
4. accepted transfer or card-payment match;
5. mapped Plaid Personal Finance Category;
6. direction-based fallback requiring review.

Provider synchronization updates provider facts such as amount, date, merchant,
and category suggestion. It does not overwrite a reviewed owner category or
economic type.

## Review queue

The dashboard shows unreviewed transactions below 90% confidence. The owner can:

- choose income, expense, refund, transfer, or debt payment;
- edit the application category;
- save the correction at 100% confidence;
- create a merchant rule from the correction;
- split one transaction into two exact amounts;
- remove existing splits.

Split amounts use the application's signed convention and must sum exactly to
the original transaction. The server validates the invariant transactionally.

## Rules

The initial rule editor supports case-insensitive merchant substring matching.
Rules are evaluated in ascending priority. Reviewed transactions and accepted
matches are never replaced by a rule.

Removing a rule reruns classification. Transactions that were explicitly
reviewed remain unchanged.

## Transfer and card-payment matching

Candidates require:

- equal magnitude with opposite signs;
- different accounts;
- dates within three days;
- no previously selected transaction.

Transfer-related descriptions/categories and same-day settlement raise the
score. An asset-account outflow paired with a liability-account inflow is a
credit-card payment. Strong unambiguous candidates are accepted automatically;
lower-confidence candidates enter the review queue.

Accepted internal transfers use economic type `transfer`. Accepted credit-card
payments use `debt_payment`. Both types are excluded from income and expense
totals by the deterministic finance engine. Credit-card purchases remain
ordinary expenses.

## Verification

1. Synchronize Sandbox transactions.
2. Review low-confidence transactions and save a correction.
3. Synchronize again and confirm the correction remains.
4. Create a merchant rule and verify matching unreviewed transactions update.
5. Split a transaction and verify the two values equal the original.
6. Accept or reject a possible transfer.
7. Confirm transfers and card payments do not affect income/expense totals.

Mutations require the owner session, same-origin request, CSRF token, and
owner-scoped internal UUID. Browser requests never select a Firebase UID,
database owner ID, or provider transaction ID.
