resource "google_billing_budget" "this" {
  count = var.create_budget ? 1 : 0

  billing_account = var.billing_account_id
  display_name    = "${var.project_id} development budget"

  budget_filter {
    projects = ["projects/${var.project_number}"]
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(var.budget_amount_usd)
    }
  }

  dynamic "threshold_rules" {
    for_each = toset(var.budget_thresholds)
    content {
      threshold_percent = threshold_rules.value
    }
  }
}

resource "google_logging_project_exclusion" "this" {
  for_each = var.logging_exclusions

  name        = each.key
  project     = var.project_id
  description = each.value.description
  filter      = each.value.filter
}
