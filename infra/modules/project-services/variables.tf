variable "project_id" {
  type        = string
  description = "Project to enable APIs in."
}

variable "services" {
  type        = set(string)
  description = "APIs to enable."
}

