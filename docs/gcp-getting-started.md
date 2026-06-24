# GCP Beginner Guide

## 1. Mental model

The main GCP concepts used by this project are:

- **Billing account:** the payment relationship. Projects are attached to it.
- **Project:** an isolation, permissions, API, and billing boundary.
- **API:** a GCP service must usually be enabled in a project before use.
- **User account:** your human Google identity.
- **Service account:** a machine identity used by Cloud Run, Cloud Tasks, CI,
  and migrations.
- **IAM role:** a named set of permissions granted to an identity.
- **Region:** the geographical location for regional resources. This project
  uses `us-east1`.
- **Cloud Run service:** an HTTPS container application that can scale down.
- **Cloud Run Job:** a container that runs bounded work and exits.
- **Cloud SQL:** managed PostgreSQL; unlike Cloud Run, it is a persistent billed
  resource.
- **Secret Manager:** controlled storage for API secrets.
- **Cloud KMS:** cryptographic key operations; the app uses it to protect Plaid
  access tokens.
- **Cloud Tasks:** durable HTTP work delivery with retries.

The development and production projects are separate security boundaries, not
just two configuration files.

## 2. Bootstrap approach

Use a two-step setup:

1. perform the minimum account/project bootstrap manually;
2. manage application infrastructure with Terraform.

Terraform cannot conveniently create its own permissions, billing relationship,
and remote state foundation without some bootstrap. After bootstrap, avoid
clicking ad-hoc production changes in the console; make reviewed Terraform
changes instead.

## 3. Create the development project

Choose a globally unique project ID. Examples in this guide use:

```text
YOUR_FINANCE_DEV_PROJECT_ID
```

Do not put your name, email, account number, or other sensitive information in
the project ID. A project ID is visible in many resource names and cannot be
changed after creation.

In the Google Cloud console:

1. Open **Manage resources**.
2. Select **Create project**.
3. Use a descriptive name such as `Finance Manager Dev`.
4. Choose a unique project ID.
5. Attach the billing account.
6. Confirm the active project in the console header before making changes.

Do not create production yet.

## 4. Create budget alerts first

In **Billing → Budgets & alerts**:

1. create a budget scoped to the development project;
2. start with a low amount matching your acceptable experiment spend;
3. configure alerts at multiple thresholds, for example 50%, 90%, and 100%;
4. confirm the notification email address.

Important: a budget alert is not a hard spending limit. It sends notifications.
Preventing or automatically disabling usage requires additional controls and
can cause destructive outages, so this project uses service caps plus alerts.

After adding each major service, check **Billing → Reports** the following day
and identify the new line item.

## 5. Configure the local CLI

Install the Google Cloud CLI using Google's instructions for the operating
system, then:

```bash
gcloud auth login
gcloud config set project YOUR_FINANCE_DEV_PROJECT_ID
gcloud config set run/region us-east1
gcloud auth application-default login
```

Meanings:

- `gcloud auth login` authenticates CLI commands as you.
- `gcloud config set project` reduces accidental work in the wrong project.
- Application Default Credentials allow supported local Google client
  libraries and Terraform workflows to use your developer identity.

Verify:

```bash
gcloud auth list
gcloud config list
gcloud projects describe YOUR_FINANCE_DEV_PROJECT_ID
```

Always check the active project before a create, update, or delete command.

## 6. Enable services deliberately

Terraform should eventually enable required APIs. During early experiments,
the expected APIs include:

```text
artifactregistry.googleapis.com
cloudbuild.googleapis.com
run.googleapis.com
sqladmin.googleapis.com
secretmanager.googleapis.com
cloudkms.googleapis.com
cloudtasks.googleapis.com
cloudscheduler.googleapis.com
compute.googleapis.com
servicenetworking.googleapis.com
aiplatform.googleapis.com
firebase.googleapis.com
identitytoolkit.googleapis.com
logging.googleapis.com
monitoring.googleapis.com
```

Enabling an API usually does not itself create substantial cost, but creating
resources behind it can. Record every enabled API in Terraform.

## 7. Add Firebase Authentication

Firebase can use the existing GCP project:

1. Open the Firebase console.
2. Add Firebase to the development GCP project.
3. Register a web application.
4. Copy the public web configuration into development configuration. Firebase
   web configuration identifies the project; it is not equivalent to a Plaid
   secret.
