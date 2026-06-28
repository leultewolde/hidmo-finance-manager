# Incremental transaction synchronization

Milestone 6 imports Plaid transaction updates with `/transactions/sync`. Each
connection stores one Item-level cursor. The browser can request a sync using
an internal connection UUID but never receives the cursor, access token,
provider transaction IDs, or complete provider account IDs.

## Run locally

1. Start the application with `pnpm dev`.
2. Sign in and open the dashboard.
3. Connect a Plaid Sandbox institution if none is connected.
4. The application attempts an initial synchronization after Link completes.
5. Select **Sync now** to request later incremental updates.
6. Confirm the transaction list and last-successful-sync time update.

Plaid can return an empty first response for several seconds after Item
creation while Transactions data is being prepared. Use **Sync now** again
after the Sandbox Item becomes ready.

New Link sessions request 180 days of transaction history where the institution
and Plaid support it. Plaid does not allow the history window to be expanded
after an Item has already initialized Transactions, so older development Items
may need to be disconnected and linked again.

## Cursor safety

Synchronization loads the connection's current cursor, fetches every page, and
collects added, modified, and removed records. PostgreSQL applies the complete
change set and final cursor in one transaction.

The final cursor is never saved when:

- a Plaid page fails;
- normalization fails;
- an account reference is unknown;
- transaction persistence fails;
- another process has already advanced the cursor.

Plaid can report `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION`. In that case,
the entire pagination loop restarts from the original stored cursor, as
required by Plaid's API contract.

## Idempotency and replacement

Provider transaction IDs are unique within an internal account. Repeating a
sync updates the existing transaction instead of inserting a duplicate.
Removed records remain stored with `removed=true` and are excluded from
financial calculations.

When a posted transaction contains `pending_transaction_id`, the matching
pending record is marked removed before the posted record is applied. This
prevents both states from affecting totals.

## Amount convention

Plaid reports positive amounts when money leaves an account and negative
amounts when money enters it. The Plaid normalization boundary converts this
exactly once:

```text
internal normalized amount = -Plaid amount
```

Internal positive values are inflows and internal negative values are
outflows. Both the raw provider amount in minor units and normalized amount are
stored for reconciliation.

## Retries and locking

The current local/web runner:

- prevents overlapping syncs for one owner/connection in the current process;
- uses a PostgreSQL advisory transaction lock while applying updates;
- rejects stale-cursor commits from another process;
- retries transient Plaid and rate-limit errors up to three times;
- records every run in `task_executions`;
- records safe failure codes without transaction descriptions or provider IDs.

Cloud Tasks delivery is now proven in the GCP development environment. Milestone
9 moves Plaid synchronization onto that worker path:

- web requests enqueue sync work and return quickly;
- the worker runs `/transactions/sync`;
- task status is visible in the dashboard;
- Cloud Tasks retries are idempotent;
- Plaid transaction webhooks enqueue the same task type.

## Plaid webhook setup

The deployed development webhook URL is:

```text
https://finance-web-wn5w6w4mva-ue.a.run.app/api/plaid/webhook
```

Add that URL in the Plaid Dashboard for the Sandbox application when testing
webhook-triggered sync.

The current webhook handler:

- accepts public HTTPS requests from Plaid;
- validates the minimal webhook envelope;
- ignores unsupported webhook types and unknown Items without leaking details;
- enqueues a sync job for transaction update webhooks;
- stores the job with `trigger = webhook`;
- uses Plaid `webhook_id` when present to avoid duplicate task enqueueing on
  retried webhook delivery.

Signature verification is intentionally not complete yet. Before using this
with real financial data outside Sandbox, implement Plaid's current webhook
verification flow and store only minimal, redacted event metadata.

## Current scope

Plaid `/transactions/sync` supports depository, credit, and supported student
loan accounts. Investment transactions require Plaid's Investments transaction
endpoint and are outside this milestone. Investment account balances remain
part of net worth.
