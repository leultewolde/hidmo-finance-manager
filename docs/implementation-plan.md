# Implementation Plan

## 1. How to use this plan

Build the project in vertical, testable increments. Do not provision all cloud
infrastructure before the financial behavior works, and do not connect real
accounts before Sandbox synchronization, deletion, and secret handling have
been verified.

Each milestone has:

- a concrete outcome;
- implementation work;
- a completion gate;
- concepts to learn at that point;
- work intentionally postponed.

Complete a gate before starting the next milestone. A partially working Plaid
integration combined with partially working cloud infrastructure is difficult
to diagnose, especially when both platforms are new.

## 2. Development environments

Use three environments with different purposes:

| Environment | Runtime | Database | Plaid | Financial data |
|---|---|---|---|---|
| Local | developer machine | local PostgreSQL container | Sandbox | synthetic only |
| Development | GCP `finance-dev` | development Cloud SQL | Sandbox, then Development | synthetic/test accounts |
| Production | GCP `finance-prod` | production Cloud SQL | Production | real owner data |

Never use production credentials locally. Never copy production financial data
into local or development databases.

## 3. Recommended build sequence

### Milestone 0: accounts, tools, and safety baseline

**Outcome:** the development machine, GCP account, and Plaid account are ready,
but no paid infrastructure or real account connection exists.

Tasks:

1. Install or verify:
   - Git;
   - Node.js current LTS;
   - Corepack and pnpm;
   - Docker Desktop or another Docker-compatible runtime;
   - Google Cloud CLI;
   - Terraform;
   - PostgreSQL client tools;
   - a password manager.
2. Create a Plaid developer account and obtain Sandbox credentials.
3. Create a GCP billing account if one does not exist.
4. Create only the development GCP project initially.
5. Attach billing and create low budget alerts before provisioning resources.
6. Enable passkeys or strong two-step verification on the owner Google account.
7. Record local tool versions in `.tool-versions`, `.nvmrc`, or equivalent
   repository files during scaffolding.

Completion gate:

- `node`, `pnpm`, `docker`, `gcloud`, `terraform`, and `psql` run locally;
- `gcloud auth list` shows the intended Google account;
- the Plaid Dashboard is accessible;
- a development budget alert exists;
- no Plaid secret has been committed to source control.

Learn now:

- GCP project versus billing account;
- user identity versus service account;
- Plaid Sandbox versus Development versus Production.

Postpone:

- production GCP project;
- custom domain;
- load balancer and Cloud Armor;
- production Plaid application.

### Milestone 1: repository and local application skeleton

**Outcome:** one command starts the web app, worker, and local database, and CI
can verify the empty system.

Create this structure:

```text
apps/web
apps/worker
packages/contracts
packages/database
packages/finance-engine
packages/classification
packages/plaid
packages/ai
infra/modules
infra/environments/dev
infra/environments/prod
```

Implementation work:

1. Initialize a pnpm workspace.
2. Create a Next.js TypeScript web application.
3. Create a small Node HTTP worker application.
4. Add shared TypeScript, ESLint, formatting, and test configuration.
5. Add Docker Compose for local PostgreSQL only.
6. Add environment parsing with Zod. Application startup must fail with a
   useful message when required configuration is missing.
7. Add `/api/health/live` and `/api/health/ready`.
8. Add structured logging with a redaction list.
9. Add CI for install, lint, type-check, test, and build.
10. Commit `.env.example`; ignore all real `.env*` files.

Completion gate:

- a clean checkout can follow the README and start locally;
- all workspace packages build;
- health endpoints pass;
- CI passes;
- logs contain no complete environment dump.

Learn now:

- monorepo workspace dependencies;
- process environment variables;
- liveness versus readiness.

Postpone:

- authentication;
- Plaid;
- GCP deployment;
- detailed UI.

### Milestone 2: financial domain and deterministic engine

**Outcome:** financial calculations work entirely from synthetic fixtures before
external account data is introduced.

Implementation work:

1. Define money as integer minor units plus ISO currency. Do not use JavaScript
   floating-point values for stored financial amounts.
2. Implement the internal sign convention and document examples.
3. Define account classes, transaction economic types, categories, debts, and
   transfer pairs.
4. Implement:
   - asset and liability totals;
   - net worth;
   - liquid cash;
   - income, expense, and savings totals;
   - credit utilization;
   - debt payoff calculation;
   - budget variance.
5. Create synthetic fixture households covering:
   - checking and savings;
   - credit-card purchases and payments;
   - refunds;
   - payroll;
   - personal and auto loans;
   - brokerage/retirement balances;
   - pending and posted duplicates.
6. Add property tests:
   - matched transfers have zero economic impact;
   - transaction splits preserve the original total;
   - adding principal repayment reduces cash and debt consistently;
   - calculations are independent of input ordering.

