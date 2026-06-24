# GCP Architecture

## 1. Deployment decision

Finance Manager will be internet-hosted on Google Cloud. Use managed,
serverless infrastructure for the MVP so operational work remains focused on
financial correctness and security rather than cluster management.

It is a private single-user application. Public registration is disabled and
only one configured Google identity can create an application session.

Provision separate GCP projects:

- `finance-dev` for Plaid Sandbox and synthetic data;
- `finance-prod` for real users and Plaid Production.

Do not share databases, secrets, KMS keys, task queues, service accounts, or
storage buckets between environments.

Create `finance-dev` first. Create `finance-prod` only after Sandbox
synchronization, webhook, deletion, and restore tests pass. This avoids paying
for idle production infrastructure while foundational behavior is incomplete.

## 2. Runtime topology

```text
Internet
   |
   +--> Development: Cloud Run managed HTTPS URL
   |
   +--> Production: global external HTTPS load balancer
                         |-- Google-managed TLS certificate
                         |-- Cloud Armor rate limits and protections
                         v
Cloud Run: web
   |-- Next.js UI and authenticated API
   |-- Firebase Authentication token verification
   |-- public Plaid webhook endpoint
   |-- Plaid Link token and token exchange
   |
   +--> Cloud SQL for PostgreSQL
   +--> Cloud Tasks queues
   +--> Secret Manager
   +--> Cloud KMS
   +--> Plaid and configured AI provider

Cloud Tasks --OIDC--> Cloud Run: worker
                       |-- ingress restricted
                       |-- IAM invocation required
                       |-- sync, classify, calculate, forecast, recommend
                       +--> Cloud SQL / Plaid / AI provider

Cloud Scheduler --> authenticated maintenance endpoint or Cloud Run Job

CI --> Artifact Registry --> Cloud Run revisions
```

The worker is an HTTP-based Cloud Run service rather than a continuously
running process. Each task invokes one idempotent handler. This matches Cloud
Run's request lifecycle and avoids paying for an idle worker.

## 3. GCP service mapping

| Concern | GCP service | Decision |
|---|---|---|
| Web and API | Cloud Run service | Managed URL in development; production through HTTPS load balancer |
| Async handlers | Cloud Run service | Private, IAM-authenticated invocation |
| Durable task delivery | Cloud Tasks | Separate queues by workload and retry policy |
| Scheduled work | Cloud Scheduler | Daily reconciliation and periodic cleanup |
| Bounded batch work | Cloud Run Jobs | Migrations, backfills, and repair operations |
| Database | Cloud SQL for PostgreSQL | Regional production instance with automated backups |
| Images | Artifact Registry | Immutable image digest deployed to Cloud Run |
| API credentials | Secret Manager | Versioned Plaid, auth, and AI secrets |
| Token encryption | Cloud KMS | Environment-specific key ring and token-encryption key |
| Logs and metrics | Cloud Logging and Monitoring | Redacted structured logs, dashboards, alerts |
| Traces and failures | Cloud Trace and Error Reporting | Correlate web, task, database, and provider calls |
| Infrastructure | Terraform | Reviewed, repeatable environment creation |

## 4. Region and availability

Use `us-east1` as the primary region for latency-sensitive services. Keep Cloud
Run, Cloud SQL, Cloud Tasks, KMS, Artifact Registry, and Vertex AI resources in
`us-east1` wherever each service supports regional placement. Globally scoped
services such as DNS and the external HTTPS load balancer remain global.

For production:

- use a regional Cloud SQL high-availability configuration;
- enable automated backups and point-in-time recovery;
- keep Cloud Run, Cloud Tasks, KMS, and the database in the same region where
  the service supports regional placement;
- define a tested restore process before onboarding real financial accounts.

Development can use a smaller zonal Cloud SQL instance to control cost.

## 5. Networking

- Put Cloud SQL on private IP.
- Connect Cloud Run to the VPC using Direct VPC egress where supported.
- Allow database access only from workload service accounts and approved
  network paths.
