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

Images are first tagged with the Git commit for human traceability. After each
push, obtain its immutable digest. For example:

```bash
gcloud artifacts docker images describe \
  us-east1-docker.pkg.dev/finance-manager-dev-500423/finance-images/web:GIT_COMMIT \
  --format='value(image_summary.digest)'
```

Repeat for `worker` and `migrations`. Combine each repository path with its
digest:

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

## Important notes

- Do not put secret values in `terraform.tfvars`.
- Do not commit `.terraform/`.
- Do not commit `terraform.tfvars` or saved `*.tfplan` files.
- Keep `create_budget = false`; this project already has a manually managed
  billing budget.
- The database is the main fixed cost once it exists.
- Secret values are added later as Secret Manager versions, not as plain
  Terraform variables.