Completion gate:

- every displayed MVP metric has a versioned formula and tests;
- a credit-card payment is not counted as new spending;
- investment balances affect net worth but not liquid cash;
- no engine package imports Plaid, Firebase, React, or Vertex AI.

Learn now:

- double-entry intuition even though this is not full accounting;
- integer money representation;
- pure functions and property testing.

### Milestone 3: database schema and repositories

**Outcome:** normalized synthetic financial data can be stored, queried, and
recalculated reliably.

Implementation work:

1. Add Drizzle and migration tooling.
2. Implement the tables in the technical design.
3. Add constraints:
   - unique provider IDs within a connection;
   - unique accepted transfer participation;
   - valid currency and amount rules;
   - one configured owner;
   - foreign-key ownership paths.
4. Add raw-provider metadata only where required for debugging and
   reconciliation; do not create a permanent unrestricted payload dump.
5. Add repository interfaces so finance calculations do not query the database
   directly.
6. Add migration tests against a blank database and a previous schema.
7. Add seed commands for synthetic fixtures.

Completion gate:

- migrations can build a blank local database;
- rerunning fixture import does not create duplicates;
- dashboard aggregates reconcile to fixture expectations;
- rollback/recovery instructions exist for failed development migrations.

Learn now:

- migration versus application startup;
- unique constraints as an idempotency tool;
- transaction boundaries.

### Milestone 4: Firebase owner authentication

**Outcome:** only the configured Google identity can access private application
routes.

Implementation work:

1. Add Firebase to `finance-dev`.
2. Enable Google Sign-In only.
3. Sign in once and record the owner Firebase UID as deployment configuration.
4. Implement browser sign-in.
5. Verify Firebase ID tokens on the server.
6. Exchange a verified ID token for a secure HTTP-only application session.
7. Enforce the owner UID in one centralized authorization function.
8. Protect all routes except:
   - liveness;
   - readiness as appropriate;
   - the Plaid webhook;
   - authentication callback/session endpoints.
9. Add tests for no token, expired token, valid wrong user, and owner.

Completion gate:

- the owner can sign in;
- a second Google identity is rejected even if Firebase authenticates it;
- private API routes cannot select a user ID supplied by the browser;
- cookies are `Secure`, `HttpOnly`, and appropriately `SameSite` in deployed
  environments.

Learn now:

- authentication proves identity;
- authorization decides access;
- Firebase ID token versus application session cookie.

### Milestone 5: Plaid Sandbox connection

**Outcome:** the owner can connect a Sandbox institution and the server stores
an encrypted access token.

Implementation work:

1. Add the official Plaid Node client behind `packages/plaid`.
2. Configure Sandbox credentials locally outside source control.
3. Implement server-side `/link/token/create`.
4. Add Plaid Link to the authenticated browser UI.
5. Send the returned public token to the server.
6. Exchange it server-side with `/item/public_token/exchange`.
7. Implement a local development token cipher abstraction.
8. Store Item and account metadata, never the access token in browser state or
   logs.
9. Fetch `/accounts/get` and display connected accounts.
10. Implement connection removal using Plaid `/item/remove` followed by local
    cleanup.

Completion gate:

- Sandbox Link completes;
- refreshing the page displays stored accounts;
- browser network responses contain no access token;
- logs contain no public token, access token, or full account identifiers;
- disconnecting removes provider access and local connection data.

Learn now:

- Link token, public token, access token, Item, institution, and account;
- why public-token exchange is a server operation;
- provider adapter boundaries.

### Milestone 6: incremental transaction synchronization

**Outcome:** Sandbox transactions synchronize idempotently using the Plaid
cursor model.

Implementation work:

1. Implement a task record and local task runner before Cloud Tasks.
2. Implement `/transactions/sync` pagination.
3. Apply added, modified, and removed transactions in a database transaction.
4. Save the final cursor only after all pages commit.
5. Handle pending-to-posted transaction replacement.
6. Add per-connection synchronization locking.
7. Add retries for transient failures and explicit states for Item errors.
8. Import at least 180 days where Plaid and the institution support it.
9. Add sync status and last-successful-sync UI.
10. Create contract fixtures from sanitized Sandbox responses.

Completion gate:

- running sync twice produces identical database state;
- added, modified, removed, and pending-to-posted cases are tested;
- an interrupted page sequence can retry safely;
- raw Plaid amount signs are converted once at the normalization boundary.

Learn now:

- cursor pagination;
- idempotency;
- retryable versus permanent errors;
- provider data versus normalized data.

### Milestone 7: classification, transfer matching, and corrections

**Outcome:** the transaction list produces trustworthy spending and income
totals.

Implementation work:

