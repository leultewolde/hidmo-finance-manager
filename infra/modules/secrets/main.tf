resource "google_secret_manager_secret" "this" {
  for_each = var.secrets

  project   = var.project_id
  secret_id = each.key

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_iam_member" "accessors" {
  for_each = {
    for binding in flatten([
      for secret_name, secret in var.secrets : [
        for member in try(secret.accessor_members, []) : {
          key         = "${secret_name}:${member}"
          secret_name = secret_name
          member      = member
        }
      ]
    ]) : binding.key => binding
  }

  project   = var.project_id
  secret_id = google_secret_manager_secret.this[each.value.secret_name].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = each.value.member
}

