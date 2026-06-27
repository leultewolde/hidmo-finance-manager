locals {
  project_role_bindings = merge([
    for account_name, account in var.service_accounts : {
      for role in toset(try(account.project_roles, [])) :
      "${account_name}:${role}" => {
        account_name = account_name
        role         = role
      }
    }
  ]...)
}

resource "google_service_account" "this" {
  for_each = var.service_accounts

  account_id   = each.key
  display_name = each.value.display_name
  description  = try(each.value.description, null)
  project      = var.project_id
}

resource "google_project_iam_member" "project_roles" {
  for_each = local.project_role_bindings

  project = var.project_id
  role    = each.value.role
  member  = "serviceAccount:${google_service_account.this[each.value.account_name].email}"
}

