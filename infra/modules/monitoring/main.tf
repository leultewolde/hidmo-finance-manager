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

resource "google_logging_metric" "log_alerts" {
  for_each = var.log_alert_metrics

  project     = var.project_id
  name        = each.key
  description = each.value.description
  filter      = each.value.filter

  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "INT64"
    unit         = "1"
    display_name = each.value.alert_display_name
  }
}

resource "google_monitoring_alert_policy" "log_alerts" {
  for_each = var.log_alert_metrics

  project               = var.project_id
  display_name          = each.value.alert_display_name
  combiner              = "OR"
  enabled               = true
  notification_channels = var.alert_notification_channels

  conditions {
    display_name = each.value.alert_display_name

    condition_threshold {
      filter = join(" AND ", [
        "metric.type=\"logging.googleapis.com/user/${each.key}\"",
        "resource.type=\"cloud_run_revision\"",
      ])
      comparison      = "COMPARISON_GT"
      threshold_value = each.value.threshold
      duration        = each.value.duration

      aggregations {
        alignment_period     = each.value.alignment_period
        per_series_aligner   = "ALIGN_DELTA"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  documentation {
    content   = each.value.alert_documentation
    mime_type = "text/markdown"
  }

  depends_on = [google_logging_metric.log_alerts]
}
