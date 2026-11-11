CREATE TABLE "agent_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"model" text NOT NULL,
	"fallback_model" text,
	"system_prompt" text NOT NULL,
	"tools" jsonb NOT NULL,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"permissions" jsonb NOT NULL,
	"limits" jsonb NOT NULL,
	"change_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"description" text,
	"active_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"run_id" uuid,
	"card_id" uuid,
	"request" jsonb NOT NULL,
	"response" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_defaults" (
	"scope" text PRIMARY KEY NOT NULL,
	"limit_usd" numeric(10, 2) NOT NULL,
	"warn_pct" integer[] DEFAULT '{50,80}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" serial PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"scope_id" uuid,
	"limit_usd" numeric(10, 2) NOT NULL,
	"warn_pct" integer[] DEFAULT '{50,80}' NOT NULL,
	"period_start" date,
	"spent_usd" numeric(12, 6) DEFAULT 0 NOT NULL,
	"reserved_usd" numeric(12, 6) DEFAULT 0 NOT NULL,
	CONSTRAINT "budgets_scope_key" UNIQUE NULLS NOT DISTINCT("scope","scope_id","period_start")
);
--> statement-breakpoint
CREATE TABLE "card_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"card_id" uuid NOT NULL,
	"actor" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"duration_ms" integer,
	"tokens" integer,
	"cost_usd" numeric(12, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'code' NOT NULL,
	"brief" text,
	"acceptance_criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'backlog' NOT NULL,
	"status_before_block" text,
	"blocked_reason" text,
	"priority" text DEFAULT 'medium' NOT NULL,
	"assignee_agent_id" uuid,
	"model_tier" text,
	"branch" text,
	"pr_number" integer,
	"pr_url" text,
	"pr_last_review_id" bigint,
	"review_loops" integer DEFAULT 0 NOT NULL,
	"plan_id" uuid,
	"plan_key" text,
	"parent_card_id" uuid,
	"meeting_id" uuid,
	"source" text DEFAULT 'manager' NOT NULL,
	"start_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" uuid,
	"card_id" uuid,
	"meeting_id" uuid,
	"type" text NOT NULL,
	"engine" text NOT NULL,
	"input_ref" jsonb,
	"output" jsonb NOT NULL,
	"confidence" numeric(4, 3),
	"accepted" boolean DEFAULT true NOT NULL,
	"latency_ms" integer,
	"outcome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_calls" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" uuid,
	"card_id" uuid,
	"project_id" uuid,
	"agent_version_id" uuid,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_creation_input_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_input_tokens" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"cost_usd" numeric(12, 6) DEFAULT 0 NOT NULL,
	"price_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manager_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"project_id" uuid,
	"role" text NOT NULL,
	"content" jsonb NOT NULL,
	"run_id" uuid,
	"cost_usd" numeric(12, 6),
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"meeting_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"agent_id" uuid,
	"kind" text NOT NULL,
	"to_agent_id" uuid,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"topic" text NOT NULL,
	"status" text NOT NULL,
	"round" integer DEFAULT 0 NOT NULL,
	"max_rounds" integer DEFAULT 3 NOT NULL,
	"closed_by" text,
	"minutes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "model_prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_per_mtok" numeric(10, 4) NOT NULL,
	"output_per_mtok" numeric(10, 4) NOT NULL,
	"cache_write_per_mtok" numeric(10, 4) DEFAULT 0 NOT NULL,
	"cache_read_per_mtok" numeric(10, 4) DEFAULT 0 NOT NULL,
	"effective_from" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "note_chunks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"note_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"embedding_model" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"source_type" text NOT NULL,
	"source_id" uuid,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"level" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"channels" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"status" text NOT NULL,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"repo_full_name" text,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"checks_command" text,
	"checks_network" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"next_card_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"data" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"card_id" uuid,
	"project_id" uuid,
	"meeting_id" uuid,
	"agent_version_id" uuid,
	"status" text NOT NULL,
	"model" text,
	"input" jsonb,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"attempt" integer DEFAULT 0 NOT NULL,
	"turn" integer DEFAULT 0 NOT NULL,
	"checkpoint" jsonb,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT 0 NOT NULL,
	"tokens" integer DEFAULT 0 NOT NULL,
	"summary" text,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sandbox_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" uuid,
	"container_name" text,
	"image" text NOT NULL,
	"command" text NOT NULL,
	"network" boolean DEFAULT false NOT NULL,
	"cpu_limit" numeric(3, 1) NOT NULL,
	"mem_limit_mb" integer NOT NULL,
	"exit_code" integer,
	"timed_out" boolean DEFAULT false NOT NULL,
	"stdout_tail" text,
	"stderr_tail" text,
	"full_log_path" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secrets" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"allowed_tools" text[] DEFAULT '{}' NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "secrets_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_calls" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"tool_use_id" text,
	"name" text NOT NULL,
	"input" jsonb NOT NULL,
	"output_summary" text,
	"status" text NOT NULL,
	"approval_id" uuid,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_events" ADD CONSTRAINT "card_events_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_assignee_agent_id_agents_id_fk" FOREIGN KEY ("assignee_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_price_id_model_prices_id_fk" FOREIGN KEY ("price_id") REFERENCES "public"."model_prices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_messages" ADD CONSTRAINT "manager_messages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_messages" ADD CONSTRAINT "manager_messages_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_messages" ADD CONSTRAINT "meeting_messages_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_messages" ADD CONSTRAINT "meeting_messages_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_messages" ADD CONSTRAINT "meeting_messages_to_agent_id_agents_id_fk" FOREIGN KEY ("to_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_chunks" ADD CONSTRAINT "note_chunks_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_agent_version_id_agent_versions_id_fk" FOREIGN KEY ("agent_version_id") REFERENCES "public"."agent_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_runs" ADD CONSTRAINT "sandbox_runs_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_versions_agent_id_version_index" ON "agent_versions" USING btree ("agent_id","version");--> statement-breakpoint
CREATE INDEX "approvals_status_created_at_index" ON "approvals" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_created_at_index" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "card_events_card_id_created_at_index" ON "card_events" USING btree ("card_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cards_project_id_number_index" ON "cards" USING btree ("project_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "cards_plan_key_idx" ON "cards" USING btree ("plan_id","plan_key");--> statement-breakpoint
CREATE INDEX "llm_calls_created_at_index" ON "llm_calls" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "llm_calls_card_id_index" ON "llm_calls" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "manager_messages_project_id_id_index" ON "manager_messages" USING btree ("project_id","id");--> statement-breakpoint
CREATE INDEX "note_chunks_embedding_idx" ON "note_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "plans_project_id_version_index" ON "plans" USING btree ("project_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "run_events_run_id_seq_index" ON "run_events" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "runs_status_created_at_index" ON "runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "runs_card_id_index" ON "runs" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "tool_calls_run_id_index" ON "tool_calls" USING btree ("run_id");