- Restrict the worker service to authenticated internal/service-to-service
  invocation.
- In production, configure the web service so users reach it through the load
  balancer rather than bypassing its security controls through the default URL.
- In development, use the managed Cloud Run HTTPS URL to avoid premature load
  balancer cost and complexity.
- Keep outbound internet access for Plaid and the AI provider. Add a static
  outbound IP only if a provider or policy later requires allowlisting.

The Plaid webhook route must be public HTTPS. It should acknowledge valid
events quickly, persist the event fingerprint, enqueue work, and return without
performing synchronization inline.

## 6. Cloud Tasks design

Use queues with different rate and retry characteristics:

- `plaid-sync`: one active sync per connection, provider-aware rate limits;
- `classification`: transaction normalization and transfer matching;
- `calculation`: metric, budget, forecast, and debt-plan recalculation;
- `ai-analysis`: low concurrency, explicit cost and timeout limits;
- `deletion`: auditable user and connection deletion workflow.

Each task includes an internal record ID, operation name, schema version, and
idempotency key—not financial records or provider tokens. The worker loads
required data from the database.

Cloud Tasks provides at-least-once delivery, so handlers must:

- authenticate the invoking service account;
- reject invalid task schemas;
- claim an idempotency key transactionally;
- tolerate retries and out-of-order delivery;
- return success only after durable state is committed;
- send permanently failing work to an application-level failure table and
  alerting workflow.

Use Cloud Run Jobs instead of Cloud Tasks when work is a controlled migration,
large backfill, or batch repair that should run to completion.

## 7. Database configuration

Cloud SQL is the source of truth. Configure:

- PostgreSQL in the same region as Cloud Run;
- private IP and encrypted connections;
- production high availability;
- automated daily backups and point-in-time recovery;
- deletion protection in production;
- connection pooling sized against both Cloud Run maximum instances and the
  database connection limit;
- a low Cloud Run maximum-instance cap initially to prevent autoscaling from
  exhausting database connections.

Run schema migrations as a dedicated Cloud Run Job using a migration service
account. Application startup must not run migrations.

Plaid access tokens are ciphertext in PostgreSQL. Encrypt each token using a
data-encryption key and wrap that key with Cloud KMS. Store the ciphertext,
wrapped key, algorithm/version, and key-resource identifier.

## 8. Identity and IAM

Create separate service accounts:

- `web-runtime`: database access, task creation, selected secrets, KMS encrypt;
- `worker-runtime`: database access, selected secrets, KMS encrypt/decrypt;
- `scheduler-invoker`: invoke only maintenance targets;
- `migration-runtime`: database migration access;
- `deploy-ci`: publish images and deploy approved services;
- `tasks-invoker`: invoke only the worker service.

Do not grant project-wide Editor or Owner roles to runtime or CI identities.
Use Workload Identity Federation for CI rather than storing a long-lived GCP
service-account key.

Use Firebase Authentication with Google Sign-In for the owner:

- disable public email/password and anonymous registration;
- configure one immutable Firebase UID as the application owner;
- optionally also check the expected Google email, but use the UID as the
  primary authorization identity;
- verify Firebase ID tokens on the server and exchange them for secure,
  HTTP-only application sessions;
- reject every authenticated identity other than the configured owner;
- enable Identity Platform only if its MFA, blocking functions, audit features,
  or SLA are needed.

For one social-sign-in user, authentication should remain within the documented
free monthly-active-user tier. Avoid SMS MFA as the default because it adds
message charges; protect the Google account with passkeys or authenticator-based
two-step verification instead. Application authentication remains separate
from GCP service IAM.

## 9. Secret and key handling

Secret Manager stores:

- Plaid client ID and environment-specific secret;
- authentication secrets;
- AI-provider credentials;
- webhook-verification configuration;
- other application credentials.

