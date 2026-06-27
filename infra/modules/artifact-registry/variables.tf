variable "project_id" {
  type        = string
  description = "Owning project."
}

variable "location" {
  type        = string
  description = "Artifact Registry region."
}

variable "repository_id" {
  type        = string
  description = "Repository identifier."
}

variable "description" {
  type        = string
  description = "Repository description."
}

variable "format" {
  type        = string
  description = "Artifact Registry format."
  default     = "DOCKER"
}

variable "writer_members" {
  type        = list(string)
  description = "IAM members allowed to push to the repository."
  default     = []
}

