ALTER TABLE "budget_defaults" ADD COLUMN "limit_tokens" bigint;--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN "limit_tokens" bigint;--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN "spent_tokens" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN "reserved_tokens" bigint DEFAULT 0 NOT NULL;