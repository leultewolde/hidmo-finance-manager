resource "google_sql_database_instance" "this" {
  project             = var.project_id
  name                = var.instance_name
  region              = var.region
  database_version    = var.database_version
  deletion_protection = var.deletion_protection

  settings {
    tier              = var.tier
    availability_type = var.availability_type
    disk_type         = var.disk_type
    disk_size         = var.disk_size_gb

    backup_configuration {
      enabled                        = var.backup_enabled
      point_in_time_recovery_enabled = var.point_in_time_recovery_enabled
      start_time                     = var.backup_start_time
    }

    ip_configuration {
      ipv4_enabled    = false
      private_network = var.private_network_self_link
    }
  }
}

resource "google_sql_database" "this" {
  project  = var.project_id
  name     = var.database_name
  instance = google_sql_database_instance.this.name
}

resource "google_sql_user" "runtime" {
  count    = var.runtime_user_password == null ? 0 : 1
  project  = var.project_id
  instance = google_sql_database_instance.this.name
  name     = var.runtime_user_name
  password = var.runtime_user_password
}
