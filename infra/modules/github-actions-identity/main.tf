resource "google_iam_workload_identity_pool" "this" {
  project                   = var.project_id
  workload_identity_pool_id = var.pool_id
  display_name              = var.display_name
  description               = var.description
  disabled                  = false
}

resource "google_iam_workload_identity_pool_provider" "this" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.this.workload_identity_pool_id
  workload_identity_pool_provider_id = var.provider_id
  display_name                       = "GitHub"
  description                        = "Trusts GitHub Actions OIDC tokens for the finance manager repository."
  disabled                           = false

  attribute_mapping = {
    "google.subject"             = "assertion.sub"
    "attribute.actor"            = "assertion.actor"
    "attribute.repository"       = "assertion.repository"
    "attribute.repository_owner" = "assertion.repository_owner"
    "attribute.ref"              = "assertion.ref"
    "attribute.workflow"         = "assertion.workflow"
  }

  attribute_condition = "assertion.repository == '${var.github_repository}' && assertion.ref == '${var.github_ref}'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "workload_identity_user" {
  service_account_id = var.service_account_name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.this.name}/attribute.repository/${var.github_repository}"
}

resource "google_service_account_iam_member" "additional_workload_identity_users" {
  for_each = var.additional_service_account_names

  service_account_id = each.value
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.this.name}/attribute.repository/${var.github_repository}"
}
