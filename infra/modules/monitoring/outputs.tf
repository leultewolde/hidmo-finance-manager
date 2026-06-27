output "budget_name" {
  value = try(google_billing_budget.this[0].display_name, null)
}

output "logging_exclusion_names" {
  value = keys(google_logging_project_exclusion.this)
}
