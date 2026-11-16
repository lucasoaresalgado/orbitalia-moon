CREATE TABLE "skill_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"repo" text NOT NULL,
	"path" text DEFAULT '' NOT NULL,
	"ref" text,
	"sha" text,
	"status" text DEFAULT 'fetching' NOT NULL,
	"error" text,
	"found" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_sources" (
	"name" text PRIMARY KEY NOT NULL,
	"repo" text NOT NULL,
	"path" text NOT NULL,
	"ref" text,
	"sha" text NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"installed_by" text NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL
);
