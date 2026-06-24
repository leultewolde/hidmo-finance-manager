# Technical Design

## 1. Recommended architecture

Start as a modular monolith. Financial consistency is more important than
independent service scaling at this stage.

```text
Browser
  |
  v
Web application / API
  |-- authentication and user settings
  |-- Plaid Link token and public-token exchange
  |-- accounts, transactions, budgets, goals
  |-- dashboard and recommendation APIs
  |
  +--> Cloud SQL for PostgreSQL
  |      |-- normalized financial records
  |      |-- encrypted Plaid access tokens
  |      |-- sync cursors and audit history
  |
  +--> Cloud Tasks --> private task handler
  |      |-- Plaid synchronization
  |      |-- classification and transfer matching
  |      |-- recurring-stream detection
  |      |-- metric snapshots and forecasts
  |      +-- recommendation generation
  |
  +--> Plaid
  |
  +--> AI provider through a redaction and policy boundary

Plaid webhooks --> public HTTPS endpoint --> verified event --> durable job
```

The application is hosted on Google Cloud. The web/API container and private
task-handler container run as separate Cloud Run services. Cloud Tasks provides
durable asynchronous delivery, while Cloud Scheduler starts reconciliation and
maintenance work. See `gcp-architecture.md` for the deployment topology.

### Suggested stack

- TypeScript monorepo managed with pnpm.
- Next.js for the web application and authenticated API.
- Firebase Authentication with Google Sign-In, restricted to one configured
  owner identity.
- Cloud SQL for PostgreSQL as the system of record.
- Drizzle ORM with explicit SQL migrations.
- Cloud Tasks for short, retryable background work.
- Cloud Run Jobs for migrations and bounded batch maintenance.
- Zod schemas at external and internal boundaries.
- Plaid's maintained Node client library.
- A provider-neutral AI adapter backed initially by Gemini on Vertex AI and
  requiring structured output.
- Cloud Logging, Monitoring, Error Reporting, and Trace with structured,
  sensitive-field-redacted telemetry.

Redis, Kafka, microservices, and a vector database are unnecessary for the MVP.

## 2. Repository layout

```text
finance-manager/
  apps/
    web/                 Next.js UI and API routes
    worker/              authenticated Cloud Tasks handlers
  packages/
    database/            schema, migrations, repositories
    finance-engine/      deterministic calculations and forecasts
    plaid/               Plaid adapter and webhook handling
    classification/      rules, transfer matching, confidence
    ai/                  redaction, prompts, schemas, provider adapters
    contracts/           shared API and event schemas
  docs/
  infra/                 Terraform for GCP resources
```

The finance engine must have no dependency on React, Plaid, or the AI provider.
It accepts normalized records and returns typed calculations.

## 3. Core data model

### Identity and connectivity

**users**

- `id`, `email`, `timezone`, `base_currency`
- security and consent timestamps

**institutions**

- `id`, `plaid_institution_id`, display name

**connections**

- `id`, `user_id`, `institution_id`
- encrypted `access_token`
- `plaid_item_id`, status, consent expiration
- transaction cursor and last successful sync
- error code and reconnect-required timestamp

### Financial records

**accounts**

- internal `id`, `user_id`, `connection_id`
- provider account ID and optional persistent provider ID
- name, mask, type, subtype
- `asset_or_liability`
- current and available balance, credit limit, currency
- active/manual flags and last balance timestamp

Brokerage and retirement accounts participate in net-worth calculations using
their latest account-level value. The MVP does not ingest or analyze individual
securities, holdings, cost basis, allocation, or investment performance.

**transactions**

- internal `id`, `user_id`, `account_id`
- provider transaction ID and pending transaction ID
- authorized date, posted date, amount, currency
- normalized signed amount
- merchant and original description
- pending and removed flags
- provider category and confidence
- `economic_type`, app category, classification confidence
- user-reviewed flag and deduplication fingerprint

Use one internal sign convention: positive values increase net worth and negative
values decrease it. Keep the provider's raw amount as a separate field.

**transaction_splits**

- `transaction_id`, amount
- economic type and category
- optional linked debt or goal

**transfer_matches**

- two transaction IDs
- match score, status, method, reviewed timestamp

**liabilities**

- `account_id`, liability type
- principal balance, APR, minimum payment
- next due date, original principal, term, maturity
- source and source-updated timestamp

Liabilities may be connected credit cards, connected personal/auto/student loan
accounts when provider data is available, or manual loans. Plaid Liabilities
does not cover every debt type or institution, so all fields support manual
entry and user override. Track data provenance per field so a provider refresh
does not overwrite an explicit user correction.

### Planning

**recurring_streams**

- income or expense
- merchant/description, cadence, average amount
- next expected date, active status, confidence

**budgets** and **budget_lines**

