variable "project_id" {
  type        = string
  description = "GCP project ID."
}

variable "pool_id" {
  type        = string
  description = "Workload Identity Pool ID."
}

variable "provider_id" {
  type        = string
  description = "Workload Identity Pool Provider ID."
}

variable "display_name" {
  type        = string
  description = "Workload Identity Pool display name."
}

variable "description" {
  type        = string
  description = "Workload Identity Pool description."
}

variable "github_repository" {
  type        = string
  description = "GitHub repository allowed to impersonate the service account, in owner/name form."
}

variable "github_ref" {
  type        = string
  description = "Git ref allowed to impersonate the service account."
}

variable "service_account_name" {
  type        = string
  description = "Full resource name of the service account GitHub Actions may impersonate."
}
