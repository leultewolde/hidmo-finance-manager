# Plaid Beginner Guide

## 1. Mental model

Key Plaid concepts:

- **Application:** the project registered in the Plaid Dashboard.
- **Environment:** Sandbox, Development, or Production.
- **Product:** a data capability such as Transactions or Liabilities.
- **Link:** Plaid's user interface for selecting an institution and signing in.
- **Link token:** short-lived server-created configuration used to open Link.
- **Public token:** short-lived result from successful Link; safe only for the
  immediate server exchange.
- **Access token:** long-lived bearer credential for one Item. It is highly
  sensitive and remains server-side.
- **Item:** one login relationship between the user and a financial institution.
- **Account:** a checking, savings, credit, loan, brokerage, or other account
  under an Item.
- **Webhook:** an HTTPS notification from Plaid telling the application that
  something changed.
- **Cursor:** the application's saved position in incremental Transactions sync.

One institution connection can produce multiple accounts. Do not model a Plaid
Item as if it were one bank account.

## 2. Environments

### Sandbox

Use first. It provides test institutions, credentials, data, and testing
endpoints. No real institution credentials are entered.

### Development

Used for limited testing with real institutions subject to Plaid's current
access and usage restrictions. Treat any data here as real sensitive financial
data.

### Production

Used for the live owner application. Production access can require application
details, product requests, security/compliance information, redirect URIs, and
institution-specific OAuth setup.

Credentials are environment-specific. Keep each environment's secret in its
corresponding GCP project.

## 3. Initial products

Request only what the MVP needs:

- **Transactions:** transaction history and incremental updates.
- **Liabilities:** details for supported credit cards and loan types.
- **Investments:** only if needed to obtain reliable brokerage/retirement
  account values for net worth.

Do not request Income Verification merely to detect payroll deposits. Recurring
income can initially be inferred from Transactions.

Plaid product availability, pricing, and institution coverage change. Confirm
the enabled products and current billing terms in the Plaid Dashboard before
enabling Development or Production.

## 4. Credentials

Plaid supplies a client ID and environment-specific secret.

Local Sandbox:

- place them in an ignored local environment file;
- provide placeholders in `.env.example`;
- never prefix them with `NEXT_PUBLIC_`;
- never log the configuration object.

Deployed:

- place them in Secret Manager;
- grant only web/worker service accounts that require them access;
- use separate secrets in development and production.

The access token returned for an Item is different from the application secret.
Encrypt each Item access token before storing it in PostgreSQL.

## 5. Link flow

The correct flow is:

```text
Authenticated browser
  -> application server requests Link token from Plaid
  <- short-lived Link token
  -> browser opens Plaid Link
  <- browser receives short-lived public token
  -> browser sends public token to application server
  -> application server exchanges it with Plaid
  <- access token and Item ID
  -> server encrypts access token and stores the connection
```

### Link token creation

The server calls `/link/token/create` with values including:

- a stable internal `client_user_id`, not an email address;
- application display name;
- language;
- country code;
- requested products;
- webhook URL when deployed;
- redirect URI when required for OAuth institutions.

Generate a new Link token when beginning a Link session. Do not store one as a
long-lived application credential.

### Public-token exchange

The browser sends the public token to an authenticated application endpoint.
The server:

1. confirms the request is from the owner;
2. exchanges the public token;
3. encrypts the returned access token;
4. stores the Item ID and connection;
5. requests account metadata;
6. enqueues initial synchronization.

Do not return the access token to the browser.

## 6. Sandbox testing

Plaid's Sandbox quickstart documents current test institutions and credentials.
Use only credentials shown in the current official Dashboard/docs; common
examples may change.

Build tests for:

- successful connection with multiple accounts;
- institution/login error;
- user closing Link;
- duplicate connection attempt;
- Item requiring update mode;
- disconnected Item;
- account removed or added by the institution.

Sandbox is not merely a visual demo. Use it to force error and webhook states
before any real connection.

## 7. Accounts and balances

After exchange, call `/accounts/get` to import current account metadata and
balances.

Normalize:

- Plaid account ID into a provider field;
- account type and subtype into app account class;
- balance and currency into the internal money representation;
- credit limit separately from balance;
- account value separately from liquidity.

Important distinctions:

- a retirement balance increases net worth but is not liquid cash;
- a credit-card balance is a liability;
- a loan account can be a liability even if detailed Liabilities data is
  missing;
- provider balance freshness must be displayed.

Do not expose complete provider account IDs through browser APIs. Use internal
opaque IDs.

## 8. Transactions sync

Use `/transactions/sync`.

For each Item:

1. load the stored cursor;
2. request a page;
3. collect `added`, `modified`, and `removed`;
4. continue while `has_more` is true;
5. commit all changes and the final cursor atomically;
6. trigger normalization and recalculation.

The implementation must handle a provider mutation during pagination according
to Plaid's documented restart behavior.

### Idempotency

Use database uniqueness plus transaction boundaries. Do not assume a webhook,
task, or sync call runs once.

Required cases:

- initial empty cursor;
- no changes;
- several pages;
- modified transaction;
- removed transaction;
- pending transaction replaced by posted transaction;
- crash before final cursor save;
- retry after network timeout.

### History window

Request approximately 180 days for the MVP where supported. This gives a useful
baseline for recurring income, recurring expenses, and budgets without taking
the maximum possible history by default.

## 9. Amount signs

