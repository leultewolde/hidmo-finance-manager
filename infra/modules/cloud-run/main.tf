locals {
  web_plain_env = [
    for name, value in var.web_environment : {
      name  = name
      value = value
    }
  ]

  worker_plain_env = [
    for name, value in var.worker_environment : {
      name  = name
      value = value
    }
  ]

  migration_plain_env = [
    for name, value in var.migration_environment : {
      name  = name
      value = value
    }
  ]
}

resource "google_cloud_run_v2_service" "web" {
  project             = var.project_id
  name                = var.web_name
  location            = var.location
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  lifecycle {
    ignore_changes = [
      scaling,
    ]
  }

  template {
    service_account = var.web_service_account_email

    scaling {
      min_instance_count = 0
      max_instance_count = var.web_max_instance_count
    }

    vpc_access {
      network_interfaces {
        network    = var.vpc_network_self_link
        subnetwork = var.vpc_subnetwork_self_link
      }
    }

    containers {
      image = var.web_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      dynamic "env" {
        for_each = local.web_plain_env
        content {
          name  = env.value.name
          value = env.value.value
        }
      }

      dynamic "env" {
        for_each = var.web_secret_env
        content {
          name = env.key

          value_source {
            secret_key_ref {
              secret  = var.secret_names[env.value.secret_name]
              version = env.value.version
            }
          }
        }
      }
    }
  }
}

resource "google_cloud_run_v2_service_iam_member" "web_invoker" {
  for_each = toset(var.web_invoker_members)

  project  = var.project_id
  location = var.location
  name     = google_cloud_run_v2_service.web.name
  role     = "roles/run.invoker"
  member   = each.value
}

resource "google_cloud_run_v2_service" "worker" {
  project             = var.project_id
  name                = var.worker_name
  location            = var.location
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  lifecycle {
    ignore_changes = [
      scaling,
    ]
  }

  template {
    service_account = var.worker_service_account_email

    scaling {
      min_instance_count = 0
      max_instance_count = var.worker_max_instance_count
    }

    vpc_access {
      network_interfaces {
        network    = var.vpc_network_self_link
        subnetwork = var.vpc_subnetwork_self_link
      }
    }

    containers {
      image = var.worker_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      dynamic "env" {
        for_each = local.worker_plain_env
        content {
          name  = env.value.name
          value = env.value.value
        }
      }

      dynamic "env" {
        for_each = var.worker_secret_env
        content {
          name = env.key

          value_source {
            secret_key_ref {
              secret  = var.secret_names[env.value.secret_name]
              version = env.value.version
            }
          }
        }
      }
    }
  }
}

resource "google_cloud_run_v2_service_iam_member" "worker_invoker" {
  for_each = toset(var.worker_invoker_members)

  project  = var.project_id
  location = var.location
  name     = google_cloud_run_v2_service.worker.name
  role     = "roles/run.invoker"
  member   = each.value
}

resource "google_cloud_run_v2_job" "migrations" {
  project             = var.project_id
  name                = var.migration_job_name
  location            = var.location
  deletion_protection = false

  template {
    template {
      service_account = var.migration_service_account_email

      timeout = "3600s"

      vpc_access {
        network_interfaces {
          network    = var.vpc_network_self_link
          subnetwork = var.vpc_subnetwork_self_link
        }
      }

      containers {
        image = var.migration_image

        dynamic "env" {
          for_each = local.migration_plain_env
          content {
            name  = env.value.name
            value = env.value.value
          }
        }

        dynamic "env" {
          for_each = var.migration_secret_env
          content {
            name = env.key

            value_source {
              secret_key_ref {
                secret  = var.secret_names[env.value.secret_name]
                version = env.value.version
              }
            }
          }
        }
      }
    }
  }
}
