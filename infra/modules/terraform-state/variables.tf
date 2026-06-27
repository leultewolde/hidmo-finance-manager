variable "project_id" {
  type        = string
  description = "GCP project ID."
}

variable "bucket_name" {
  type        = string
  description = "Globally unique GCS bucket name for Terraform state."
}

variable "location" {
  type        = string
  description = "GCS bucket location."
}

variable "noncurrent_version_retention_count" {
  type        = number
  description = "Number of newer state object versions to keep before deleting archived versions."
  default     = 20
}

variable "object_admin_members" {
  type        = list(string)
  description = "Members allowed to read/write Terraform state objects."
  default     = []
}

variable "bucket_reader_members" {
  type        = list(string)
  description = "Members allowed to read bucket metadata for the Terraform backend."
  default     = []
}
