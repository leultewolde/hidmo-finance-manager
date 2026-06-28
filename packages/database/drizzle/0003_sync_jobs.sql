CREATE TYPE "public"."sync_job_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "sync_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"trigger" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"cloud_task_name" text,
	"status" "sync_job_status" NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_error_code" text,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_connection_owner_fk" FOREIGN KEY ("user_id","connection_id") REFERENCES "public"."connections"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sync_jobs_idempotency_unique" ON "sync_jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "sync_jobs_user_created_idx" ON "sync_jobs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "sync_jobs_connection_created_idx" ON "sync_jobs" USING btree ("connection_id","created_at");