1. Import Plaid categories as suggestions.
2. Apply the classification precedence defined in product design.
3. Implement transfer matching with amount/date/account constraints.
4. Add specialized credit-card payment matching.
5. Add transaction correction and split UI.
6. Add user-defined future rules.
7. Add an “unknown/review” queue.
8. Recalculate affected periods when classifications change.

Completion gate:

- all synthetic transfer cases reconcile to zero income/expense impact;
- corrections survive re-sync;
- provider updates do not overwrite user overrides;
- reviewed and unreviewed totals are visibly distinguishable.

### Milestone 8: first GCP development deployment

**Outcome:** the authenticated skeleton, database, and Plaid Sandbox flow run in
`finance-dev`.

Status: complete for the development environment.

Completed foundation:

1. Terraform modules define APIs, service accounts, Artifact Registry, Secret
   Manager, KMS, Cloud SQL, Cloud Run, Cloud Tasks, remote state, and deployment
   identities.
2. The app deploys using the Cloud Run service URL. Do not add a global load
   balancer or Cloud Armor yet.
3. Cloud SQL is private-IP only and uses the low-cost dev configuration.
4. Web and worker deploy separately.
5. Migrations run as a Cloud Run Job.
6. Plaid and database credentials are stored in Secret Manager.
7. Plaid token encryption has a Cloud-ready KMS path.
8. Cloud Tasks invokes the private worker with OIDC.
9. Manual deploys use immutable image digests, smoke tests, GitHub environment
   approval, and automatic `DEV_*_IMAGE` variable recording.
10. Remote Terraform state and PR Terraform plans are active.

Completion gate:

- Terraform can reproduce development infrastructure. Done.
- Web service reaches Cloud SQL. Done.
- Worker cannot be invoked anonymously. Done.
- A Cloud Task invokes the worker successfully. Done.
- KMS encrypt/decrypt works only for intended service accounts. Done.
- Plaid Sandbox Link and sync work through the deployed URL. Done.
- Budget alerts and basic error alerts exist. Baseline budget/logging exists;
  richer application alerts continue in later operations work.

Learn now:

- infrastructure state;
- IAM roles and service accounts;
- Cloud Run revisions;
- Secret Manager versus environment variables;
- at-least-once task delivery.

### Milestone 9: asynchronous Plaid sync, webhooks, and reconciliation

**Outcome:** Plaid synchronization becomes an asynchronous, retry-safe workflow.
Manual sync, initial sync, Plaid webhooks, and scheduled reconciliation all
enqueue work instead of doing provider synchronization inside web requests.

Implementation work:

1. Define the Plaid sync task payload contract.
2. Move the existing Plaid `/transactions/sync` runner from web-only execution
   into the worker.
3. Change initial sync and **Sync now** to enqueue a Cloud Task and return a
   task/status response quickly.
4. Add task status reads for queued, running, completed, failed, and
   reconnect-required states.
5. Update the dashboard to show sync status and clear retry/reconnect messages.
6. Make task processing idempotent across Cloud Tasks retries and duplicate
   enqueue attempts.
7. Add the deployed HTTPS webhook URL to Link token creation.
8. Verify Plaid webhook signatures using the current official mechanism.
9. Persist webhook event fingerprints and minimal metadata.
10. Return quickly from webhooks after enqueueing sync work.
11. Test duplicate and replayed webhook handling.
12. Use Plaid Sandbox tools to trigger transaction update webhooks.
13. Add a daily Cloud Scheduler reconciliation task.
14. Alert when an Item has not synchronized within the expected period.

Completion gate:

- manual **Sync now** enqueues a task and does not run Plaid sync inline;
- initial post-Link sync enqueues a task;
- worker task execution updates transactions, classifications, and sync status;
- duplicate Cloud Task delivery has no duplicate financial effect;
- a Sandbox webhook causes a sync;
- duplicate webhook delivery has no duplicate financial effect;
- invalid signature requests are rejected;
- missed-webhook simulation is repaired by scheduled reconciliation.

First work driver:

1. Implement `plaid.transactions.sync` Cloud Task payload and worker handler.
2. Add a web enqueue service and status endpoint.
3. Convert **Sync now** to enqueue and display task status.
4. Keep the old inline runner callable only from the worker path after the
   migration is complete.

### Milestone 10: debts, investments, dashboard, and budget

**Outcome:** the application provides the complete non-AI financial picture.

Implementation work:

1. Import connected credit-card and supported liability details.
2. Treat connected personal/auto/student loan accounts as debt even when
   detailed liability fields are unavailable.
3. Add manual completion and manual loan screens.
4. Store field-level provenance and user overrides.
5. Include connected brokerage and retirement account-level values in net
   worth.
6. Implement dashboard, cash flow, debt plan, budget, and forecast.
7. Implement recurring income and expense detection.
8. Add data freshness and confidence indicators.

Completion gate:

