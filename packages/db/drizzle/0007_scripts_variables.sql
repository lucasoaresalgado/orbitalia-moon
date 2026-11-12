CREATE TABLE "scripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"path" text NOT NULL,
	"language" text NOT NULL,
	"description" text,
	"args_schema" jsonb DEFAULT '{"type":"object","properties":{}}'::jsonb NOT NULL,
	"network" boolean DEFAULT false NOT NULL,
	"timeout_s" integer DEFAULT 300 NOT NULL,
	"mem_mb" integer DEFAULT 1024 NOT NULL,
	"schedule" text,
	"schedule_args" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schedule_enabled" boolean DEFAULT false NOT NULL,
	"last_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "variables" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" uuid,
	"name" text NOT NULL,
	"is_secret" boolean DEFAULT false NOT NULL,
	"value" text,
	"ciphertext" "bytea",
	"description" text,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "variables_scope_name" UNIQUE NULLS NOT DISTINCT("project_id","name")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "storage" jsonb;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "result" jsonb;--> statement-breakpoint
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variables" ADD CONSTRAINT "variables_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scripts_project_id_path_index" ON "scripts" USING btree ("project_id","path");