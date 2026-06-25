CREATE UNIQUE INDEX "accounts_user_id_unique" ON "accounts" USING btree ("user_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_user_id_unique" ON "budgets" USING btree ("user_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "connections_user_id_unique" ON "connections" USING btree ("user_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_user_id_unique" ON "transactions" USING btree ("user_id","id");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_connection_owner_fk" FOREIGN KEY ("user_id","connection_id") REFERENCES "public"."connections"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_budget_owner_fk" FOREIGN KEY ("user_id","budget_id") REFERENCES "public"."budgets"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liabilities" ADD CONSTRAINT "liabilities_account_owner_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "public"."accounts"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_splits" ADD CONSTRAINT "transaction_splits_transaction_owner_fk" FOREIGN KEY ("user_id","transaction_id") REFERENCES "public"."transactions"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_owner_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "public"."accounts"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_matches" ADD CONSTRAINT "transfer_matches_out_owner_fk" FOREIGN KEY ("user_id","transaction_out_id") REFERENCES "public"."transactions"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_matches" ADD CONSTRAINT "transfer_matches_in_owner_fk" FOREIGN KEY ("user_id","transaction_in_id") REFERENCES "public"."transactions"("user_id","id") ON DELETE cascade ON UPDATE no action;
