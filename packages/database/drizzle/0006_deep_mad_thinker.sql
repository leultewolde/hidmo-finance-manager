CREATE TYPE "public"."deletion_request_scope" AS ENUM('user', 'connection');--> statement-breakpoint
CREATE TYPE "public"."deletion_request_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "deletion_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"connection_id" uuid,
	"scope" "deletion_request_scope" NOT NULL,
	"status" "deletion_request_status" NOT NULL,
	"idempotency_key" text NOT NULL,
	"requested_by" text DEFAULT 'owner' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_error_code" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"audit_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deletion_requests_scope_shape" CHECK ((
        "deletion_requests"."scope" = 'connection'
        and "deletion_requests"."connection_id" is not null
      ) or (
        "deletion_requests"."scope" = 'user'
        and "deletion_requests"."connection_id" is null
      )),
	CONSTRAINT "deletion_requests_attempt_nonnegative" CHECK ("deletion_requests"."attempt_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "deletion_requests" ADD CONSTRAINT "deletion_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deletion_requests_idempotency_unique" ON "deletion_requests" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "deletion_requests_user_created_idx" ON "deletion_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "deletion_requests_connection_created_idx" ON "deletion_requests" USING btree ("connection_id","created_at");--> statement-breakpoint
CREATE INDEX "deletion_requests_status_created_idx" ON "deletion_requests" USING btree ("status","created_at");