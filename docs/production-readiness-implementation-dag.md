# Milestone 12 export, deletion, recovery, and production readiness DAG

Milestone 12 prepares the application for real financial accounts. The primary
goal is not to rush production creation; it is to prove that data can be
exported, deleted, restored, monitored, and isolated before Plaid Production is
enabled.

## Work drivers

- Data owner control: the owner must be able to export active financial data and
  request deletion without hidden dependencies on Plaid, queues, exports, or AI
  artifacts.
- Destructive workflow safety: deletion must be explicit, idempotent,
  auditable, and retry-safe. A retry must not resurrect data or call Plaid with
  stale token material.
- Provider revocation first: Plaid Items should be revoked before local token
  material is destroyed when the token is still available.
- Queue neutrality: queued tasks must not process deleted connections, deleted
  users, or stale financial records after deletion begins.
- Recovery proof: Cloud SQL backup/restore must be demonstrated in an isolated
  environment before real accounts are connected.
- Environment isolation: production must use separate GCP project resources,
  Plaid credentials, Firebase configuration, KMS keys, secrets, service
  accounts, databases, queues, Artifact Registry, state, and alert routing.
- Least privilege: production IAM should not inherit broad development
  convenience permissions.
- Observable operations: export, deletion, restore, deploy, webhook, sync, AI,
  and alert paths must have runbooks and logs that do not contain sensitive
  financial or provider identifiers.
- Production cost control: production HA, load balancer, Cloud Armor, PITR, and
  alerting decisions must be explicit, reviewed, and tied to a cost expectation.
- Plaid Production gate: do not connect real accounts until Sandbox behavior
  passes on production infrastructure with production isolation but non-real
  data.

## Existing constraints

- The application is single-user, but database and repository methods still use
  explicit `userId` boundaries.
- Development infrastructure already runs through Terraform in
  `infra/environments/dev`.
- Cloud Run deploys use immutable image digests and a manual approval workflow.
- Cloud SQL is private-IP only in development.
- Plaid tokens are encrypted with KMS envelope metadata.
- Cloud Tasks are idempotency-keyed, but Cloud Tasks cannot delete arbitrary
  future deliveries once they have already started; handlers must also check
  deletion/revocation state.
- Development currently uses Plaid Sandbox. Production credentials and real
  account data must remain isolated.
- The production project should be created only after export, deletion, and
  restore paths are proven in development or an isolated test environment.

## DAG

```text
A. Milestone 12 contracts and safety model
   ├─ A1. Export scope and file format contract
   ├─ A2. Deletion state machine
   ├─ A3. Content-free deletion audit schema
   ├─ A4. Task neutralization/idempotency rules
   ├─ A5. Restore validation acceptance criteria
   └─ A6. Production gate checklist

B. CSV export foundation
   ├─ depends on A
   ├─ B1. Define export datasets and redaction rules
   ├─ B2. Export writer for accounts, transactions, balances, budgets, debts,
   │       recommendations, analysis summaries, and metadata
   ├─ B3. Streamed authenticated export endpoint
   ├─ B4. Optional generated export record if async export is needed
   ├─ B5. Export integrity manifest
   └─ B6. Tests for ownership, formatting, and no secret/provider leakage

C. Deletion data model and repository support
   ├─ depends on A
   ├─ C1. Deletion request table or existing task/audit extension
   ├─ C2. Connection/user deletion statuses
   ├─ C3. Content-free completion audit
   ├─ C4. Repository methods for marking deletion started/completed/failed
   ├─ C5. Ordered delete operations and cascade verification
   └─ C6. Tests for idempotent retries and partial-failure recovery

D. Plaid revocation and token destruction
   ├─ depends on C
   ├─ D1. Revoke Plaid Item while encrypted token is available
   ├─ D2. Clear token ciphertext, wrapped data key, nonce, tag, algorithm, and
   │       KMS key metadata after revocation attempt is recorded
   ├─ D3. Treat already-revoked/missing Item as deletion-successful
   ├─ D4. Preserve only content-free failure code when Plaid revocation fails
   └─ D5. Sandbox tests for connection deletion

E. Queue neutralization and deletion worker
   ├─ depends on C and D
   ├─ E1. Deletion Cloud Task payload
   ├─ E2. Worker deletion handler
   ├─ E3. Guard existing sync/analysis/recommendation handlers against deleted
   │       users/connections
   ├─ E4. Cancel or mark obsolete known queued work when possible
   ├─ E5. Idempotent retry and stuck-deletion recovery
   └─ E6. Structured logs and alert metric for deletion failures

F. User-facing deletion and export UX
   ├─ depends on B and E
   ├─ F1. Export action in dashboard/settings
   ├─ F2. Destructive deletion confirmation flow
   ├─ F3. Clear explanation of what is deleted and what content-free audit
   │       remains
   ├─ F4. Deletion progress/status display
   └─ F5. Disable incompatible actions while deletion is active

G. Cloud SQL restore proof
   ├─ depends on C enough to know deletion data boundaries
   ├─ G1. Restore runbook for development Cloud SQL into isolated instance
   ├─ G2. Terraform or scripted isolated restore target
   ├─ G3. Migration and application read-only smoke validation against restore
   ├─ G4. No connection from restore to Plaid, Cloud Tasks, or production
   │       services
   └─ G5. Document restore evidence and cleanup commands

H. Production Terraform environment
   ├─ depends on G and acceptance of production cost model
   ├─ H1. `infra/environments/prod`
   ├─ H2. Separate Terraform state bucket/prefix
   ├─ H3. Separate service accounts, KMS keys, secrets, queues, database,
   │       Artifact Registry, and monitoring
   ├─ H4. Production Cloud SQL HA, backups, PITR, deletion protection
   ├─ H5. Production Cloud Run scaling and database connection limits
   ├─ H6. Production Firebase owner configuration
   └─ H7. Terraform plan CI for production without automatic apply

I. Production networking and edge controls
   ├─ depends on H
   ├─ I1. Decide whether managed Cloud Run URL is acceptable initially
   ├─ I2. If justified, add custom domain, HTTPS load balancer, managed cert,
   │       and Cloud Armor
   ├─ I3. Restrict worker invocation to Cloud Tasks identity
   ├─ I4. Validate Plaid webhook public route and OAuth redirect URLs
   └─ I5. Document expected monthly cost impact

J. Production secrets, Plaid, and Firebase readiness
   ├─ depends on H and I
   ├─ J1. Production Plaid application/secret containers
   ├─ J2. Production Firebase web app and authorized domains
   ├─ J3. Environment-specific webhook URLs
   ├─ J4. OAuth redirect review for institutions that require OAuth
   ├─ J5. Secret rotation and break-glass recovery notes
   └─ J6. Validate no production secret values enter Terraform state

K. Security and privacy review
   ├─ depends on B through J
   ├─ K1. Threat model for auth, Plaid, deletion, export, restore, and admin
   │       operations
   ├─ K2. Dependency vulnerability review
   ├─ K3. Secret and log redaction review
   ├─ K4. IAM least-privilege review
   ├─ K5. Browser/session security review
   └─ K6. Production access approval record

L. Production Sandbox acceptance
   ├─ depends on H, I, J, and K
   ├─ L1. Deploy production infrastructure with Sandbox Plaid credentials first
   ├─ L2. Run migrations
   ├─ L3. Connect Sandbox institution through production URL
   ├─ L4. Verify sync, webhook, classification, split, analysis,
   │       recommendations, export, deletion, and restore runbooks
   ├─ L5. Verify owner alert delivery
   └─ L6. Explicit decision to request/enable Plaid Production credentials
```

