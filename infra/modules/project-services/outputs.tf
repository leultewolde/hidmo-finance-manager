output "enabled_services" {
  value = [for service in google_project_service.this : service.service]
}

