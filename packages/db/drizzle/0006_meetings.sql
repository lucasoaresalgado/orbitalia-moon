CREATE TABLE "meeting_participants" (
	"meeting_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meeting_messages" ADD COLUMN "actor" text DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "agenda" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "round_minutes" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "round_deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "created_by" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_participants_meeting_id_agent_id_index" ON "meeting_participants" USING btree ("meeting_id","agent_id");--> statement-breakpoint
CREATE INDEX "meeting_messages_meeting_id_id_index" ON "meeting_messages" USING btree ("meeting_id","id");