output "network_self_link" {
  value = google_compute_network.this.self_link
}

output "subnet_self_link" {
  value = google_compute_subnetwork.this.self_link
}

output "private_service_connection_name" {
  value = google_service_networking_connection.private_vpc_connection.peering
}

