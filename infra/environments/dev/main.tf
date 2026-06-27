locals {
  service_accounts = {
    web-runtime = {
      display_name = "Finance Manager web runtime"
      description  = "Runs the public web application."
      project_roles = [
        "roles/cloudsql.client",
        "roles/cloudtasks.enqueuer",
      ]
    }
    worker-runtime = {
      display_name = "Finance Manager worker runtime"
      description  = "Runs private Cloud Tasks handlers."
      project_roles = [
        "roles/cloudsql.client",
      ]
    }
    migration-runtime = {
      display_name = "Finance Manager migration runtime"
      description  = "Runs schema migrations."
      project_roles = [
        "roles/cloudsql.client",
      ]
    }
    tasks-invoker = {
      display_name = "Finance Manager Cloud Tasks invoker"
      description  = "Signs OIDC tokens for worker requests."
    }
    scheduler-invoker = {
      display_name = "Finance Manager scheduler invoker"
      description  = "Invokes maintenance endpoints when scheduled work is added."
    }
    deploy-ci = {
      display_name = "Finance Manager deploy CI"
      description  = "Publishes images and deploys reviewed revisions."
      project_roles = [
        "roles/artifactregistry.writer",
      ]
    }
  }

  secret_accessors = {
    "plaid-client-id" = [
      module.service_accounts.emails["web-runtime"],
    ]
    "plaid-secret" = [
      module.service_accounts.emails["web-runtime"],
    ]
    "database-url" = [
      module.service_accounts.emails["web-runtime"],
      module.service_accounts.emails["worker-runtime"],
      module.service_accounts.emails["migration-runtime"],
    ]
    "local-token-encryption-key" = [
      module.service_accounts.emails["web-runtime"],
      module.service_accounts.emails["worker-runtime"],
    ]
  }

  kms_encrypt_members = [
    "serviceAccount:${module.service_accounts.emails["web-runtime"]}",
  ]

  kms_decrypt_members = [
    "serviceAccount:${module.service_accounts.emails["worker-runtime"]}",
    "serviceAccount:${module.service_accounts.emails["web-runtime"]}",
  ]

  cloud_run_web_secret_env = {
    DATABASE_URL = {
      secret_name = "database-url"
      version     = "latest"
    }
    PLAID_CLIENT_ID = {
      secret_name = "plaid-client-id"
      version     = "latest"
    }
    PLAID_SECRET = {
      secret_name = "plaid-secret"
      version     = "latest"
    }
    LOCAL_TOKEN_ENCRYPTION_KEY = {
      secret_name = "local-token-encryption-key"
      version     = "latest"
    }
  }

  cloud_run_worker_secret_env = {
    DATABASE_URL = {
      secret_name = "database-url"
      version     = "latest"
    }
    LOCAL_TOKEN_ENCRYPTION_KEY = {
      secret_name = "local-token-encryption-key"
      version     = "latest"
    }
  }

  cloud_run_migration_secret_env = {
    DATABASE_URL = {
      secret_name = "database-url"
      version     = "latest"
    }
  }

  cloud_tasks_queues = {
    plaid-sync = {
      max_dispatches_per_second = 1
      max_concurrent_dispatches = 1
      max_attempts              = 10
      min_backoff               = "10s"
      max_backoff               = "300s"
      max_doublings             = 5
    }
    classification = {
      max_dispatches_per_second = 5
      max_concurrent_dispatches = 2
      max_attempts              = 10
      min_backoff               = "10s"
      max_backoff               = "300s"
      max_doublings             = 5
    }
    calculation = {
      max_dispatches_per_second = 5
      max_concurrent_dispatches = 2
      max_attempts              = 10
      min_backoff               = "10s"
      max_backoff               = "300s"
      max_doublings             = 5
    }
    ai-analysis = {
      max_dispatches_per_second = 1
      max_concurrent_dispatches = 1
      max_attempts              = 5
      min_backoff               = "30s"
      max_backoff               = "600s"
      max_doublings             = 4
    }
    deletion = {
      max_dispatches_per_second = 1
      max_concurrent_dispatches = 1
      max_attempts              = 5
      min_backoff               = "10s"
      max_backoff               = "300s"
      max_doublings             = 5
    }
  }

  logging_exclusions = {
    health-checks = {
      description = "Exclude successful Cloud Run health checks from logs."
      filter      = "resource.type=\"cloud_run_revision\" AND httpRequest.requestUrl:(\"/api/health/live\" OR \"/api/health/ready\") AND httpRequest.status < 400"
    }
  }
}

