output "secret_names" {
  value = {
    for name, secret in google_secret_manager_secret.this : name => secret.name
  }
}