5. Open **Authentication → Sign-in method**.
6. Enable Google.
7. Do not enable anonymous or email/password registration.
8. Add authorized domains for local development and the deployed development
   hostname.
9. Sign in once, inspect the authenticated Firebase user, and record the
   immutable UID intended as the owner.

The application must still enforce that UID. Enabling only Google Sign-In does
not make the application single-user; any Google user could otherwise
authenticate.

## 8. Terraform layout and state

Use reusable modules with separate environment roots:

```text
infra/
  modules/
    project-services/
    service-accounts/
    artifact-registry/
    network/
    cloud-sql/
    secrets/
    kms/
    cloud-run/
    cloud-tasks/
    monitoring/
  environments/
    dev/
    prod/
```

Start with local Terraform state while only one developer is working and no
production infrastructure exists. Before production, move state to a dedicated,
versioned GCS bucket with restricted access and state locking support as
provided by the backend.

Do not put secret values in Terraform variables or state. Terraform should
create Secret Manager secret containers and IAM bindings; add secret versions
through a controlled command or CI secret workflow.

Standard workflow:

```bash
terraform fmt -check -recursive
terraform init
terraform validate
terraform plan
terraform apply
```

Read the plan. Pay particular attention to lines saying resources will be
destroyed or replaced.

## 9. Service accounts

Create narrow machine identities:

| Identity | Purpose |
|---|---|
| `web-runtime` | web/API runtime |
| `worker-runtime` | private task handlers |
| `tasks-invoker` | signs Cloud Tasks requests to worker |
| `scheduler-invoker` | invokes maintenance work |
| `migration-runtime` | executes schema migrations |
| `deploy-ci` | builds/deploys through CI |

Rules:

- do not download service-account JSON keys;
- use attached service accounts on Cloud Run;
- use Workload Identity Federation for GitHub Actions later;
- grant roles on the smallest applicable resource;
- never grant runtime identities Owner or Editor.

Expected role categories include Cloud SQL Client, Secret Manager Secret
Accessor on selected secrets, Cloud KMS CryptoKey Encrypter/Decrypter on the
specific key, Cloud Tasks Enqueuer, and Cloud Run Invoker on specific services.
Exact bindings belong in Terraform and should be reviewed against current GCP
documentation during implementation.

## 10. Artifact Registry and Cloud Run

Artifact Registry stores container images. Cloud Run deploys an immutable image
revision.

Development sequence:

1. create one Docker repository in `us-east1`;
2. build the web and worker images;
3. push tagged images;
4. deploy web and worker as separate Cloud Run services;
5. attach distinct runtime service accounts;
6. configure low maximum instance counts;
7. let services scale to zero initially;
8. require authentication for the worker;
9. allow public access to the web service because the browser and Plaid webhook
   need HTTPS access; application authentication protects private routes.

The development deployment can use the generated `run.app` URL. This avoids
the load balancer's cost and configuration while learning.

Cloud Run containers must:

- listen on the supplied `PORT`;
- avoid writing persistent state to the local filesystem;
- handle termination signals;
- keep startup reasonably quick;
- expose health endpoints;
- use structured standard-output/error logs.

## 11. Cloud SQL

Cloud SQL is likely the largest fixed MVP cost. Continue using local PostgreSQL
until the application schema and Plaid sync work.

Development:

- small zonal PostgreSQL instance;
- automated backups if test data matters;
- no HA;
- low connection pool and Cloud Run max instances.

Production:

- regional HA;
- automated backups;
- point-in-time recovery;
- deletion protection;
- tested isolated restore.

Use private IP in the target architecture. This requires a VPC, private service
access, and Cloud Run VPC egress. Keep all components in `us-east1`.

For local administration, prefer the Cloud SQL Auth Proxy or an approved secure
connection method rather than opening the database broadly to the internet.

Database connection capacity is finite. If:

```text
Cloud Run maximum instances × pool size
```

exceeds the database connection allowance, autoscaling can take the database
down. Begin with low caps and increase only from observed metrics.

## 12. Secret Manager

Create separate secrets such as:

```text
plaid-client-id
plaid-secret
session-secret
```

Vertex AI uses the Cloud Run service account and Application Default
Credentials, so no Vertex API key should be needed.

Practices:

- grant each service access only to required secrets;
- reference explicit versions for controlled rollouts or `latest` only when the
  rotation process accounts for it;
- never print secret values;
- do not expose secrets through `NEXT_PUBLIC_*`;
- rotate a secret by adding a new version, deploy/test, then disable the old
  version.