The allowlisted Firebase owner UID is deployment configuration rather than a
secret, but changes to it require the same review and audit controls as a
security policy change.

Cloud Run identities receive access only to the exact secret versions they
need. Do not place secret values in Terraform state, container images, build
arguments, logs, or ordinary environment configuration.

Use Cloud KMS for application-level encryption of Plaid access tokens. Rotate
the KMS key on a defined schedule and retain old enabled key versions until all
dependent ciphertext has been rewrapped and verified.

## 10. Delivery pipeline

Recommended pipeline:

1. pull-request checks run linting, type checks, unit tests, migration checks,
   security scans, and finance-engine fixture tests;
2. merge builds one reproducible container image;
3. push the image to Artifact Registry;
4. deploy by immutable image digest to the development Cloud Run services;
5. execute the migration job;
6. run Sandbox smoke tests;
7. require explicit approval for production;
8. run the production migration job, deploy without traffic, smoke test, then
   shift traffic to the new revision.

Terraform changes receive a plan in CI and require approval before production
apply. Prefer GitHub Actions with Workload Identity Federation if source code
is hosted on GitHub; Cloud Build is also viable if tighter GCP integration is
preferred.

## 11. Observability

Create dashboards and alerts for:

- web latency, error rate, instance count, and cold starts;
- task queue depth, oldest task age, retries, and permanent failures;
- Plaid sync freshness, webhook failures, and reconnect-required Items;
- Cloud SQL CPU, memory, storage, connections, replication, and backup status;
- AI request count, latency, structured-output failures, and estimated cost;
- recommendation generation freshness;
- authentication failures and suspicious request rates.

Use correlation IDs across webhook receipt, task creation, worker execution,
and provider calls. Logs must use internal opaque IDs and must not include
Plaid access tokens, raw transaction descriptions, complete webhook payloads,
or model prompts containing financial details.

## 12. Cost controls

For development:

- allow Cloud Run to scale to zero;
- use small Cloud SQL capacity;
- use Plaid Sandbox and synthetic transactions;
- disable unnecessary AI calls and set strict request budgets.

For production:

- begin with one minimum web instance only if cold-start latency is materially
  harmful;
- cap web and worker maximum instances based on database capacity;
- cap AI queue dispatch rate and per-user analysis frequency;
- use the current stable Gemini Flash-Lite model through Vertex AI by default;
- invoke Gemini only from background analysis jobs and reuse results until
  their evidence changes;
- omit search grounding, embeddings, vector search, model tuning, and agents;
- configure budget alerts at project and service levels;
- retain logs according to a deliberate policy rather than indefinitely.

Cloud SQL is expected to be the main fixed infrastructure cost in the MVP.
Firebase Authentication should be effectively free for one monthly active user.
Vertex AI should be a small variable cost if prompts contain only compact
aggregates and analysis is generated weekly or after material changes.

## 13. Disaster recovery and deletion

- Document target recovery point and recovery time objectives.
- Test point-in-time database restoration into an isolated project.
- Keep infrastructure reproducible from Terraform.
- Ensure user deletion removes active database rows, queued work, encrypted
  tokens, generated exports, and provider connections.
- Document when deleted data expires from backups and logs.
- Audit deletion completion without retaining the deleted financial content.

## 14. Initial infrastructure milestone

The first infrastructure increment should provision:

1. development GCP project configuration and required APIs;
2. VPC and private Cloud SQL PostgreSQL;
3. KMS key ring/key and Secret Manager placeholders;
4. Artifact Registry;
5. web and worker Cloud Run services with distinct identities;
6. Cloud Tasks queues and authenticated invocation;
7. a migration Cloud Run Job;
8. baseline monitoring, budget alerts, and log exclusions.

Production should be created from the same Terraform modules only after the
Sandbox flow, deletion workflow, and restore test pass end to end. DNS, the
HTTPS load balancer, managed certificate, and Cloud Armor belong to production
hardening unless a development-specific need justifies their cost earlier.