Plaid's amount conventions may differ from the application's economic sign
convention. Preserve:

- raw provider amount;
- normalized signed amount;
- economic type.

Convert in one tested adapter function. Do not scatter sign inversions across
queries and UI components.

Example economic interpretation:

| Event | Checking | Credit account | Expense impact |
|---|---:|---:|---:|
| Card purchase | none at purchase time | liability rises | expense once |
| Card payment | cash falls | liability falls | normally zero new expense |
| Interest charge | none immediately | liability rises | interest expense |

## 10. Liabilities and connected loans

Call `/liabilities/get` when the product is enabled.

Treat returned details as provider observations:

- APR;
- minimum payment;
- due date;
- principal/balance;
- term or maturity when available.

Coverage is not universal. A connected auto or personal loan might appear as
an account while detailed liability fields remain absent. In that case:

1. classify the account as debt;
2. retain the connected balance;
3. ask the owner for APR, minimum payment, and due date;
4. mark those fields as user-provided;
5. never overwrite a user override silently on refresh.

Manual loans use the same normalized liability model with `source=manual`.

## 11. Investment balances

The MVP needs account-level brokerage and retirement values, not holdings or
advice.

Start by evaluating whether account balances supplied for connected investment
accounts are sufficient. If the Investments product is required:

- enable it only after confirming product access and cost;
- normalize the account-level value;
- avoid persisting individual holdings or investment transactions unless a
  documented endpoint response makes temporary handling necessary;
- exclude investment values from liquid cash;
- include them in net worth.

## 12. Webhooks

Plaid needs a public HTTPS endpoint in development and production. The deployed
Cloud Run URL is sufficient for development.

Webhook handler:

1. read the request with strict body-size limits;
2. verify authenticity using Plaid's current webhook verification process;
3. validate the webhook schema;
4. derive a replay/idempotency fingerprint;
5. persist minimal event metadata;
6. enqueue a sync task;
7. return quickly.

Do not perform full Plaid synchronization inside the webhook request.

Expected Transactions webhook behavior centers on
`SYNC_UPDATES_AVAILABLE`. Webhooks are notifications, not the source of truth;
`/transactions/sync` remains the source of transaction changes.

Add a daily scheduled reconciliation because webhook delivery can be delayed or
missed.

## 13. Update mode and broken connections

Items can require user action due to changed credentials, MFA, consent expiry,
or institution errors.

Implement:

- connection state and latest Plaid error;
- an “attention required” dashboard state;
- server creation of an update-mode Link token for the existing Item;
- owner completion of Link update mode;
- sync retry after repair.

Do not tell the user to delete and reconnect by default. Reconnection can break
continuity and duplicate account/transaction history.

## 14. OAuth institutions

Some institutions require OAuth:

1. the owner begins Link;
2. Plaid redirects to the institution;
3. the institution redirects back to an allowlisted URI;
4. Link resumes.

This requires stable HTTPS redirect URIs registered in Plaid and sometimes
additional institution review. Use the deployed development hostname during
Development testing and the production custom domain for Production.

Do not use localhost redirect assumptions for production OAuth institutions.

## 15. Errors and logging

Store operational error codes needed to present and repair connection state.
Do not log:

- access tokens;
- public tokens;
- client secret;
- complete webhook bodies;
- full account IDs;
- unrestricted raw transaction descriptions.

Log:

- internal connection ID;
- Plaid request ID when safe and useful;
- operation;
- normalized error class/code;
- retry decision;
- duration;
- sync counts.

## 16. Deletion

Disconnecting an Item should:

1. call Plaid `/item/remove`;
2. mark the connection revoked;
3. prevent new queued synchronization;
4. delete encrypted token material;
5. delete or retain normalized data according to the explicit user action.

Full user deletion additionally removes all active financial data, exports,
recommendations, and queued work. Test this in Sandbox before Production access.

## 17. Sandbox-to-Production checklist

Do not connect a real account until:

- Link and update mode work;
- sync pagination and retries are tested;
- webhooks are verified and replay-safe;
- access tokens are KMS-protected;
- logs are reviewed for sensitive values;
- connection removal works;
- full deletion works;
- data export works;
- the production GCP project is isolated;
- OAuth redirect URIs are correct;
- Plaid product access and pricing are understood;
- production alerts are active.

## 18. Common beginner mistakes

- Calling Plaid directly from the browser with the application secret.
- Treating public tokens as reusable access tokens.
- Modeling Item and Account as the same entity.
- Re-downloading all transactions and replacing the database on every sync.
- Saving a cursor before all pages commit.
- Counting a credit-card payment as spending.
- Assuming Liabilities covers every connected loan.
- Assuming webhook delivery is exactly once.
- Logging complete Plaid error/request objects.
- Using Production credentials while still testing deletion and retries.

## 19. Official references

- [Plaid Quickstart](https://plaid.com/docs/quickstart/)
- [Plaid Link overview](https://plaid.com/docs/link/)
- [Transactions API](https://plaid.com/docs/api/products/transactions/)
- [Transactions Sync guidance](https://plaid.com/docs/transactions/sync-migration/)
- [Transactions webhooks](https://plaid.com/docs/transactions/webhooks/)
- [Liabilities API](https://plaid.com/docs/api/products/liabilities/)
- [Investments API](https://plaid.com/docs/api/products/investments/)
- [Webhook verification](https://plaid.com/docs/api/webhooks/webhook-verification/)
