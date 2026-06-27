variable "project_id" {
  type        = string
  description = "Owning project."
}

variable "location" {
  type        = string
  description = "Queue region."
}

variable "queues" {
  type = map(object({
    max_dispatches_per_second = number
    max_concurrent_dispatches = number
    max_attempts              = number
    min_backoff               = string
    max_backoff               = string
    max_doublings             = number
  }))
  description = "Cloud Tasks queues to create."
}
