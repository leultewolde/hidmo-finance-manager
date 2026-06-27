# Infrastructure

This directory holds the Terraform foundation for Milestone 8.

The goal of this phase is to define the development GCP shape for:

- project service enablement;
- service accounts and IAM;
- Artifact Registry;
- private networking for Cloud SQL;
- Secret Manager containers;
- Cloud KMS;
- Cloud Run services and jobs;
- Cloud Tasks queues;
- baseline monitoring, while preserving the existing console-managed budget.

Use the `dev` environment first. Do not apply anything until you have reviewed
the plan.

## What you do

1. Confirm you are on the right GCP project.
2. Add secret values later through the GCP console or controlled CLI commands.
3. Review every Terraform plan before `apply`.

## What I do

1. Maintain the Terraform modules and environment layout.
2. Keep the deployment shape aligned with the application code.
3. Add the Terraform documentation and runbook updates.

## Expected flow

```bash
cd infra/environments/dev
terraform init
terraform fmt -check -recursive ../../
terraform validate
terraform plan
```

Review the plan carefully before any `terraform apply`.

The dev deployment is intentionally staged:

1. bootstrap APIs, service accounts, IAM, and Artifact Registry;
2. build/push immutable `linux/amd64` images;
3. create private networking, Cloud SQL, Secret Manager containers, KMS, and
   Cloud Tasks;
4. add Secret Manager versions outside Terraform;
5. deploy Cloud Run;
6. run migrations and deployed smoke tests.

Use the helper script from the repo root when publishing images:

```bash
pnpm deploy:images:dev
pnpm deploy:images:dev:web
```

The script prints `web_image`, `worker_image`, and `migration_image` values in
the exact format expected by `infra/environments/dev/terraform.tfvars`.

After GitHub OIDC is configured, the `CD Artifacts` workflow also publishes
main-branch images to Artifact Registry and uploads the same Terraform-ready
digest values as a workflow artifact. It does not deploy Cloud Run or run
`terraform apply`.

The next automation step is shared Terraform state in GCS. After state is
migrated, the `Terraform Plan` workflow can run a remote-state-backed plan from
GitHub Actions. It is plan-only and does not apply changes.

See `infra/environments/dev/README.md` for the full runbook, recovery notes,
and post-deployment verification checklist.
