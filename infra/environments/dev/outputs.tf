output "artifact_registry_repository_url" {
  value = module.artifact_registry.repository_url
}

output "cloud_sql_connection_name" {
  value = try(module.cloud_sql[0].connection_name, null)
}

output "cloud_run_web_url" {
  value = try(module.cloud_run[0].web_url, null)
}

output "cloud_run_worker_name" {
  value = try(module.cloud_run[0].worker_name, null)
}

output "cloud_tasks_queue_names" {
  value = try(module.cloud_tasks[0].queue_names, {})
}

output "deploy_ci_service_account_email" {
  value = module.service_accounts.emails["deploy-ci"]
}

output "github_actions_workload_identity_provider" {
  value = module.github_actions_identity.provider_name
}

output "terraform_plan_ci_service_account_email" {
  value = module.service_accounts.emails["terraform-plan-ci"]
}

output "terraform_deploy_ci_service_account_email" {
  value = module.service_accounts.emails["terraform-deploy-ci"]
}

output "terraform_state_bucket_name" {
  value = module.terraform_state.bucket_name
}

output "terraform_state_prefix" {
  value = "finance-manager/dev"
}

output "kms_key_name" {
  value = try(module.kms[0].crypto_key_name, null)
}

output "secret_names" {
  value = try(module.secrets[0].secret_names, {})
}
