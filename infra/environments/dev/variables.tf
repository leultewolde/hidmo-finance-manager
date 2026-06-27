variable "project_id" {
  type        = string
  description = "Development GCP project ID."
}

variable "billing_account_id" {
  type        = string
  description = "Billing account ID used for the development budget."
}

variable "region" {
  type        = string
  description = "Primary GCP region."
  default     = "us-east1"
}

variable "environment" {
  type        = string
  description = "Deployment environment name."
  default     = "dev"
}

variable "owner_firebase_uid" {
  type        = string
  description = "Firebase UID for the single allowed owner account."

  validation {
    condition     = !var.enable_cloud_run || (length(trimspace(var.owner_firebase_uid)) > 0 && var.owner_firebase_uid != "replace-me")
    error_message = "Set owner_firebase_uid to the real Firebase UID before enabling Cloud Run."
  }
}

variable "enable_runtime_infrastructure" {
  type        = bool
  description = "Creates the billable runtime stack after container images are available."
  default     = false
}

variable "enable_cloud_run" {
  type        = bool
  description = "Creates Cloud Run services and the migration job after secret versions and images exist."
  default     = false

  validation {
    condition     = !var.enable_cloud_run || var.enable_runtime_infrastructure
    error_message = "enable_cloud_run requires enable_runtime_infrastructure to also be true."
  }
}

variable "create_budget" {
  type        = bool
  description = "Creates a GCP billing budget. Keep false when the project already has a manually managed budget."
  default     = false
}

variable "budget_amount_usd" {
  type        = number
  description = "Monthly development budget amount in USD."
  default     = 25
}

variable "budget_thresholds" {
  type        = list(number)
  description = "Budget alert thresholds as decimal fractions."
  default     = [0.5, 0.9, 1.0]
}

variable "web_image" {
  type        = string
  description = "Immutable container image for the web Cloud Run service."

  validation {
    condition     = !var.enable_cloud_run || can(regex("@sha256:[0-9a-f]{64}$", var.web_image))
    error_message = "web_image must use an immutable @sha256 digest before enabling Cloud Run."
  }
}

variable "worker_image" {
  type        = string
  description = "Immutable container image for the worker Cloud Run service."

  validation {
    condition     = !var.enable_cloud_run || can(regex("@sha256:[0-9a-f]{64}$", var.worker_image))
    error_message = "worker_image must use an immutable @sha256 digest before enabling Cloud Run."
  }
}

variable "migration_image" {
  type        = string
  description = "Immutable container image for the migration Cloud Run job."

  validation {
    condition     = !var.enable_cloud_run || can(regex("@sha256:[0-9a-f]{64}$", var.migration_image))
    error_message = "migration_image must use an immutable @sha256 digest before enabling Cloud Run."
  }
}

variable "web_max_instance_count" {
  type        = number
  description = "Maximum number of web Cloud Run instances."
  default     = 2
}

variable "worker_max_instance_count" {
  type        = number
  description = "Maximum number of worker Cloud Run instances."
  default     = 1
}

variable "web_environment" {
  type        = map(string)
  description = "Plain environment variables injected into the web service."
  default = {
    APP_ENV   = "production"
    LOG_LEVEL = "info"
  }
}

variable "worker_environment" {
  type        = map(string)
  description = "Plain environment variables injected into the worker service."
  default = {
    APP_ENV   = "production"
    LOG_LEVEL = "info"
  }
}

variable "migration_environment" {
  type        = map(string)
  description = "Plain environment variables injected into the migration job."
  default = {
    APP_ENV = "production"
  }
}

variable "network_name" {
  type        = string
  description = "VPC network name."
  default     = "finance-dev-vpc"
}

variable "subnet_name" {
  type        = string
  description = "Subnet name for serverless egress and private services."
  default     = "finance-dev-subnet"
}

variable "private_service_range_name" {
  type        = string
  description = "Reserved range name for private service access."
  default     = "finance-dev-private-services"
}

variable "artifact_registry_repository_id" {
  type        = string
  description = "Artifact Registry Docker repository ID."
  default     = "finance-images"
}

variable "sql_instance_name" {
  type        = string
  description = "Cloud SQL instance name."
  default     = "finance-dev-postgres"
}

variable "sql_database_name" {
  type        = string
  description = "Primary PostgreSQL database name."
  default     = "finance_manager"
}

variable "sql_tier" {
  type        = string
  description = "Cloud SQL machine tier."
  default     = "db-f1-micro"
}

variable "sql_edition" {
  type        = string
  description = "Cloud SQL edition. Keep ENTERPRISE for the low-cost dev tier."
  default     = "ENTERPRISE"
}

variable "sql_runtime_user_name" {
  type        = string
  description = "Runtime database user name."
  default     = "finance_app"
}

variable "sql_runtime_user_password" {
  type        = string
  description = "Runtime database user password. Leave unset until you are ready to create the user."
  default     = null
  sensitive   = true
}

variable "plaid_client_id_secret_value" {
  type        = string
  description = "Optional initial secret value for plaid-client-id."
  default     = null
  sensitive   = true
}

variable "plaid_secret_value" {
  type        = string
  description = "Optional initial secret value for plaid-secret."
  default     = null
  sensitive   = true
}

variable "database_url_secret_value" {
  type        = string
  description = "Optional initial secret value for database-url."
  default     = null
  sensitive   = true
}

variable "local_token_encryption_key_secret_value" {
  type        = string
  description = "Optional initial secret value for local-token-encryption-key."
  default     = null
  sensitive   = true
}

variable "firebase_session_secret_value" {
  type        = string
  description = "Optional initial secret value for firebase-session-secret."
  default     = null
  sensitive   = true
}

variable "ai_api_key_secret_value" {
  type        = string
  description = "Optional initial secret value for ai-api-key."
  default     = null
  sensitive   = true
}
