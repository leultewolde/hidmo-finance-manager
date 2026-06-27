variable "project_id" {
  type        = string
  description = "Owning project."
}

variable "region" {
  type        = string
  description = "Primary region."
}

variable "network_name" {
  type        = string
  description = "VPC network name."
}

variable "subnet_name" {
  type        = string
  description = "Subnet name."
}

variable "subnet_cidr" {
  type        = string
  description = "Subnet CIDR."
  default     = "10.20.0.0/24"
}

variable "private_service_range_name" {
  type        = string
  description = "Private service access range name."
}

variable "private_service_range_prefix_length" {
  type        = number
  description = "Prefix length used for private service access."
  default     = 16
}

