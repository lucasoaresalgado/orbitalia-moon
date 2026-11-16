CREATE TABLE "orbit_agents" (
	"orbit_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orbits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orbits_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "orbit_id" uuid;--> statement-breakpoint
ALTER TABLE "orbit_agents" ADD CONSTRAINT "orbit_agents_orbit_id_orbits_id_fk" FOREIGN KEY ("orbit_id") REFERENCES "public"."orbits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orbit_agents" ADD CONSTRAINT "orbit_agents_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "orbit_agents_orbit_id_agent_id_index" ON "orbit_agents" USING btree ("orbit_id","agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orbits_one_default" ON "orbits" USING btree ("is_default") WHERE "orbits"."is_default";--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_orbit_id_orbits_id_fk" FOREIGN KEY ("orbit_id") REFERENCES "public"."orbits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- the default orbit: every agent that exists now, and every project
INSERT INTO "orbits" ("slug", "name", "description", "is_default") VALUES ('default', 'Default', 'Every agent: the orbit of projects without one of their own.', true);--> statement-breakpoint
INSERT INTO "orbit_agents" ("orbit_id", "agent_id") SELECT o."id", a."id" FROM "orbits" o, "agents" a WHERE o."is_default" AND a."deleted_at" IS NULL;--> statement-breakpoint
UPDATE "projects" SET "orbit_id" = (SELECT "id" FROM "orbits" WHERE "is_default");
