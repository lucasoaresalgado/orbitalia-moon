CREATE TABLE "card_notes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"card_id" uuid NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"handled_at" timestamp with time zone,
	"handled_run_id" uuid
);
--> statement-breakpoint
CREATE TABLE "limbic" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"memories" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "card_notes" ADD CONSTRAINT "card_notes_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "limbic" ADD CONSTRAINT "limbic_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_notes_card_id_id_index" ON "card_notes" USING btree ("card_id","id");