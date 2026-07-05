ALTER TYPE "public"."recommendation_status" ADD VALUE IF NOT EXISTS 'candidate' BEFORE 'active';--> statement-breakpoint
ALTER TABLE "recommendations" ALTER COLUMN "priority" SET DATA TYPE text USING (
  case
    when "priority" <= 1 then 'high'
    when "priority" = 2 then 'medium'
    else 'low'
  end
);--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "candidate_id" text;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "period_start" date;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "period_end" date;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "input_hash" text;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "formula_version" text;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "policy_version" text;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "rank" integer;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "rationale" text;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "evidence_ids" jsonb;--> statement-breakpoint
UPDATE "recommendations"
SET
  "candidate_id" = 'legacy-' || "id"::text,
  "period_start" = "created_at"::date,
  "period_end" = "created_at"::date,
  "input_hash" = 'legacy',
  "formula_version" = 'legacy',
  "policy_version" = 'legacy',
  "title" = "type",
  "rationale" = coalesce("narrative", 'Legacy recommendation'),
  "evidence_ids" = '[]'::jsonb,
  "rank" = case
    when "priority" = 'high' then 1
    when "priority" = 'medium' then 2
    else 3
  end
WHERE "candidate_id" IS NULL;--> statement-breakpoint
ALTER TABLE "recommendations" ALTER COLUMN "candidate_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendations" ALTER COLUMN "period_start" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendations" ALTER COLUMN "period_end" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendations" ALTER COLUMN "input_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendations" ALTER COLUMN "formula_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendations" ALTER COLUMN "policy_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendations" ALTER COLUMN "title" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendations" ALTER COLUMN "rationale" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendations" ALTER COLUMN "evidence_ids" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "recommendations_user_period_idx" ON "recommendations" USING btree ("user_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "recommendations_user_status_idx" ON "recommendations" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "recommendations_candidate_input_unique" ON "recommendations" USING btree ("user_id","period_start","period_end","input_hash","formula_version","policy_version","candidate_id");--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_period_order" CHECK ("recommendations"."period_start" <= "recommendations"."period_end");--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_priority_valid" CHECK ("recommendations"."priority" in ('high', 'medium', 'low'));--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_rank_positive" CHECK ("recommendations"."rank" is null or "recommendations"."rank" >= 1);
