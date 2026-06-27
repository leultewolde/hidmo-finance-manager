# Dev Environment Runbook

This is the first GCP deployment environment for Milestone 8.

Use this directory when you are ready to review and eventually apply the
Terraform plan.

## What this environment creates

- required GCP APIs;
- finance-specific service accounts;
- Artifact Registry for container images;
- VPC networking with private service access;
- Cloud SQL for PostgreSQL;
- Secret Manager containers;
- Cloud KMS key ring and key;
- Cloud Run web service, worker service, and migrations job;
- Cloud Tasks queues;
- log exclusion resources; the existing console-managed budget is preserved.

## What you do

1. Fill in `terraform.tfvars` from the example file.
2. Confirm the project is still `finance-manager-dev-500423`.
3. Confirm the billing account ID matches the dev project.
4. Replace the placeholder Firebase owner UID.
5. Point the image variables at real immutable image digests.
6. Review the `terraform plan` output before any apply.

## What I do

1. Keep the HCL structure correct.
2. Update resource names and module boundaries.
3. Fix provider quirks and schema issues.
4. Explain any plan output that looks unexpected.

## Stage A: validate the configuration

From this directory:

```bash
terraform init
terraform fmt -check -recursive ../../
terraform validate
terraform plan
```

The example starts with `enable_runtime_infrastructure = false`. At that
setting, the plan must contain only:

- required Google APIs;
- runtime and deployment service accounts;
- IAM needed by those accounts;
- the Artifact Registry Docker repository.

It must not contain Cloud SQL, Cloud Run, Cloud Tasks, KMS, Secret Manager, or
monitoring resources.

## Stage B: bootstrap Artifact Registry

Copy the example and enter the non-secret values:

```bash
cp terraform.tfvars.example terraform.tfvars
```

Keep this setting:

```hcl
enable_runtime_infrastructure = false
enable_cloud_run              = false
```

Create and review a saved bootstrap plan:

```bash
terraform plan -out=bootstrap.tfplan
terraform show bootstrap.tfplan
```

Confirm that the plan has no destroys and no runtime resources. Only after
that review, apply exactly the saved plan:

```bash
terraform apply bootstrap.tfplan
```

Configure Docker and confirm the repository:

```bash
gcloud auth configure-docker us-east1-docker.pkg.dev
gcloud artifacts repositories describe finance-images \
  --location=us-east1 \
  --project=finance-manager-dev-500423
```

This bootstrap is a normal Terraform apply recorded in the same state as the
eventual runtime stack. Do not use `-target`; targeted applies can leave
dependencies and state harder to reason about.

## Stage C: publish immutable images

Build and push `web`, `worker`, and `migrations` images using the repository
output:

```bash
terraform output -raw artifact_registry_repository_url
```

On Apple Silicon Macs, build Cloud Run images for `linux/amd64`. Cloud Run
rejects arm64-only images with an error similar to:

```text
Container manifest type 'application/vnd.oci.image.index.v1+json' must support amd64/linux.
```

Use the repository helper from the repo root:

```bash
cd /Users/leul/projects/hidmo/finance-manager
pnpm deploy:images:dev
```

For a web-only update after an application fix:

```bash
pnpm deploy:images:dev:web
```

The script builds `linux/amd64` images, pushes them to Artifact Registry, and
prints Terraform-ready immutable digest references:

```text
web_image = "us-east1-docker.pkg.dev/finance-manager-dev-500423/finance-images/web@sha256:..."
worker_image = "us-east1-docker.pkg.dev/finance-manager-dev-500423/finance-images/worker@sha256:..."
migration_image = "us-east1-docker.pkg.dev/finance-manager-dev-500423/finance-images/migrations@sha256:..."
```

### Optional: GitHub CD artifact publishing

After the GitHub Actions identity resources are applied and repository
variables are configured, the `CD Artifacts` workflow publishes images whenever
changes land on `main`.

This workflow is deliberately limited:

- it builds and pushes images only;
- it writes immutable `@sha256` digest values to the workflow summary;
- it uploads `dev-image-digests.txt` as a workflow artifact;
- it does not deploy Cloud Run;
- it does not run `terraform apply`.

One-time GCP setup:

```bash
cd /Users/leul/projects/hidmo/finance-manager/infra/environments/dev
terraform plan -out=github-actions-identity.tfplan
terraform show github-actions-identity.tfplan
terraform apply github-actions-identity.tfplan
```

Expected plan shape:

- enable `iamcredentials.googleapis.com` if it is not already enabled;
- create a Workload Identity Pool named `github-actions`;
- create a GitHub OIDC provider named `github`;
- allow only `leultewolde/hidmo-finance-manager` on `refs/heads/main` to
  impersonate `deploy-ci`;
- no Cloud Run deployment changes unless image values changed separately.

After apply, capture the values GitHub needs:

```bash
terraform output -raw github_actions_workload_identity_provider
terraform output -raw deploy_ci_service_account_email
```

Then set these repository variables in GitHub:

GitHub repository
→ Settings
→ Secrets and variables
→ Actions
→ Variables

Required variables:

```text
CD_ARTIFACTS_ENABLED=true
GCP_WORKLOAD_IDENTITY_PROVIDER=<terraform output>
GCP_DEPLOY_SERVICE_ACCOUNT=<terraform output>
NEXT_PUBLIC_FIREBASE_API_KEY=<Firebase web app value>
NEXT_PUBLIC_FIREBASE_APP_ID=<Firebase web app value>
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=<Firebase web app value>
NEXT_PUBLIC_FIREBASE_PROJECT_ID=finance-manager-dev-500423
```

The Firebase web values are public client configuration, not Firebase Admin
credentials. Do not add Plaid secrets, database URLs, Terraform state, or
service account keys to GitHub.

To test manually:

GitHub repository
→ Actions
→ CD Artifacts
→ Run workflow

After a successful run, copy the digest values from either:

- the workflow job summary; or
- the uploaded `dev-image-digests-...` artifact.

Paste those values into `terraform.tfvars`, then plan and apply from your
workstation when you intentionally want to deploy them.

Manual equivalent:

```bash
REPO="us-east1-docker.pkg.dev/finance-manager-dev-500423/finance-images"
GIT_COMMIT="$(git rev-parse --short HEAD)"
IMAGE_TAG="${GIT_COMMIT}-amd64"

pnpm exec dotenv -e .env -- docker buildx build \
  --platform linux/amd64 \
  --provenance=false \
  --target web \
  --build-arg NEXT_PUBLIC_FIREBASE_API_KEY \
  --build-arg NEXT_PUBLIC_FIREBASE_APP_ID \
  --build-arg NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN \
  --build-arg NEXT_PUBLIC_FIREBASE_PROJECT_ID \
  -t "$REPO/web:$IMAGE_TAG" \
  --push .

gcloud artifacts docker images describe "$REPO/web:$IMAGE_TAG" \
  --format='value(image_summary.digest)'
```

Combine each repository path with its digest:

```text
us-east1-docker.pkg.dev/finance-manager-dev-500423/finance-images/web@sha256:...
```

Place all three digest references in `terraform.tfvars`.

## Stage D: create the runtime foundation

Set:

```hcl
enable_runtime_infrastructure = true
enable_cloud_run              = false
```

Then run:

```bash
terraform fmt -check -recursive ../../
terraform validate
terraform plan -out=runtime-foundation.tfplan
terraform show runtime-foundation.tfplan
```

Before applying the runtime foundation, verify:

- project is `finance-manager-dev-500423`;
- region is `us-east1`;
- there are no resource destroys;
- Cloud Run services and jobs are not in the plan yet;
- Cloud SQL uses the reviewed development tier and private networking;
- secret resources contain no secret values.

