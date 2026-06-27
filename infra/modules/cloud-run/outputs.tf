output "web_url" {
  value = google_cloud_run_v2_service.web.uri
}

output "worker_url" {
  value = google_cloud_run_v2_service.worker.uri
}

output "worker_name" {
  value = google_cloud_run_v2_service.worker.name
}

output "web_name" {
  value = google_cloud_run_v2_service.web.name
}

output "migration_job_name" {
  value = google_cloud_run_v2_job.migrations.name
}

