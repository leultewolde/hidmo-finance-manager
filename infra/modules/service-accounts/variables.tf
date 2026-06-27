variable "project_id" {
  type        = string
  description = "Project that owns the service accounts."
}

variable "service_accounts" {
  type = map(object({
    display_name  = string
    description   = optional(string)
    project_roles = optional(list(string), [])
  }))
  description = "Service accounts to create and project-level roles to assign."
}