## 13. Cloud KMS envelope encryption

Secret Manager protects the application's Plaid client secret. KMS protects
each reusable Plaid access token stored in PostgreSQL.

Envelope encryption concept:

1. generate a random data-encryption key in the application;
2. encrypt the Plaid access token locally with an authenticated cipher such as
   AES-GCM;
3. ask KMS to encrypt, or wrap, the data-encryption key;
4. store token ciphertext, nonce, authentication tag, wrapped key, algorithm
   version, and KMS key resource name;
5. decrypt only inside an authorized worker when calling Plaid.

Do not send every full financial record to KMS. KMS protects the small
data-encryption key; local authenticated encryption protects the token.

Add tests proving the web service cannot decrypt if it does not require that
ability, while the worker can.

## 14. Cloud Tasks

Cloud Tasks sends authenticated HTTP requests to the worker and retries failed
requests.

Create queues by workload:

- `plaid-sync`;
- `classification`;
- `calculation`;
- `ai-analysis`;
- `deletion`.

A task body contains opaque internal identifiers and an idempotency key, not
Plaid tokens or financial rows.

The task uses an OIDC token for the worker's URL. The worker checks:

- Google-signed authentication accepted by Cloud Run;
- intended service account;
- expected audience;
- body schema;
- idempotency claim.

Do not treat Cloud Tasks as exactly-once. Successful handlers can still be
invoked more than once due to retries or response loss.

## 15. Vertex AI

Enable Vertex AI in the development project and grant the worker only the role
needed to invoke approved models.

Implementation rules:

- use the Google Cloud SDK with service-account credentials;
- use a stable Flash-Lite model available in `us-east1`;
- put the exact model ID in configuration;
- set maximum input/output tokens;
- validate structured output;
- log model ID, latency, token counts, and result status without logging the
  sensitive prompt;
- add a task queue rate limit and application cooldown;
- test with synthetic aggregates first.

Model availability and names change. Verify the chosen stable model and regional
availability in official Vertex AI documentation when implementing, rather
than copying an old model ID from this plan.

## 16. Monitoring

Start with alerts that lead to action:

- Cloud Run 5xx error rate;
- worker task failures;
- oldest Cloud Task age;
- Plaid sync stale beyond threshold;
- Cloud SQL storage and connection use;
- production backup failure;
- Vertex AI cost/request anomaly.

Send alerts to an email address that is actually monitored. Trigger a safe test
alert before relying on the channel.

## 17. Production project

Create `finance-prod` only after the development system passes Sandbox
connection, sync, webhook, deletion, and restore tests.

Production differences:

- different project and billing budget;
- different service accounts and secrets;
- production Plaid credentials;
- HA database and point-in-time recovery;
- deletion protection;
- no synthetic test endpoints;
- stricter log retention and access;
- approved custom domain and OAuth redirects;
- load balancer/Cloud Armor decision;
- explicit deployment approval.

Never make production a Terraform workspace sharing one state file with
development. Use separate roots and state.

## 18. Common beginner mistakes

- Creating resources in the wrong active project.
- Assuming a budget alert stops charges.
- Giving every service account Editor.
- Downloading a service-account key to solve authentication quickly.
- Putting secrets in `NEXT_PUBLIC_*`, Docker build arguments, or Terraform
  state.
- Creating Cloud SQL too early and forgetting it is continuously billed.
- Allowing unlimited Cloud Run instances against a small database.
- Testing with real financial data in development.
- Making the worker public because task authentication is initially difficult.
- Editing production manually and leaving Terraform unaware of the change.

## 19. Official references

- [Create and manage GCP projects](https://cloud.google.com/resource-manager/docs/creating-managing-projects)
- [Create billing budgets and alerts](https://cloud.google.com/billing/docs/how-to/budgets)
- [Deploy Node.js to Cloud Run](https://cloud.google.com/run/docs/quickstarts/build-and-deploy/deploy-nodejs-service)
- [Connect Cloud Run to PostgreSQL](https://cloud.google.com/sql/docs/postgres/connect-run)
- [Create authenticated HTTP Cloud Tasks](https://cloud.google.com/tasks/docs/creating-http-target-tasks)
- [Cloud KMS envelope encryption](https://cloud.google.com/kms/docs/envelope-encryption)
- [Firebase Google Sign-In](https://firebase.google.com/docs/auth/web/google-signin)
