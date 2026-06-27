# Normal development deploy

Use this process for ordinary application changes after a PR is merged to
`main`. Do not use it for broad infrastructure changes; those still need a
reviewed Terraform plan.

## 1. Merge the code PR

Merge the application or deployment-code PR into `main`.

The `CD Artifacts` workflow should run automatically. It builds and pushes
immutable `linux/amd64` images for:

- `web`
- `worker`
- `migrations`

Open the workflow summary and copy the new image digest values if you want to
deploy that exact build immediately.

## 2. Run the manual deploy workflow

GitHub repository
→ Actions
→ Manual Deploy Dev
→ Run workflow

Use branch:

```text
main
```

Inputs:

```text
web_image=<new web image digest, or blank to use DEV_WEB_IMAGE>
worker_image=<new worker image digest, or blank to use DEV_WORKER_IMAGE>
migration_image=<new migrations image digest, or blank to use DEV_MIGRATION_IMAGE>
run_migrations=true only when the deploy includes database schema changes
confirm_apply=true
```

If you are deploying the images from the latest `CD Artifacts` run, paste those
new digest values. If you leave all three image inputs blank, the workflow
redeploys the repository variables' current image values.

## 3. Review and approve

Check the plan summary before approving the `dev` environment.

Expected allowed changes:

- `finance-web` image update
- `finance-worker` image update
- `finance-migrations` image update

Stop if the plan includes deletes or unrelated infrastructure changes.

## 4. Verify completion

The apply job:

1. applies the approved Cloud Run image changes;
2. optionally runs the migration job;
3. waits for web readiness to return HTTP 200;
4. confirms the worker still rejects anonymous access with HTTP 403;
5. updates `DEV_WEB_IMAGE`, `DEV_WORKER_IMAGE`, and `DEV_MIGRATION_IMAGE` to
   the deployed image digests.

After it passes, future Terraform plans should not propose rolling back to an
older image.

## If it fails

- If smoke checks fail with a transient HTTP 503, rerun only after checking the
  Cloud Run logs.
- If the repository-variable update fails, manually set the three `DEV_*_IMAGE`
  repository variables to the image digests shown in the workflow summary.
- If Terraform reports unrelated infrastructure changes, stop and use the
  normal PR Terraform plan process instead.