This stage creates Cloud SQL and starts its continuous billing. Do not apply
until its resources, IAM, and expected cost have been reviewed.

After applying the reviewed foundation plan, add the required Secret Manager
versions using the separate secret-entry guide. Cloud Run remains disabled, so
empty secrets cannot break service creation.

Cloud SQL notes learned during the first deployment:

- keep the development instance on `edition = "ENTERPRISE"` when using
  `db-f1-micro`;
- `ENTERPRISE_PLUS` rejects `db-f1-micro`;
- the instance is private-IP only, so use the private IP in the deployed
  `DATABASE_URL`;
- create the database user and Secret Manager secret versions outside
  Terraform so password values do not enter Terraform state.

Minimum secret versions required before Cloud Run:

```text
database-url
local-token-encryption-key
plaid-client-id
plaid-secret
```

## Stage E: deploy Cloud Run

After all required secret versions and immutable image digests exist, set:

```hcl
enable_runtime_infrastructure = true
enable_cloud_run              = true
```

Run:

```bash
terraform validate
terraform plan -out=cloud-run.tfplan
terraform show cloud-run.tfplan
```

Terraform validation rejects mutable image tags and placeholders at this
stage. Confirm:

- all three images use `@sha256:` references;
- there are no resource destroys;
- Cloud Run minimum instance counts are zero;
- Cloud Run maximum instance counts are limited;
- the web service alone permits `allUsers`;
- the worker permits only the task-invoker service account;
- no secret values appear in the plan.

Apply only the reviewed saved plan.

Cloud Run notes learned during the first deployment:

- direct VPC access expects resource names such as
  `projects/finance-manager-dev-500423/global/networks/finance-dev-vpc`, not
  Compute API self-link URLs;
- the web service is public at the Cloud Run URL, but app access is still
  restricted to `FIREBASE_OWNER_UID`;
- the worker service has no anonymous invoker and should return `HTTP/2 403`
  to direct browser/curl requests;
- Firebase Authentication must list the deployed web hostname under
  Authorized domains;
- the web runtime service account needs the custom
  `financeFirebaseAuthSession` role to verify Firebase users and create session
  cookies.

After Cloud Run deploys:

```bash
gcloud run jobs execute finance-migrations \
  --region us-east1 \
  --project finance-manager-dev-500423 \
  --wait

curl -i https://finance-web-wn5w6w4mva-ue.a.run.app/api/health/ready
curl -i https://finance-worker-wn5w6w4mva-ue.a.run.app/api/health/live
```

Expected:

```text
web readiness: HTTP/2 200
worker direct access: HTTP/2 403
```

For web-only app fixes:

1. merge the app fix to `main`;
2. run `pnpm deploy:images:dev:web`;
3. copy the printed `web_image = "...@sha256:..."` line into
   `terraform.tfvars`;
4. run `terraform plan -out=web-update.tfplan`;
5. review that only `finance-web` changes;
6. apply the saved plan.

## Stage F: deployed functional verification

Use the deployed web URL:

```text
https://finance-web-wn5w6w4mva-ue.a.run.app
```

Verify:

1. Google sign-in works for the configured owner account.
2. The dashboard loads.
3. Plaid Sandbox Link opens.
4. A Sandbox institution connects.
5. Accounts appear.
6. Transactions sync.
7. A classification or split persists after refresh.
8. Direct worker access remains forbidden.

If sign-in returns `invalid-origin`, inspect Cloud Run forwarding/origin
headers. If sign-in returns `invalid-session`, inspect Firebase Auth IAM on
`web-runtime`.

## Important notes

- Do not put secret values in `terraform.tfvars`.
- Do not commit `.terraform/`.
- Do not commit `terraform.tfvars` or saved `*.tfplan` files.
- Keep `create_budget = false`; this project already has a manually managed
  billing budget.
- The database is the main fixed cost once it exists.
- Secret values are added later as Secret Manager versions, not as plain
  Terraform variables.
