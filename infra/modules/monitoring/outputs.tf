output "budget_name" {
  value = try(google_billing_budget.this[0].display_name, null)
}

output "logging_exclusion_names" {
  value = keys(google_logging_project_exclusion.this)
}

output "log_alert_metric_names" {
  value = keys(google_logging_metric.log_alerts)
}

output "alert_policy_names" {
  value = {
    for name, policy in google_monitoring_alert_policy.log_alerts : name => policy.name
  }
}