- period, category, planned amount, rollover policy
- actual amount is calculated, not stored as editable truth

**goals**

- type, target amount/date, priority, contribution rule

**metric_snapshots**

- metric key, period, value
- formula version, input completeness, calculated timestamp

**recommendations**

- type, status, priority
- evidence JSON, assumptions JSON
- estimated impact and confidence
- generated narrative and model metadata

**classification_rules**

- match conditions, result, priority, active flag

**audit_events**

- actor, action, target, timestamp
- before/after metadata with sensitive values removed

## 4. Plaid flow

### Connection

1. The server creates a short-lived Link token.
2. The browser opens Plaid Link.
3. Link returns a public token to the browser.
4. The browser sends the public token to the server.
5. The server exchanges it for an access token.
6. The access token is encrypted and stored server-side.
7. An initial synchronization job is enqueued.

Request Transactions with enough history for trend and recurring analysis.
Plaid currently allows up to 730 days, defaults to 90 days, and recommends at
least 180 days for recurring transaction quality. Use 180 days for the MVP
unless product cost or latency requires a smaller window.

### Transaction synchronization

Use `/transactions/sync`, not periodic full replacement:

1. lock the connection against concurrent sync;
2. read its saved cursor;
3. request pages until `has_more` is false;
4. apply added, modified, and removed records idempotently;
5. save the final cursor in the same database transaction;
6. enqueue classification, metrics, and recommendation refreshes.

If the provider reports a mutation during pagination, restart from the cursor
used for the first page of that sync attempt.

Use `SYNC_UPDATES_AVAILABLE` webhooks to enqueue synchronization. Also run a
daily reconciliation job to recover from missed webhooks.

### Liabilities

Use `/liabilities/get` for supported credit-card, PayPal, student-loan, and
mortgage accounts. Treat its data as a convenience, not universal truth:

- coverage is institution- and account-dependent;
- refresh is approximately daily;
- unsupported loans require manual entry;
- user overrides take precedence.

Some institutions expose personal or auto loans as ordinary connected accounts
without complete liability details. Import the account and balance, then ask
the user for missing APR, minimum payment, and due date. Do not assume the
absence of `/liabilities/get` details means the connected account is not debt.

Enable Plaid Investments only to obtain the account-level values needed for net
worth if ordinary account balances do not provide a sufficiently reliable
investment value. Holdings and investment transactions are not part of the
MVP, so avoid retaining those records unless the chosen Plaid endpoint requires
temporary processing.

The MVP should enable Transactions and Liabilities, but should not buy Plaid's
Income product merely to identify ordinary payroll deposits. Detect recurring
income from transaction data first. Add Income Verification only if the product
later needs verified income for underwriting or another regulated workflow.

## 5. Classification and reconciliation

### Transfer matching

Candidate transfers satisfy:

- opposite signed amounts within a small tolerance;
- dates within a configurable window;
- both accounts belong to the user;
- descriptions or account types support a transfer interpretation.

Use one-to-one matching and prevent one transaction from participating in
multiple accepted pairs. Credit-card payments receive specialized matching.

### User corrections

Corrections never overwrite raw provider fields. Store app classifications and
user overrides separately. When a user corrects a transaction, offer to create
a future rule based on normalized merchant, description pattern, account, and
amount range.

### Recalculation

Any relevant transaction change invalidates affected monthly metrics, budgets,
forecasts, and recommendations. Recalculation jobs must be idempotent and
versioned.

## 6. AI boundary

The AI layer receives a purpose-built financial summary, not database rows by
default. Exclude:

- Plaid access tokens and item IDs;
- full account numbers or masks;
- names, email addresses, addresses, and free-form notes;
- raw webhook bodies;
- exact merchant descriptions when category aggregates are sufficient.

### AI responsibilities

- explain deterministic metrics in plain language;
- identify notable changes from supplied aggregates;
- rank candidate actions produced by policy rules;
- draft a budget rationale;
- generate scenario narratives;
- suggest a category for low-confidence transactions, subject to review.

### Prohibited AI responsibilities

- adding transaction totals;
- determining source-of-truth balances;
- silently changing categories or budgets;
- inventing APRs, due dates, or income;
- claiming guaranteed savings or investment returns;
- initiating financial actions.

All model responses use a strict structured schema containing:

- summary;
- evidence references;
- recommended actions;
- assumptions;
- confidence;
- risk and limitation text.

Reject responses that reference evidence IDs not present in the request.

### Vertex AI model policy

- Default to the current stable Gemini Flash-Lite model available in the chosen
  GCP region.
- Pin the exact model identifier in environment configuration and change it
  only through a tested deployment.
- Escalate to Gemini Flash only for a narrowly defined task when evaluation
  shows that Flash-Lite quality is insufficient.
- Do not use Pro models, search grounding, tuning, agents, or vector retrieval
  in the MVP.
