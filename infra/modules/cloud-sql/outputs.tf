output "connection_name" {
  value = google_sql_database_instance.this.connection_name
}

output "database_name" {
  value = google_sql_database.this.name
}

output "instance_name" {
  value = google_sql_database_instance.this.name
}

output "private_ip_address" {
  value = try(google_sql_database_instance.this.ip_address[0].ip_address, null)
}

