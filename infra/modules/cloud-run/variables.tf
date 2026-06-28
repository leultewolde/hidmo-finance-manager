variable "project_id" {
  type        = string
  description = "Owning project."
}

variable "location" {
  type        = string
  description = "Cloud Run region."
}

variable "web_name" {
  type        = string
  description = "Web service name."
}

variable "worker_name" {
  type        = string
  description = "Worker service name."
}

variable "migration_job_name" {
  type        = string
  description = "Migration job name."
}

variable "web_image" {
  type        = string
  description = "Web image reference."
}

variable "worker_image" {
  type        = string
  description = "Worker image reference."
}

variable "migration_image" {
  type        = string
  description = "Migration image reference."
}

variable "web_service_account_email" {
  type        = string
  description = "Web runtime service account."
}

variable "worker_service_account_email" {
  type        = string
  description = "Worker runtime service account."
}

variable "migration_service_account_email" {
  type        = string
  description = "Migration runtime service account."
}

variable "web_max_instance_count" {
  type        = number
  description = "Maximum web instances."
  default     = 2
}

variable "worker_max_instance_count" {
  type        = number
  description = "Maximum worker instances."
  default     = 1
}

variable "vpc_network_self_link" {
  type        = string
  description = "VPC resource name for direct VPC egress."
}

variable "vpc_subnetwork_self_link" {
  type        = string
  description = "Subnet resource name for direct VPC egress."
}

variable "web_environment" {
  type        = map(string)
  description = "Plain web environment variables."
  default     = {}
}

variable "web_cloud_tasks_environment" {
  type = object({
    calculation_queue             = string
    invoker_service_account_email = string
    location                      = string
    plaid_sync_queue              = string
  })
  description = "Cloud Tasks environment variables injected into the web service. Worker URL is derived from the worker service URI."
  default     = null
}

variable "worker_environment" {
  type        = map(string)
  description = "Plain worker environment variables."
  default     = {}
}

variable "migration_environment" {
  type        = map(string)
  description = "Plain migration environment variables."
  default     = {}
}

variable "web_secret_env" {
  type = map(object({
    secret_name = string
    version     = string
  }))
  description = "Web secrets injected as environment variables."
  default     = {}
}

variable "worker_secret_env" {
  type = map(object({
    secret_name = string
    version     = string
  }))
  description = "Worker secrets injected as environment variables."
  default     = {}
}

variable "migration_secret_env" {
  type = map(object({
    secret_name = string
    version     = string
  }))
  description = "Migration job secrets injected as environment variables."
  default     = {}
}

variable "secret_names" {
  type        = map(string)
  description = "Secret Manager resource names keyed by secret id."
  default     = {}
}

variable "web_invoker_members" {
  type        = list(string)
  description = "Members allowed to invoke the web service."
  default     = []
}

variable "worker_invoker_members" {
  type        = list(string)
  description = "Members allowed to invoke the worker service."
  default     = []
}
