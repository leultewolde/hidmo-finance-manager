variable "project_id" {
  type        = string
  description = "Owning project."
}

variable "region" {
  type        = string
  description = "Region where the instance runs."
}

variable "instance_name" {
  type        = string
  description = "Cloud SQL instance name."
}

variable "database_name" {
  type        = string
  description = "Primary database name."
}

variable "database_version" {
  type        = string
  description = "Cloud SQL database version."
  default     = "POSTGRES_16"
}

variable "tier" {
  type        = string
  description = "Machine tier."
}

variable "edition" {
  type        = string
  description = "Cloud SQL edition. ENTERPRISE supports low-cost shared-core tiers such as db-f1-micro."
  default     = "ENTERPRISE"
}

variable "availability_type" {
  type        = string
  description = "Availability type."
  default     = "ZONAL"
}

variable "disk_type" {
  type        = string
  description = "Disk type."
  default     = "PD_SSD"
}

variable "disk_size_gb" {
  type        = number
  description = "Disk size in GB."
  default     = 10
}

variable "backup_enabled" {
  type        = bool
  description = "Enable backups."
  default     = true
}

variable "point_in_time_recovery_enabled" {
  type        = bool
  description = "Enable point-in-time recovery."
  default     = false
}

variable "backup_start_time" {
  type        = string
  description = "UTC backup start time."
  default     = "03:00"
}

variable "private_network_self_link" {
  type        = string
  description = "VPC network self link for private IP."
}

variable "deletion_protection" {
  type        = bool
  description = "Protect the instance from deletion."
  default     = false
}

variable "runtime_user_name" {
  type        = string
  description = "Database runtime user name."
}

variable "runtime_user_password" {
  type        = string
  description = "Runtime user password."
  default     = null
  sensitive   = true
}
