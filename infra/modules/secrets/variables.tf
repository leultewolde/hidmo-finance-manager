variable "project_id" {
  type        = string
  description = "Owning project."
}

variable "secrets" {
  type = map(object({
    description      = optional(string)
    labels           = optional(map(string), {})
    accessor_members = optional(list(string), [])
  }))
  description = "Secret containers to create."
}

