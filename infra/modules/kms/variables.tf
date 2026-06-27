variable "project_id" {
  type        = string
  description = "Owning project."
}

variable "location" {
  type        = string
  description = "KMS location."
}

variable "key_ring_name" {
  type        = string
  description = "Key ring name."
}

variable "crypto_key_name" {
  type        = string
  description = "Crypto key name."
}

variable "rotation_period_days" {
  type        = number
  description = "Key rotation period in days."
  default     = 90
}

variable "encrypter_members" {
  type        = list(string)
  description = "Members that can encrypt with the key."
  default     = []
}

variable "decrypter_members" {
  type        = list(string)
  description = "Members that can decrypt with the key."
  default     = []
}