- Generate analysis after material data changes or on a weekly schedule, not on
  every dashboard request.
- Cache accepted recommendation results until their financial inputs change.
- Set hard input/output token limits and a monthly Vertex AI budget alert.

## 7. Recommendation engine

Use a two-stage system:

1. deterministic policies create candidates and estimate impact;
2. AI ranks and explains valid candidates using the user's goals and
   preferences.

Initial policies:

- emergency cash below the configured floor;
- upcoming projected cash shortfall;
- category overspend relative to both budget and historical baseline;
- recurring charge with low observed usage confidence;
- high credit utilization;
- expensive debt with available monthly surplus;
- excessive idle cash after emergency and near-term needs;
- completed debt payment that can be redirected to another goal.

Investment-oriented recommendations should remain educational until legal and
compliance requirements are reviewed.

## 8. Security and privacy

- Keep all Plaid secrets and access tokens server-side.
- Store Plaid and AI API credentials in Secret Manager.
- Encrypt Plaid access tokens at the application layer using envelope
  encryption backed by Cloud KMS. Database encryption alone is not sufficient
  for these reusable bearer tokens.
- Use TLS everywhere and encrypted database/storage volumes.
- Use secure, HTTP-only, same-site cookies and MFA.
- Verify webhook authenticity according to Plaid's current webhook verification
  process before processing events.
- Make webhook handling replay-safe and idempotent.
- Redact secrets, tokens, account identifiers, webhook bodies, and financial
  values from logs where they are not operationally necessary.
- Separate development, sandbox, and production credentials and databases.
- Give the web, worker, migration, and CI workloads separate service accounts
  with least-privilege IAM roles.
- Record data consent, support connection revocation, and implement complete
  account deletion.
- Define backup retention and verify that deletion propagates to backups under
  the documented retention policy.
- Run dependency, secret, and container scanning in CI.
- Perform a focused threat model before connecting production accounts.

## 9. API surface

Initial endpoints:

```text
POST   /api/plaid/link-token
POST   /api/plaid/exchange
POST   /api/plaid/webhook
POST   /api/connections/:id/sync
DELETE /api/connections/:id

GET    /api/accounts
GET    /api/transactions
PATCH  /api/transactions/:id
POST   /api/transactions/:id/splits

GET    /api/dashboard
GET    /api/cash-flow
GET    /api/debts
GET    /api/forecast

GET    /api/budgets/current
PUT    /api/budgets/current
GET    /api/recommendations
PATCH  /api/recommendations/:id

GET    /api/export
DELETE /api/user
```

Do not expose provider tokens or raw provider responses through these APIs.

## 10. Delivery phases

### Phase 0: foundation

- monorepo, database migrations, authentication, Terraform, and CI;
- development GCP project;
- Cloud Run, Cloud SQL, Cloud Tasks, Secret Manager, and KMS foundations;
- finance-engine conventions and fixture-based tests;
- Plaid Sandbox connection;
- security and data-flow threat model.

### Phase 1: financial truth

- account and transaction sync;
- normalization, deduplication, transfer matching;
- corrections and rules;
- reconciled net worth and cash flow.

Exit condition: fixture and Sandbox totals reconcile with no duplicate spending.

### Phase 2: planning

- recurring streams;
- category budget;
- cash forecast;
- connected and manual loan liabilities and debt payoff scenarios;
- investment account balances in net worth.

### Phase 3: intelligence

- deterministic recommendation policies;
- redacted AI summaries and explanations;
- recommendation feedback and quality evaluation.

### Phase 4: production hardening

- isolated production GCP project created from the same Terraform modules;
- production Plaid access and OAuth redirects;
- monitoring, alerting, backups, deletion verification;
- accessibility, load testing, incident runbooks;
- privacy policy, terms, and compliance review.

## 11. Testing strategy

- Unit tests for every financial formula and sign convention.
- Property tests ensuring transfers net to zero and splits preserve totals.
- Fixture tests for pending-to-posted transaction replacement.
- Integration tests for cursor pagination, modification, removal, and retries.
- Contract tests against Plaid Sandbox.
- Security tests for authorization boundaries and token leakage.
- Snapshot evaluations for AI structured output, evidence grounding, and
  prohibited claims.
- End-to-end tests for onboarding, correction, budgeting, disconnection, and
  deletion.

Use synthetic data in development and tests. Production financial records must
not be copied into local environments.

## 12. Decisions finalized

- Deployment: Google Cloud.
- Primary region: `us-east1`.
- Access: private single-user application.
- Authentication: Firebase Authentication with one allowlisted Google identity.
- AI: Gemini on Vertex AI, defaulting to a stable Flash-Lite model.
- Debt: connected credit cards and loans plus manually entered loans.
- Investments: account balances included in net worth; holdings and advice
  excluded from the MVP.
