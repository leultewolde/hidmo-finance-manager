variable "project_id" {
  type        = string
  description = "Owning project."
}

variable "project_number" {
  type        = string
  description = "Owning project number."
}

variable "billing_account_id" {
  type        = string
  description = "Billing account ID."
}

variable "budget_amount_usd" {
  type        = number
  description = "Monthly budget amount in USD."
}

variable "budget_thresholds" {
  type        = list(number)
  description = "Budget threshold alerts."
}

variable "create_budget" {
  type        = bool
  description = "Whether this module should create a billing budget."
  default     = false
}

variable "logging_exclusions" {
  type = map(object({
    description = string
    filter      = string
  }))
  description = "Cloud Logging exclusions."
  default     = {}
}

variable "log_alert_metrics" {
  type = map(object({
    description         = string
    filter              = string
    alert_display_name  = string
    alert_documentation = string
    threshold           = optional(number, 0)
    duration            = optional(string, "0s")
    alignment_period    = optional(string, "300s")
  }))
  description = "Log-based metrics and alert policies for operational failures."
  default     = {}
}

variable "alert_notification_channels" {
  type        = list(string)
  description = "Cloud Monitoring notification channel resource names used by alert policies. Leave empty to create console-visible alerts without notifications."
  default     = []
}

variable "log_alert_metric_propagation_delay" {
  type        = string
  description = "Delay after creating log-based metrics before creating alert policies that reference them."
  default     = "600s"
}
