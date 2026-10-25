CREATE TABLE "CommunityViolation" (
	"id" serial PRIMARY KEY NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"userId" integer NOT NULL,
	"sourceType" text,
	"sourceId" integer,
	"reason" text
);
--> statement-breakpoint
ALTER TABLE "CommunityViolation" ADD CONSTRAINT "CommunityViolation_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "CommunityViolation_user_time_idx" ON "CommunityViolation" USING btree ("userId","createdAt");
--> statement-breakpoint
UPDATE "CommunityProfile" SET "violationCount" = 0 WHERE "violationCount" > 0;