resource "google_project_iam_custom_role" "firebase_auth_session" {
  project     = var.project_id
  role_id     = "financeFirebaseAuthSession"
  title       = "Finance Manager Firebase Auth Session"
  description = "Allows the web runtime to verify Firebase users and create session cookies."
  permissions = [
    "firebaseauth.users.createSession",
    "firebaseauth.users.get",
  ]

  depends_on = [module.project_services]
}

resource "google_project_iam_member" "web_firebase_auth_session" {
  project = var.project_id
  role    = google_project_iam_custom_role.firebase_auth_session.name
  member  = "serviceAccount:${module.service_accounts.emails["web-runtime"]}"
}

module "project_services" {
  source = "../../modules/project-services"

  project_id = var.project_id
  services = toset([
    "artifactregistry.googleapis.com",
    "billingbudgets.googleapis.com",
    "cloudbuild.googleapis.com",
    "cloudkms.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "cloudtasks.googleapis.com",
    "compute.googleapis.com",
    "firebase.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "identitytoolkit.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "servicenetworking.googleapis.com",
    "sqladmin.googleapis.com",
    "aiplatform.googleapis.com",
  ])
}

module "service_accounts" {
  source = "../../modules/service-accounts"

  project_id       = var.project_id
  service_accounts = local.service_accounts

  depends_on = [module.project_services]
}

module "artifact_registry" {
  source = "../../modules/artifact-registry"

  project_id     = var.project_id
  location       = var.region
  repository_id  = var.artifact_registry_repository_id
  description    = "Finance Manager container images"
  writer_members = ["serviceAccount:${module.service_accounts.emails["deploy-ci"]}"]

  depends_on = [module.project_services]
}

module "github_actions_identity" {
  source = "../../modules/github-actions-identity"

  project_id           = var.project_id
  pool_id              = var.github_actions_workload_identity_pool_id
  provider_id          = var.github_actions_workload_identity_provider_id
  display_name         = "Finance Manager GitHub Actions"
  description          = "Allows the repository main branch to publish reviewed container images without service account keys."
  github_repository    = var.github_repository
  github_ref           = var.github_actions_ref
  service_account_name = module.service_accounts.names["deploy-ci"]

  depends_on = [
    module.project_services,
    module.service_accounts,
  ]
}

module "network" {
  count  = var.enable_runtime_infrastructure ? 1 : 0
  source = "../../modules/network"

  project_id                 = var.project_id
  region                     = var.region
  network_name               = var.network_name
  subnet_name                = var.subnet_name
  private_service_range_name = var.private_service_range_name

  depends_on = [module.project_services]
}

module "secrets" {
  count  = var.enable_runtime_infrastructure ? 1 : 0
  source = "../../modules/secrets"

  project_id = var.project_id
  secrets = {
    "plaid-client-id" = {
      description      = "Plaid client ID"
      accessor_members = [for email in local.secret_accessors["plaid-client-id"] : "serviceAccount:${email}"]
    }
    "plaid-secret" = {
      description      = "Plaid Sandbox secret"
      accessor_members = [for email in local.secret_accessors["plaid-secret"] : "serviceAccount:${email}"]
    }
    "database-url" = {
      description      = "PostgreSQL connection string"
      accessor_members = [for email in local.secret_accessors["database-url"] : "serviceAccount:${email}"]
    }
    "local-token-encryption-key" = {
      description      = "Local token encryption key"
      accessor_members = [for email in local.secret_accessors["local-token-encryption-key"] : "serviceAccount:${email}"]
    }
  }

