output "emails" {
  value = {
    for name, service_account in google_service_account.this : name => service_account.email
  }
}

output "names" {
  value = {
    for name, service_account in google_service_account.this : name => service_account.name
  }
}

