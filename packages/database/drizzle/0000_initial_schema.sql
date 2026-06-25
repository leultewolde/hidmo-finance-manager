CREATE TYPE "public"."account_class" AS ENUM('asset', 'liability');--> statement-breakpoint
CREATE TYPE "public"."account_kind" AS ENUM('checking', 'savings', 'cash', 'brokerage', 'retirement', 'property', 'credit_card', 'personal_loan', 'auto_loan', 'student_loan', 'mortgage', 'line_of_credit');--> statement-breakpoint
CREATE TYPE "public"."balance_source" AS ENUM('connected', 'manual');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('active', 'attention_required', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."currency_code" AS ENUM('USD', 'EUR');--> statement-breakpoint
CREATE TYPE "public"."data_quality" AS ENUM('verified', 'estimated', 'stale');--> statement-breakpoint
CREATE TYPE "public"."economic_type" AS ENUM('income', 'expense', 'transfer', 'debt_payment', 'refund', 'adjustment', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."liability_source" AS ENUM('provider', 'manual', 'mixed');--> statement-breakpoint
CREATE TYPE "public"."recommendation_status" AS ENUM('active', 'accepted', 'dismissed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."stream_kind" AS ENUM('income', 'expense');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('started', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."transaction_state" AS ENUM('pending', 'posted');--> statement-breakpoint
CREATE TYPE "public"."transfer_status" AS ENUM('candidate', 'accepted', 'rejected');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"connection_id" uuid,
	"provider_account_id" text,
	"persistent_provider_account_id" text,
	"name" text NOT NULL,
	"mask" text,
	"kind" "account_kind" NOT NULL,
	"account_class" "account_class" NOT NULL,
	"subtype" text,
	"current_balance_minor" bigint NOT NULL,
	"available_balance_minor" bigint,
	"credit_limit_minor" bigint,
	"currency" "currency_code" NOT NULL,
	"balance_source" "balance_source" NOT NULL,
	"data_quality" "data_quality" NOT NULL,
	"balance_as_of" date NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"manual" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_current_balance_nonnegative" CHECK ("accounts"."current_balance_minor" >= 0),
	CONSTRAINT "accounts_available_balance_nonnegative" CHECK ("accounts"."available_balance_minor" is null or "accounts"."available_balance_minor" >= 0),
	CONSTRAINT "accounts_credit_limit_nonnegative" CHECK ("accounts"."credit_limit_minor" is null or "accounts"."credit_limit_minor" >= 0),
	CONSTRAINT "accounts_manual_connection_shape" CHECK (("accounts"."manual" and "accounts"."connection_id" is null) or (not "accounts"."manual" and "accounts"."connection_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"budget_id" uuid NOT NULL,
	"category" text NOT NULL,
	"planned_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_lines_planned_nonnegative" CHECK ("budget_lines"."planned_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"currency" "currency_code" NOT NULL,
	"rollover_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_period_order" CHECK ("budgets"."period_start" <= "budgets"."period_end")
);
--> statement-breakpoint
CREATE TABLE "classification_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"match_conditions" jsonb NOT NULL,
	"economic_type" "economic_type" NOT NULL,
	"category" text NOT NULL,
	"priority" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"institution_id" uuid,
	"plaid_item_id" text,
	"status" "connection_status" DEFAULT 'active' NOT NULL,
	"encrypted_access_token" text,
	"wrapped_data_key" text,
	"encryption_nonce" text,
	"encryption_tag" text,
	"encryption_algorithm" text,
	"kms_key_name" text,
	"transaction_cursor" text,
	"consent_expires_at" timestamp with time zone,
	"last_successful_sync_at" timestamp with time zone,
	"error_code" text,
	"reconnect_required_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connections_token_envelope_complete" CHECK ((
        "connections"."encrypted_access_token" is null
        and "connections"."wrapped_data_key" is null
        and "connections"."encryption_nonce" is null
        and "connections"."encryption_tag" is null
        and "connections"."encryption_algorithm" is null
        and "connections"."kms_key_name" is null
      ) or (
        "connections"."encrypted_access_token" is not null
        and "connections"."wrapped_data_key" is not null
        and "connections"."encryption_nonce" is not null
        and "connections"."encryption_tag" is not null
        and "connections"."encryption_algorithm" is not null
        and "connections"."kms_key_name" is not null
      ))
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"target_amount_minor" bigint,
	"currency" "currency_code" NOT NULL,
	"target_date" date,
	"priority" integer NOT NULL,
	"contribution_rule" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goals_target_nonnegative" CHECK ("goals"."target_amount_minor" is null or "goals"."target_amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "institutions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"plaid_institution_id" text,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "liabilities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" "account_kind" NOT NULL,
	"principal_balance_minor" bigint NOT NULL,
	"apr_bps" integer,
	"minimum_payment_minor" bigint,
	"next_due_date" date,
	"original_principal_minor" bigint,
	"term_months" integer,
	"maturity_date" date,
	"source" "liability_source" NOT NULL,
	"field_provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "liabilities_principal_nonnegative" CHECK ("liabilities"."principal_balance_minor" >= 0),
	CONSTRAINT "liabilities_apr_nonnegative" CHECK ("liabilities"."apr_bps" is null or "liabilities"."apr_bps" >= 0),
	CONSTRAINT "liabilities_minimum_nonnegative" CHECK ("liabilities"."minimum_payment_minor" is null or "liabilities"."minimum_payment_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "metric_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"metric_key" text NOT NULL,
	"period_start" date,
	"period_end" date,
	"value" jsonb NOT NULL,
	"formula_version" text NOT NULL,
	"input_completeness_bps" integer NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metric_snapshots_completeness_range" CHECK ("metric_snapshots"."input_completeness_bps" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" "recommendation_status" DEFAULT 'active' NOT NULL,
	"priority" integer NOT NULL,
	"evidence" jsonb NOT NULL,
	"assumptions" jsonb NOT NULL,
	"estimated_monthly_impact_minor" bigint,
	"currency" "currency_code" NOT NULL,
	"confidence_bps" integer NOT NULL,
	"narrative" text,
	"model_metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommendations_confidence_range" CHECK ("recommendations"."confidence_bps" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "recurring_streams" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "stream_kind" NOT NULL,
	"merchant_name" text,
	"description_pattern" text,
	"cadence" text NOT NULL,
	"average_amount_minor" bigint NOT NULL,
	"currency" "currency_code" NOT NULL,
	"next_expected_date" date,
	"active" boolean DEFAULT true NOT NULL,
	"confidence_bps" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_streams_confidence_range" CHECK ("recurring_streams"."confidence_bps" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "task_executions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"idempotency_key" text NOT NULL,
	"operation" text NOT NULL,
	"schema_version" integer NOT NULL,
	"status" "task_status" NOT NULL,
	"attempt_count" integer DEFAULT 1 NOT NULL,
	"last_error_code" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_executions_attempt_positive" CHECK ("task_executions"."attempt_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "transaction_splits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"economic_type" "economic_type" NOT NULL,
	"category" text NOT NULL,
	"linked_liability_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"provider_transaction_id" text,
	"pending_provider_transaction_id" text,
	"authorized_date" date,
	"posted_date" date NOT NULL,
	"raw_provider_amount_minor" bigint,
	"normalized_amount_minor" bigint NOT NULL,
	"currency" "currency_code" NOT NULL,
	"merchant_name" text,
	"original_description" text,
	"state" "transaction_state" NOT NULL,
	"removed" boolean DEFAULT false NOT NULL,
	"provider_category" text,
	"provider_category_confidence_bps" integer,
	"economic_type" "economic_type" NOT NULL,
	"app_category" text NOT NULL,
	"classification_confidence_bps" integer,
	"user_reviewed" boolean DEFAULT false NOT NULL,
	"deduplication_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_provider_confidence_range" CHECK ("transactions"."provider_category_confidence_bps" is null or ("transactions"."provider_category_confidence_bps" between 0 and 10000)),
	CONSTRAINT "transactions_classification_confidence_range" CHECK ("transactions"."classification_confidence_bps" is null or ("transactions"."classification_confidence_bps" between 0 and 10000))
);
--> statement-breakpoint
CREATE TABLE "transfer_matches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"transaction_out_id" uuid NOT NULL,
	"transaction_in_id" uuid NOT NULL,
	"score_bps" integer NOT NULL,
	"status" "transfer_status" NOT NULL,
	"method" text NOT NULL,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfer_matches_distinct_transactions" CHECK ("transfer_matches"."transaction_out_id" <> "transfer_matches"."transaction_in_id"),
	CONSTRAINT "transfer_matches_score_range" CHECK ("transfer_matches"."score_bps" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"firebase_uid" text NOT NULL,
	"email" text NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"base_currency" "currency_code" DEFAULT 'USD' NOT NULL,
	"owner_slot" boolean DEFAULT true NOT NULL,
	"consented_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_owner_slot_true" CHECK ("users"."owner_slot" = true)
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classification_rules" ADD CONSTRAINT "classification_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liabilities" ADD CONSTRAINT "liabilities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liabilities" ADD CONSTRAINT "liabilities_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_snapshots" ADD CONSTRAINT "metric_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_streams" ADD CONSTRAINT "recurring_streams_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_executions" ADD CONSTRAINT "task_executions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_splits" ADD CONSTRAINT "transaction_splits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_splits" ADD CONSTRAINT "transaction_splits_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_matches" ADD CONSTRAINT "transfer_matches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_matches" ADD CONSTRAINT "transfer_matches_transaction_out_id_transactions_id_fk" FOREIGN KEY ("transaction_out_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_matches" ADD CONSTRAINT "transfer_matches_transaction_in_id_transactions_id_fk" FOREIGN KEY ("transaction_in_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_connection_provider_unique" ON "accounts" USING btree ("connection_id","provider_account_id") WHERE "accounts"."connection_id" is not null and "accounts"."provider_account_id" is not null;--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_events_user_created_idx" ON "audit_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_lines_budget_category_unique" ON "budget_lines" USING btree ("budget_id","category");--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_user_period_unique" ON "budgets" USING btree ("user_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "classification_rules_user_priority_idx" ON "classification_rules" USING btree ("user_id","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "connections_plaid_item_unique" ON "connections" USING btree ("plaid_item_id") WHERE "connections"."plaid_item_id" is not null;--> statement-breakpoint
CREATE INDEX "connections_user_idx" ON "connections" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "institutions_plaid_id_unique" ON "institutions" USING btree ("plaid_institution_id") WHERE "institutions"."plaid_institution_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "liabilities_account_unique" ON "liabilities" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "metric_snapshots_user_metric_idx" ON "metric_snapshots" USING btree ("user_id","metric_key","calculated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "task_executions_idempotency_unique" ON "task_executions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "transaction_splits_transaction_idx" ON "transaction_splits" USING btree ("transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_account_provider_unique" ON "transactions" USING btree ("account_id","provider_transaction_id") WHERE "transactions"."provider_transaction_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_user_fingerprint_unique" ON "transactions" USING btree ("user_id","deduplication_fingerprint");--> statement-breakpoint
CREATE INDEX "transactions_user_posted_idx" ON "transactions" USING btree ("user_id","posted_date");--> statement-breakpoint
CREATE UNIQUE INDEX "transfer_matches_out_accepted_unique" ON "transfer_matches" USING btree ("transaction_out_id") WHERE "transfer_matches"."status" = 'accepted';--> statement-breakpoint
CREATE UNIQUE INDEX "transfer_matches_in_accepted_unique" ON "transfer_matches" USING btree ("transaction_in_id") WHERE "transfer_matches"."status" = 'accepted';--> statement-breakpoint
CREATE UNIQUE INDEX "users_firebase_uid_unique" ON "users" USING btree ("firebase_uid");--> statement-breakpoint
CREATE UNIQUE INDEX "users_owner_slot_unique" ON "users" USING btree ("owner_slot");
