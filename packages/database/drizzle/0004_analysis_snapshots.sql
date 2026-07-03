CREATE TYPE "public"."analysis_job_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."analysis_snapshot_status" AS ENUM('draft', 'complete', 'failed');--> statement-breakpoint
CREATE TABLE "analysis_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"snapshot_id" uuid,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"input_hash" text NOT NULL,
	"formula_version" text NOT NULL,
	"status" "analysis_job_status" NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analysis_jobs_period_order" CHECK ("analysis_jobs"."period_start" <= "analysis_jobs"."period_end")
);
--> statement-breakpoint
CREATE TABLE "analysis_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"input_hash" text NOT NULL,
	"formula_version" text NOT NULL,
	"deterministic_summary" jsonb NOT NULL,
	"narrative" jsonb,
	"status" "analysis_snapshot_status" NOT NULL,
	"completed_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analysis_snapshots_period_order" CHECK ("analysis_snapshots"."period_start" <= "analysis_snapshots"."period_end")
);
--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD CONSTRAINT "analysis_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD CONSTRAINT "analysis_jobs_snapshot_id_analysis_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."analysis_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_snapshots" ADD CONSTRAINT "analysis_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analysis_jobs_user_created_idx" ON "analysis_jobs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "analysis_jobs_user_status_idx" ON "analysis_jobs" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_jobs_input_unique" ON "analysis_jobs" USING btree ("user_id","period_start","period_end","input_hash","formula_version");--> statement-breakpoint
CREATE INDEX "analysis_snapshots_user_created_idx" ON "analysis_snapshots" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "analysis_snapshots_user_period_idx" ON "analysis_snapshots" USING btree ("user_id","period_start","period_end");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_snapshots_input_unique" ON "analysis_snapshots" USING btree ("user_id","period_start","period_end","input_hash","formula_version");