## Proposed PR sequence

1. Milestone 12 DAG and work drivers: this document.
2. Export contracts and CSV writer: `A + B1 + B2 + B6`.
3. Authenticated export endpoint and dashboard action: `B3 + F1`.
4. Deletion safety model and persistence: `A2 + A3 + C`.
5. Plaid revocation and token destruction: `D`.
6. Deletion Cloud Task worker and task guardrails: `E`.
7. User-facing deletion flow: `F2` through `F5`.
8. Restore runbook and isolated restore validation: `G`.
9. Production Terraform environment skeleton: `H1` through `H3`.
10. Production Cloud SQL, IAM, secrets, and monitoring hardening: `H4` through
    `H7 + J`.
11. Production edge/network decision and implementation if justified: `I`.
12. Threat model, dependency/secret review, and production approval record: `K`.
13. Production Sandbox acceptance checklist and Plaid Production application
    package: `L`.

The final PR that proves `L` should close Milestone 12.

## Initial export scope

Start with a zipped CSV export containing:

- `manifest.json` with export time, app version, schema version, row counts, and
  checksum metadata;
- `accounts.csv`;
- `account_balances.csv`;
- `transactions.csv`;
- `transaction_splits.csv`;
- `classification_rules.csv`;
- `manual_loans.csv` or equivalent debt fields;
- `budgets.csv`;
- `analysis_snapshots.csv`;
- `recommendations.csv`;
- `connections.csv` with provider names and connection status but without
  Plaid Item IDs, provider account IDs, account masks, token material, or full
  webhook payloads.

Defer PDF, OFX/QFX, encrypted archive passwords, and scheduled recurring export.

## Initial deletion scope

Deletion should remove or irreversibly neutralize:

- Plaid connection token material;
- connected accounts and balances;
- transactions, splits, transfer matches, and classifications;
- manual accounts/debts/budgets/goals;
- analysis snapshots/jobs;
- recommendations;
- generated exports;
- queued or retryable application work for the deleted user/connection.

Deletion may retain only content-free operational facts such as:

- deletion request ID;
- started/completed timestamps;
- final status;
- high-level failure code if incomplete;
- actor type `owner`;
- app version or migration version.

Do not retain merchant names, amounts, account names, masks, provider IDs,
Plaid Item IDs, transaction IDs, recommendation text, analysis narrative, or
prompt/output bodies in deletion audit records.

## Production connection gate

Real account connection is blocked until:

- export is verified from the production URL using non-real data;
- deletion is verified end to end using Sandbox data;
- Cloud SQL restore is demonstrated in isolation;
- production secrets, KMS keys, database, task queues, and Plaid credentials
  are isolated from development;
- production alert notifications reach the owner;
- no unresolved critical/high security findings remain;
- Plaid Sandbox flows pass on production infrastructure;
- OAuth redirect and webhook URLs are correct for the production domain;
- a written approval decision records that real account connection is allowed.

## Explicit non-goals for this milestone

- Multi-user SaaS hardening.
- Paid public launch.
- Tax, legal, investment, or insurance advice.
- Long-term analytics warehouse.
- Mobile app.
- Automated real-money actions.