  depends_on = [module.project_services]
}

module "kms" {
  count  = var.enable_runtime_infrastructure ? 1 : 0
  source = "../../modules/kms"

  project_id           = var.project_id
  location             = var.region
  key_ring_name        = "finance-dev"
  crypto_key_name      = "plaid-token"
  rotation_period_days = 90
  encrypter_members    = local.kms_encrypt_members
  decrypter_members    = local.kms_decrypt_members

  depends_on = [module.project_services]
}

module "cloud_sql" {
  count  = var.enable_runtime_infrastructure ? 1 : 0
  source = "../../modules/cloud-sql"

  project_id                = var.project_id
  region                    = var.region
  instance_name             = var.sql_instance_name
  database_name             = var.sql_database_name
  tier                      = var.sql_tier
  edition                   = var.sql_edition
  private_network_self_link = module.network[0].network_self_link
  deletion_protection       = false
  runtime_user_name         = var.sql_runtime_user_name
  runtime_user_password     = var.sql_runtime_user_password

  depends_on = [module.network]
}

module "cloud_tasks" {
  count  = var.enable_runtime_infrastructure ? 1 : 0
  source = "../../modules/cloud-tasks"

  project_id = var.project_id
  location   = var.region
  queues     = local.cloud_tasks_queues

  depends_on = [module.project_services]
}

module "cloud_run" {
  count  = var.enable_runtime_infrastructure && var.enable_cloud_run ? 1 : 0
  source = "../../modules/cloud-run"

  project_id                      = var.project_id
  location                        = var.region
  web_name                        = "finance-web"
  worker_name                     = "finance-worker"
  migration_job_name              = "finance-migrations"
  web_image                       = var.web_image
  worker_image                    = var.worker_image
  migration_image                 = var.migration_image
  web_service_account_email       = module.service_accounts.emails["web-runtime"]
  worker_service_account_email    = module.service_accounts.emails["worker-runtime"]
  migration_service_account_email = module.service_accounts.emails["migration-runtime"]
  web_max_instance_count          = var.web_max_instance_count
  worker_max_instance_count       = var.worker_max_instance_count
  vpc_network_self_link           = module.network[0].network_id
  vpc_subnetwork_self_link        = module.network[0].subnet_id
  web_environment = merge(var.web_environment, {
    FIREBASE_OWNER_UID  = var.owner_firebase_uid
    FIREBASE_PROJECT_ID = var.project_id
    PLAID_ENV           = "sandbox"
  })
  worker_environment     = var.worker_environment
  migration_environment  = var.migration_environment
  web_secret_env         = local.cloud_run_web_secret_env
  worker_secret_env      = local.cloud_run_worker_secret_env
  migration_secret_env   = local.cloud_run_migration_secret_env
  secret_names           = module.secrets[0].secret_names
  web_invoker_members    = ["allUsers"]
  worker_invoker_members = ["serviceAccount:${module.service_accounts.emails["tasks-invoker"]}"]

  depends_on = [
    module.project_services,
    module.network,
    module.secrets,
    module.service_accounts,
  ]
}

module "monitoring" {
  count  = var.enable_runtime_infrastructure ? 1 : 0
  source = "../../modules/monitoring"

  project_id         = var.project_id
  project_number     = tostring(data.google_project.this.number)
  billing_account_id = var.billing_account_id
  budget_amount_usd  = var.budget_amount_usd
  budget_thresholds  = var.budget_thresholds
  create_budget      = var.create_budget
  logging_exclusions = local.logging_exclusions

  depends_on = [module.project_services]
}
