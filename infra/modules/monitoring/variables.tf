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
