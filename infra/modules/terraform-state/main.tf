resource "google_storage_bucket" "this" {
  project                     = var.project_id
  name                        = var.bucket_name
  location                    = var.location
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      num_newer_versions = var.noncurrent_version_retention_count
      with_state         = "ARCHIVED"
    }

    action {
      type = "Delete"
    }
  }
}

resource "google_storage_bucket_iam_member" "object_admins" {
  for_each = toset(var.object_admin_members)

  bucket = google_storage_bucket.this.name
  role   = "roles/storage.objectAdmin"
  member = each.value
}

resource "google_storage_bucket_iam_member" "bucket_readers" {
  for_each = toset(var.bucket_reader_members)

  bucket = google_storage_bucket.this.name
  role   = "roles/storage.legacyBucketReader"
  member = each.value
}