- net worth reconciles to all latest asset and liability balances;
- liquid cash excludes investment and retirement values;
- missing APR/payment data is visible rather than guessed;
- payoff scenarios pass fixture tests;
- budget actuals derive from normalized transactions.

### Milestone 11: deterministic recommendations and Vertex AI

**Outcome:** recommendations are evidence-based, and Gemini explains rather
than calculates.

Implementation work:

1. Implement recommendation candidates as deterministic policies.
2. Create a minimized aggregate input schema.
3. Add evidence IDs and reject unknown evidence references.
4. Integrate Vertex AI through `packages/ai`.
5. Pin a stable Gemini Flash-Lite model supported in `us-east1`.
6. Require structured output and validate it with Zod.
7. Cache analysis until evidence changes.
8. Add weekly analysis scheduling and manual refresh with cooldown.
9. Track token use, latency, schema failures, and estimated cost.
10. Build an evaluation fixture set for groundedness and prohibited claims.

Completion gate:

- disabling Vertex AI does not change financial totals;
- prompts contain no access tokens, account identifiers, raw descriptions, or
  owner identity;
- every narrative claim references supplied evidence;
- malformed or ungrounded output is rejected safely;
- repeated dashboard loads do not trigger model calls.

### Milestone 12: deletion, export, and production readiness

**Outcome:** the system is safe enough to request Plaid Production access and
connect the owner's real accounts.

Implementation work:

1. Build CSV export.
2. Build the complete deletion workflow:
   - revoke Plaid Items;
   - cancel or neutralize queued tasks;
   - delete active financial records;
   - delete generated exports;
   - retain only a content-free completion audit.
3. Test Cloud SQL restore into an isolated environment.
4. Add operational dashboards and incident runbooks.
5. Create `finance-prod` from the same Terraform modules.
6. Use a production HA Cloud SQL configuration and point-in-time recovery.
7. Add custom domain, HTTPS load balancer, and Cloud Armor if their cost and
   protections are justified for production.
8. Complete Plaid Production application requirements.
9. Review OAuth redirect configuration for institutions that require OAuth.
10. Perform a threat-model review and dependency/secret scans.

Production connection gate:

- no unresolved critical/high security findings;
- deletion passes end to end;
- backup restoration is demonstrated;
- Plaid secrets and KMS permissions are production-specific;
- owner authentication and recovery are tested;
- alerts reach the owner;
- all Sandbox acceptance tests pass in production infrastructure before real
  credentials are enabled.

## 4. Suggested issue backlog

Create one tracked issue per item rather than one issue per milestone. Label
issues by `area` and `milestone`.

Initial issue order:

1. Scaffold pnpm workspace.
2. Add local PostgreSQL and environment validation.
3. Add CI and health endpoints.
4. Define money, account, transaction, and debt contracts.
5. Implement net-worth and cash-flow engine.
6. Add transfer and debt fixtures.
7. Add Drizzle schema and migrations.
8. Add Firebase owner authentication.
9. Add Plaid Link token endpoint.
10. Add public-token exchange and encrypted connection storage.
11. Add account import.
12. Add transaction synchronization.
13. Add transfer matching and corrections.
14. Add development Terraform foundation.
15. Deploy web, worker, migrations, Cloud SQL, KMS, and tasks.
16. Add Plaid webhook processing.
17. Add debts and investment account values.
18. Add dashboard and budget.
19. Add deterministic recommendation policies.
20. Add Vertex AI narrative generation.
21. Add export, deletion, restore test, and production infrastructure.

## 5. Definition of done for every issue

An issue is done only when:

- behavior is implemented;
- tests appropriate to its financial/security risk pass;
- errors are actionable and secrets are redacted;
- documentation and `.env.example` are updated;
- authorization is checked for any private route;
- migrations are included for schema changes;
- operational effects and retry behavior are understood;
- the acceptance condition can be demonstrated.

## 6. Cost strategy

Do not rely on budget alerts to stop charges; GCP budgets notify but do not
automatically cap normal service usage.

Primary controls:

- create Cloud SQL late in the development sequence;
- use a small development instance and no development HA;
- cap Cloud Run maximum instances;
- allow development Cloud Run services to scale to zero;
- keep log retention deliberate;
- rate-limit AI tasks;
- use Flash-Lite and compact aggregate prompts;
- run AI weekly or after material changes, not per page view;
- defer load balancer and Cloud Armor until production hardening;
- review the billing report after every new managed service is enabled.

## 7. Where to stop and ask for review

Do not proceed automatically past these boundaries:

1. before applying Terraform that creates billable GCP resources;
2. before enabling a new paid Plaid product;
3. before adding real financial credentials;
4. before creating the production project;
5. before changing owner UID or authentication policy;
6. before enabling a more expensive Gemini model;
7. before deleting production financial records.
