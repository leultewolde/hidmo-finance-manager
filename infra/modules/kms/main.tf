resource "google_kms_key_ring" "this" {
  project  = var.project_id
  name     = var.key_ring_name
  location = var.location
}

resource "google_kms_crypto_key" "this" {
  name            = var.crypto_key_name
  key_ring        = google_kms_key_ring.this.id
  purpose         = "ENCRYPT_DECRYPT"
  rotation_period = "${var.rotation_period_days * 24 * 60 * 60}s"

  version_template {
    algorithm = "GOOGLE_SYMMETRIC_ENCRYPTION"
  }
}

resource "google_kms_crypto_key_iam_member" "encrypter" {
  for_each = toset(var.encrypter_members)

  crypto_key_id = google_kms_crypto_key.this.id
  role          = "roles/cloudkms.cryptoKeyEncrypter"
  member        = each.value
}

resource "google_kms_crypto_key_iam_member" "decrypter" {
  for_each = toset(var.decrypter_members)

  crypto_key_id = google_kms_crypto_key.this.id
  role          = "roles/cloudkms.cryptoKeyDecrypter"
  member        = each.value
}
